-- Stage 11: multi reminders, snooze, overdue reminders, and reminder health.

create table if not exists family_schedule_reminder_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_item_id uuid not null references family_schedule_items(id) on delete cascade,
  offset_minutes int not null,
  created_at timestamptz not null default now(),
  unique (schedule_item_id, offset_minutes)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_reminder_rules_offset_check'
       and conrelid = 'family_schedule_reminder_rules'::regclass
  ) then
    alter table family_schedule_reminder_rules
      add constraint family_schedule_reminder_rules_offset_check
      check (offset_minutes in (0, 10, 30, 60, 1440));
  end if;
end;
$$;

create index if not exists family_schedule_reminder_rules_item_idx
  on family_schedule_reminder_rules (schedule_item_id, offset_minutes);

alter table family_schedule_reminder_rules enable row level security;
revoke all on family_schedule_reminder_rules from anon, authenticated;

drop policy if exists "family schedule reminder rules are rpc only"
  on family_schedule_reminder_rules;

create policy "family schedule reminder rules are rpc only"
  on family_schedule_reminder_rules for select
  to anon, authenticated
  using (false);

alter table family_schedule_reminder_deliveries
  add column if not exists reminder_kind text not null default 'before_start',
  add column if not exists snoozed_from_delivery_id uuid references family_schedule_reminder_deliveries(id) on delete set null,
  add column if not exists snoozed_by_member_id uuid references family_members(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_reminder_deliveries_kind_check'
       and conrelid = 'family_schedule_reminder_deliveries'::regclass
  ) then
    alter table family_schedule_reminder_deliveries
      add constraint family_schedule_reminder_deliveries_kind_check
      check (reminder_kind in ('before_start', 'snooze', 'overdue'));
  end if;
end;
$$;

create index if not exists family_schedule_reminder_deliveries_kind_idx
  on family_schedule_reminder_deliveries (family_id, reminder_kind, status, scheduled_for);

create or replace function ensure_schedule_reminder_deliveries(
  p_schedule_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_item family_schedule_items%rowtype;
  v_now timestamptz := now();
begin
  select * into v_item
    from family_schedule_items
   where id = p_schedule_item_id;

  if not found then
    return;
  end if;

  if v_item.deleted_at is not null or v_item.status <> 'active' then
    update family_schedule_reminder_deliveries d
       set status = 'skipped',
           skipped_reason = 'schedule_not_active',
           updated_at = v_now
     where d.schedule_item_id = v_item.id
       and d.status in ('pending', 'failed');
    return;
  end if;

  if not exists (
    select 1 from family_schedule_reminder_rules r
     where r.schedule_item_id = v_item.id
  ) and v_item.remind_at is null then
    update family_schedule_reminder_deliveries d
       set status = 'skipped',
           skipped_reason = 'reminder_not_configured',
           updated_at = v_now
     where d.schedule_item_id = v_item.id
       and d.status in ('pending', 'failed')
       and d.reminder_kind = 'before_start';
    return;
  end if;

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = 'reminder_changed',
         updated_at = v_now
   where d.schedule_item_id = v_item.id
     and d.status in ('pending', 'failed')
     and d.reminder_kind = 'before_start'
     and not exists (
       with offsets as (
         select r.offset_minutes
           from family_schedule_reminder_rules r
          where r.schedule_item_id = v_item.id
         union
         select greatest(0, round(extract(epoch from (v_item.starts_at - v_item.remind_at)) / 60)::int)
          where v_item.remind_at is not null
            and not exists (
              select 1 from family_schedule_reminder_rules rr
               where rr.schedule_item_id = v_item.id
            )
       )
       select 1 from offsets o
        where d.scheduled_for = v_item.starts_at - (o.offset_minutes * interval '1 minute')
     );

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = 'not_visible',
         updated_at = v_now
   where d.schedule_item_id = v_item.id
     and d.status in ('pending', 'failed')
     and not exists (
       select 1
         from family_members fm
        where fm.id = d.member_id
          and fm.family_id = v_item.family_id
          and fm.status = 'active'
          and (
            v_item.visibility = 'family'
            or fm.id in (v_item.creator_member_id, v_item.assignee_member_id)
          )
     );

  insert into family_schedule_reminder_deliveries (
    family_id,
    schedule_item_id,
    member_id,
    scheduled_for,
    reminder_kind,
    status,
    updated_at
  )
  with offsets as (
    select r.offset_minutes
      from family_schedule_reminder_rules r
     where r.schedule_item_id = v_item.id
    union
    select greatest(0, round(extract(epoch from (v_item.starts_at - v_item.remind_at)) / 60)::int)
     where v_item.remind_at is not null
       and not exists (
         select 1 from family_schedule_reminder_rules rr
          where rr.schedule_item_id = v_item.id
       )
  )
  select v_item.family_id,
         v_item.id,
         fm.id,
         v_item.starts_at - (o.offset_minutes * interval '1 minute'),
         'before_start',
         'pending',
         v_now
    from offsets o
    join family_members fm on fm.family_id = v_item.family_id
   where fm.status = 'active'
     and (
       v_item.visibility = 'family'
       or fm.id in (v_item.creator_member_id, v_item.assignee_member_id)
     )
  on conflict (schedule_item_id, member_id, scheduled_for) do nothing;
end;
$$;

create or replace function set_schedule_reminder_rules(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_offsets int[],
  p_recurrence_scope text default 'single'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_scope text;
  v_offsets int[];
  v_target record;
  v_remind_at timestamptz;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_scope := coalesce(nullif(trim(coalesce(p_recurrence_scope, '')), ''), 'single');
  if v_scope not in ('single', 'future', 'all') then
    raise exception 'invalid_schedule_scope';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  if v_item.recurrence_group_id is null then
    v_scope := 'single';
  end if;

  select coalesce(array_agg(distinct offset_minutes order by offset_minutes), '{}'::int[])
    into v_offsets
    from unnest(coalesce(p_offsets, '{}'::int[])) as offset_minutes
   where offset_minutes in (0, 10, 30, 60, 1440);

  if coalesce(array_length(v_offsets, 1), 0) <> coalesce(array_length(p_offsets, 1), 0) then
    raise exception 'invalid_schedule_reminder_offset';
  end if;

  for v_target in
    select s.*
      from family_schedule_items s
     where s.family_id = v_member.family_id
       and s.deleted_at is null
       and (
         (v_scope = 'single' and s.id = v_item.id)
         or (
           v_scope = 'future'
           and s.recurrence_group_id = v_item.recurrence_group_id
           and s.starts_at >= v_item.starts_at
         )
         or (
           v_scope = 'all'
           and s.recurrence_group_id = v_item.recurrence_group_id
         )
       )
       and (
         s.creator_member_id = v_member.id
         or s.assignee_member_id = v_member.id
         or (s.visibility = 'family' and v_member.is_admin)
       )
  loop
    delete from family_schedule_reminder_rules
     where schedule_item_id = v_target.id;

    insert into family_schedule_reminder_rules (
      family_id, schedule_item_id, offset_minutes
    )
    select v_target.family_id, v_target.id, offset_minutes
      from unnest(v_offsets) as offset_minutes;

    select min(v_target.starts_at - (offset_minutes * interval '1 minute'))
      into v_remind_at
      from unnest(v_offsets) as offset_minutes;

    update family_schedule_items
       set remind_at = v_remind_at,
           reminded_at = null,
           reminder_push_attempted_at = null,
           reminder_push_error = null,
           updated_at = now()
     where id = v_target.id;

    perform ensure_schedule_reminder_deliveries(v_target.id);
  end loop;
end;
$$;

create or replace function snooze_schedule_reminder(
  p_member_id uuid,
  p_member_token text,
  p_delivery_id uuid,
  p_minutes int
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_delivery family_schedule_reminder_deliveries%rowtype;
  v_item family_schedule_items%rowtype;
  v_id uuid;
  v_scheduled_for timestamptz;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_minutes not in (5, 10, 30) then
    raise exception 'invalid_schedule_snooze_minutes';
  end if;

  select * into v_delivery
    from family_schedule_reminder_deliveries d
   where d.id = p_delivery_id
     and d.member_id = v_member.id
   limit 1;
  if not found then
    raise exception 'schedule_reminder_not_found';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = v_delivery.schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.status = 'active';
  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_reminder_not_allowed';
  end if;

  v_scheduled_for := now() + (p_minutes * interval '1 minute');

  insert into family_schedule_reminder_deliveries (
    family_id,
    schedule_item_id,
    member_id,
    scheduled_for,
    reminder_kind,
    status,
    snoozed_from_delivery_id,
    snoozed_by_member_id,
    updated_at
  )
  values (
    v_delivery.family_id,
    v_delivery.schedule_item_id,
    v_member.id,
    v_scheduled_for,
    'snooze',
    'pending',
    v_delivery.id,
    v_member.id,
    now()
  )
  on conflict (schedule_item_id, member_id, scheduled_for)
  do update set
    status = 'pending',
    reminder_kind = 'snooze',
    skipped_reason = null,
    next_retry_at = null,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function ensure_overdue_schedule_reminders()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inserted int;
begin
  insert into family_schedule_reminder_deliveries (
    family_id,
    schedule_item_id,
    member_id,
    scheduled_for,
    reminder_kind,
    status,
    updated_at
  )
  select s.family_id,
         s.id,
         s.assignee_member_id,
         s.starts_at + interval '10 minutes',
         'overdue',
         'pending',
         now()
    from family_schedule_items s
    join family_members fm on fm.id = s.assignee_member_id
   where s.status = 'active'
     and s.deleted_at is null
     and s.starts_at <= now() - interval '10 minutes'
     and fm.status = 'active'
     and not exists (
       select 1 from family_schedule_reminder_deliveries d
        where d.schedule_item_id = s.id
          and d.member_id = s.assignee_member_id
          and d.reminder_kind = 'overdue'
     )
   order by s.starts_at asc
   limit 100
  on conflict (schedule_item_id, member_id, scheduled_for) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function get_schedule_reminder_health_for_member(
  p_member_id uuid,
  p_member_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_result jsonb;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if not v_member.is_admin then
    raise exception 'not_admin';
  end if;

  select jsonb_build_object(
    'pending', count(*) filter (where d.status = 'pending'),
    'sent', count(*) filter (where d.status = 'sent'),
    'failed', count(*) filter (where d.status = 'failed'),
    'gone', count(*) filter (where d.status = 'gone'),
    'skipped', count(*) filter (where d.status = 'skipped'),
    'private_failed', count(*) filter (where d.status = 'failed' and s.visibility = 'private'),
    'recentFailures',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'deliveryId', x.id,
          'status', x.status,
          'reminderKind', x.reminder_kind,
          'errorStatus', x.error_status,
          'attemptCount', x.attempt_count,
          'nextRetryAt', x.next_retry_at,
          'updatedAt', x.updated_at
        )
        order by x.updated_at desc
      )
        from (
          select d.*
            from family_schedule_reminder_deliveries d
            join family_schedule_items s on s.id = d.schedule_item_id
           where d.family_id = v_member.family_id
             and d.status in ('failed', 'gone')
             and s.visibility = 'family'
           order by d.updated_at desc
           limit 5
        ) x
    ), '[]'::jsonb)
  )
  into v_result
  from family_schedule_reminder_deliveries d
  join family_schedule_items s on s.id = d.schedule_item_id
  where d.family_id = v_member.family_id;

  return coalesce(v_result, jsonb_build_object(
    'pending', 0,
    'sent', 0,
    'failed', 0,
    'gone', 0,
    'skipped', 0,
    'private_failed', 0,
    'recentFailures', '[]'::jsonb
  ));
end;
$$;

grant execute on function set_schedule_reminder_rules(uuid, text, uuid, int[], text)
  to anon, authenticated;
grant execute on function snooze_schedule_reminder(uuid, text, uuid, int)
  to anon, authenticated;
grant execute on function ensure_overdue_schedule_reminders()
  to service_role;
grant execute on function get_schedule_reminder_health_for_member(uuid, text)
  to anon, authenticated;
