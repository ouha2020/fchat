-- Stage 10: per-member schedule reminder deliveries.

create table if not exists family_schedule_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_item_id uuid not null references family_schedule_items(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'pending',
  attempt_count int not null default 0,
  delivered_at timestamptz,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  skipped_reason text,
  error_status int,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_item_id, member_id, scheduled_for)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_reminder_deliveries_status_check'
       and conrelid = 'family_schedule_reminder_deliveries'::regclass
  ) then
    alter table family_schedule_reminder_deliveries
      add constraint family_schedule_reminder_deliveries_status_check
      check (status in ('pending', 'sent', 'skipped', 'failed', 'gone'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_reminder_deliveries_attempt_count_check'
       and conrelid = 'family_schedule_reminder_deliveries'::regclass
  ) then
    alter table family_schedule_reminder_deliveries
      add constraint family_schedule_reminder_deliveries_attempt_count_check
      check (attempt_count >= 0);
  end if;
end;
$$;

create index if not exists family_schedule_reminder_deliveries_due_idx
  on family_schedule_reminder_deliveries (status, scheduled_for)
  where status = 'pending';

create index if not exists family_schedule_reminder_deliveries_retry_idx
  on family_schedule_reminder_deliveries (status, next_retry_at)
  where status = 'failed';

create index if not exists family_schedule_reminder_deliveries_item_idx
  on family_schedule_reminder_deliveries (schedule_item_id, scheduled_for desc);

create index if not exists family_schedule_reminder_deliveries_member_idx
  on family_schedule_reminder_deliveries (member_id, scheduled_for desc);

alter table family_schedule_reminder_deliveries enable row level security;
revoke all on family_schedule_reminder_deliveries from anon, authenticated;

drop policy if exists "family schedule reminder deliveries are rpc only"
  on family_schedule_reminder_deliveries;

create policy "family schedule reminder deliveries are rpc only"
  on family_schedule_reminder_deliveries for select
  to anon, authenticated
  using (false);

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
  v_seed_status text;
begin
  select * into v_item
    from family_schedule_items
   where id = p_schedule_item_id;

  if not found then
    return;
  end if;

  if v_item.remind_at is null
     or v_item.deleted_at is not null
     or v_item.status <> 'active' then
    update family_schedule_reminder_deliveries d
       set status = 'skipped',
           skipped_reason = case
             when v_item.remind_at is null then 'reminder_not_configured'
             else 'schedule_not_active'
           end,
           updated_at = v_now
     where d.schedule_item_id = v_item.id
       and d.status in ('pending', 'failed');
    return;
  end if;

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = 'reminder_changed',
         updated_at = v_now
   where d.schedule_item_id = v_item.id
     and d.status in ('pending', 'failed')
     and d.scheduled_for is distinct from v_item.remind_at;

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = 'not_visible',
         updated_at = v_now
   where d.schedule_item_id = v_item.id
     and d.status in ('pending', 'failed')
     and d.scheduled_for = v_item.remind_at
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

  v_seed_status := case when v_item.reminded_at is null then 'pending' else 'sent' end;

  insert into family_schedule_reminder_deliveries (
    family_id,
    schedule_item_id,
    member_id,
    scheduled_for,
    status,
    delivered_at,
    last_attempt_at,
    attempt_count,
    updated_at
  )
  select v_item.family_id,
         v_item.id,
         fm.id,
         v_item.remind_at,
         v_seed_status,
         case when v_seed_status = 'sent' then v_item.reminded_at else null end,
         case when v_seed_status = 'sent' then v_item.reminded_at else null end,
         case when v_seed_status = 'sent' then 1 else 0 end,
         v_now
    from family_members fm
   where fm.family_id = v_item.family_id
     and fm.status = 'active'
     and (
       v_item.visibility = 'family'
       or fm.id in (v_item.creator_member_id, v_item.assignee_member_id)
     )
  on conflict (schedule_item_id, member_id, scheduled_for) do nothing;
end;
$$;

create or replace function sync_schedule_reminder_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform ensure_schedule_reminder_deliveries(new.id);
  return new;
end;
$$;

drop trigger if exists trg_sync_schedule_reminder_deliveries
  on family_schedule_items;

create trigger trg_sync_schedule_reminder_deliveries
after insert or update of remind_at, reminded_at, status, deleted_at, visibility, assignee_member_id
on family_schedule_items
for each row
execute function sync_schedule_reminder_deliveries();

do $$
declare
  v_item_id uuid;
begin
  for v_item_id in
    select id from family_schedule_items
     where remind_at is not null
  loop
    perform ensure_schedule_reminder_deliveries(v_item_id);
  end loop;
end;
$$;

create or replace function get_schedule_reminder_status_for_member(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_can_view_members boolean;
  v_result jsonb;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null;

  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_reminder_not_allowed';
  end if;

  perform ensure_schedule_reminder_deliveries(v_item.id);

  v_can_view_members := v_item.creator_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin);

  select jsonb_build_object(
    'configured', v_item.remind_at is not null,
    'remind_at', v_item.remind_at,
    'current_member_delivery',
    (
      select jsonb_build_object(
        'id', d.id,
        'member_id', d.member_id,
        'nickname', fm.nickname,
        'scheduled_for', d.scheduled_for,
        'status', d.status,
        'attempt_count', d.attempt_count,
        'delivered_at', d.delivered_at,
        'last_attempt_at', d.last_attempt_at,
        'next_retry_at', d.next_retry_at,
        'skipped_reason', d.skipped_reason,
        'error_status', d.error_status,
        'error_message', case when d.error_message is null then null else 'schedule_reminder_failed' end,
        'updated_at', d.updated_at
      )
        from family_schedule_reminder_deliveries d
        join family_members fm on fm.id = d.member_id
       where d.schedule_item_id = v_item.id
         and d.member_id = v_member.id
       order by d.scheduled_for desc, d.created_at desc
       limit 1
    ),
    'deliveries',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'member_id', x.member_id,
          'nickname', x.nickname,
          'scheduled_for', x.scheduled_for,
          'status', x.status,
          'attempt_count', x.attempt_count,
          'delivered_at', x.delivered_at,
          'last_attempt_at', x.last_attempt_at,
          'next_retry_at', x.next_retry_at,
          'skipped_reason', x.skipped_reason,
          'error_status', x.error_status,
          'error_message', case when x.error_message is null then null else 'schedule_reminder_failed' end,
          'updated_at', x.updated_at
        )
        order by x.scheduled_for desc, x.nickname asc, x.member_id asc
      )
        from (
          select d.*, fm.nickname
            from family_schedule_reminder_deliveries d
            join family_members fm on fm.id = d.member_id
           where d.schedule_item_id = v_item.id
             and (
               v_can_view_members
               or d.member_id = v_member.id
             )
           order by d.scheduled_for desc, fm.nickname asc, d.member_id asc
           limit 100
        ) x
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function ensure_schedule_reminder_deliveries(uuid)
  to anon, authenticated;
grant execute on function get_schedule_reminder_status_for_member(uuid, text, uuid)
  to anon, authenticated;
