-- Restore multi-offset reminder generation while preserving assignment-aware
-- delivery audiences. Also keep reminder status focused on the current rules.

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
    select 1
      from family_schedule_reminder_rules r
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
         select greatest(
                  0,
                  round(extract(epoch from (v_item.starts_at - v_item.remind_at)) / 60)::int
                )
          where v_item.remind_at is not null
            and not exists (
              select 1
                from family_schedule_reminder_rules rr
               where rr.schedule_item_id = v_item.id
            )
       )
       select 1
         from offsets o
        where d.scheduled_for =
              v_item.starts_at - (o.offset_minutes * interval '1 minute')
     );

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = case
           when v_item.visibility = 'private'
             and d.member_id = v_item.assignee_member_id
             and d.member_id <> v_item.creator_member_id
             and v_item.assignee_response <> 'accepted'
           then 'assignment_not_accepted'
           else 'not_visible'
         end,
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
            or fm.id = v_item.creator_member_id
            or (
              fm.id = v_item.assignee_member_id
              and v_item.assignee_response = 'accepted'
            )
          )
     );

  insert into family_schedule_reminder_deliveries (
    family_id,
    schedule_item_id,
    member_id,
    scheduled_for,
    reminder_kind,
    status,
    delivered_at,
    last_attempt_at,
    attempt_count,
    next_retry_at,
    skipped_reason,
    error_status,
    error_message,
    updated_at
  )
  with offsets as (
    select r.offset_minutes
      from family_schedule_reminder_rules r
     where r.schedule_item_id = v_item.id
    union
    select greatest(
             0,
             round(extract(epoch from (v_item.starts_at - v_item.remind_at)) / 60)::int
           )
     where v_item.remind_at is not null
       and not exists (
         select 1
           from family_schedule_reminder_rules rr
          where rr.schedule_item_id = v_item.id
       )
  )
  select v_item.family_id,
         v_item.id,
         fm.id,
         v_item.starts_at - (o.offset_minutes * interval '1 minute'),
         'before_start',
         'pending',
         null,
         null,
         0,
         null,
         null,
         null,
         null,
         v_now
    from offsets o
    join family_members fm on fm.family_id = v_item.family_id
   where fm.status = 'active'
     and (
       v_item.visibility = 'family'
       or fm.id = v_item.creator_member_id
       or (
         fm.id = v_item.assignee_member_id
         and v_item.assignee_response = 'accepted'
       )
     )
  on conflict (schedule_item_id, member_id, scheduled_for)
  do update set
    reminder_kind = excluded.reminder_kind,
    status = excluded.status,
    delivered_at = null,
    last_attempt_at = null,
    attempt_count = 0,
    next_retry_at = null,
    skipped_reason = null,
    error_status = null,
    error_message = null,
    updated_at = excluded.updated_at
  where family_schedule_reminder_deliveries.reminder_kind = 'before_start'
    and family_schedule_reminder_deliveries.status = 'skipped'
    and family_schedule_reminder_deliveries.skipped_reason in (
      'assignment_not_accepted',
      'not_visible',
      'schedule_not_active',
      'reminder_not_configured',
      'reminder_changed'
    );
end;
$$;

revoke all on function ensure_schedule_reminder_deliveries(uuid)
  from public, anon, authenticated;
grant execute on function ensure_schedule_reminder_deliveries(uuid)
  to service_role;

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
  select * into v_member
    from current_member_from_token(p_member_id, p_member_token);
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

  with current_offsets as (
    select r.offset_minutes
      from family_schedule_reminder_rules r
     where r.schedule_item_id = v_item.id
    union
    select greatest(
             0,
             round(extract(epoch from (v_item.starts_at - v_item.remind_at)) / 60)::int
           )
     where v_item.remind_at is not null
       and not exists (
         select 1
           from family_schedule_reminder_rules rr
          where rr.schedule_item_id = v_item.id
       )
  ),
  visible_deliveries as (
    select d.*, fm.nickname
      from family_schedule_reminder_deliveries d
      join family_members fm on fm.id = d.member_id
     where d.schedule_item_id = v_item.id
       and fm.status = 'active'
       and (
         v_item.visibility = 'family'
         or d.member_id = v_item.creator_member_id
         or (
           d.member_id = v_item.assignee_member_id
           and v_item.assignee_response = 'accepted'
         )
       )
       and (
         v_can_view_members
         or d.member_id = v_member.id
       )
       and (
         (
           d.reminder_kind = 'before_start'
           and exists (
             select 1
               from current_offsets o
              where d.scheduled_for =
                    v_item.starts_at - (o.offset_minutes * interval '1 minute')
           )
         )
         or (
           d.reminder_kind = 'snooze'
           and not (
             d.status = 'skipped'
             and d.skipped_reason = 'snooze_replaced'
           )
         )
         or d.reminder_kind = 'overdue'
       )
  )
  select jsonb_build_object(
    'configured', exists (select 1 from current_offsets),
    'remind_at', v_item.remind_at,
    'rules', coalesce((
      select jsonb_agg(o.offset_minutes order by o.offset_minutes)
        from current_offsets o
    ), '[]'::jsonb),
    'current_member_delivery',
    (
      select jsonb_build_object(
        'id', d.id,
        'member_id', d.member_id,
        'nickname', d.nickname,
        'scheduled_for', d.scheduled_for,
        'reminder_kind', d.reminder_kind,
        'status', d.status,
        'attempt_count', d.attempt_count,
        'delivered_at', d.delivered_at,
        'last_attempt_at', d.last_attempt_at,
        'next_retry_at', d.next_retry_at,
        'skipped_reason', d.skipped_reason,
        'error_status', d.error_status,
        'error_message', case
          when d.error_message is null then null
          else 'schedule_reminder_failed'
        end,
        'updated_at', d.updated_at
      )
        from visible_deliveries d
       where d.member_id = v_member.id
       order by
         case
           when d.status in ('pending', 'processing', 'failed') then 0
           when d.status = 'sent' then 1
           else 2
         end,
         case
           when d.status in ('pending', 'processing', 'failed')
           then d.scheduled_for
         end asc nulls last,
         d.scheduled_for desc,
         d.created_at desc
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
          'reminder_kind', x.reminder_kind,
          'status', x.status,
          'attempt_count', x.attempt_count,
          'delivered_at', x.delivered_at,
          'last_attempt_at', x.last_attempt_at,
          'next_retry_at', x.next_retry_at,
          'skipped_reason', x.skipped_reason,
          'error_status', x.error_status,
          'error_message', case
            when x.error_message is null then null
            else 'schedule_reminder_failed'
          end,
          'updated_at', x.updated_at
        )
        order by x.scheduled_for desc, x.nickname asc, x.member_id asc
      )
        from (
          select *
            from visible_deliveries
           order by scheduled_for desc, nickname asc, member_id asc
           limit 100
        ) x
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function get_schedule_reminder_status_for_member(uuid, text, uuid)
  from public;
grant execute on function get_schedule_reminder_status_for_member(uuid, text, uuid)
  to anon, authenticated, service_role;

do $$
declare
  v_item_id uuid;
begin
  for v_item_id in
    select s.id
      from family_schedule_items s
     where s.deleted_at is null
       and s.status = 'active'
       and (
         s.remind_at is not null
         or exists (
           select 1
             from family_schedule_reminder_rules r
            where r.schedule_item_id = s.id
         )
       )
  loop
    perform ensure_schedule_reminder_deliveries(v_item_id);
  end loop;
end;
$$;

insert into app_schema_migrations (version, name, description)
values (
  '20260711184844_schedule_reminder_rule_consistency',
  'schedule_reminder_rule_consistency',
  'Restores multi-offset reminder delivery generation and returns only current reminder rules and deliveries.'
)
on conflict (version) do nothing;
