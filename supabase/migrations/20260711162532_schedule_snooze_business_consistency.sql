-- Snoozing replaces the previous pending delivery. Private assignees may only
-- snooze after accepting responsibility for the schedule.

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
     and d.family_id = v_member.family_id
     and d.member_id = v_member.id
   for update;
  if not found then
    raise exception 'schedule_reminder_not_found';
  end if;
  if v_delivery.status not in ('pending', 'failed', 'sent') then
    raise exception 'schedule_reminder_not_allowed';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = v_delivery.schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.status = 'active'
   for update;
  if not found then
    raise exception 'schedule_reminder_not_allowed';
  end if;
  if not (
    v_item.visibility = 'family'
    or v_item.creator_member_id = v_member.id
    or (
      v_item.assignee_member_id = v_member.id
      and v_item.assignee_response = 'accepted'
    )
  ) then
    raise exception 'schedule_reminder_not_allowed';
  end if;

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = 'snooze_replaced',
         next_retry_at = null,
         error_status = null,
         error_message = null,
         updated_at = now()
   where d.schedule_item_id = v_item.id
     and d.member_id = v_member.id
     and d.reminder_kind = 'snooze'
     and d.status in ('pending', 'failed')
     and d.id <> v_delivery.id;

  if v_delivery.status in ('pending', 'failed') then
    update family_schedule_reminder_deliveries
       set status = 'skipped',
           skipped_reason = 'snoozed',
           next_retry_at = null,
           error_status = null,
           error_message = null,
           updated_at = now()
     where id = v_delivery.id;
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
    attempt_count = 0,
    delivered_at = null,
    last_attempt_at = null,
    next_retry_at = null,
    skipped_reason = null,
    error_status = null,
    error_message = null,
    snoozed_from_delivery_id = excluded.snoozed_from_delivery_id,
    snoozed_by_member_id = excluded.snoozed_by_member_id,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function snooze_schedule_reminder(uuid, text, uuid, int) from public;
grant execute on function snooze_schedule_reminder(uuid, text, uuid, int)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260711162532_schedule_snooze_business_consistency',
  'schedule_snooze_business_consistency',
  'Makes snooze replace pending deliveries and blocks private assignees who have not accepted responsibility.'
)
on conflict (version) do nothing;
