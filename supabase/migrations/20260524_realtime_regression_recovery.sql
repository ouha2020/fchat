-- Restore realtime invalidation coverage for schedule reminder state changes.

alter table family_schedule_events
  drop constraint if exists family_schedule_events_event_type_check;

alter table family_schedule_events
  add constraint family_schedule_events_event_type_check
  check (event_type in (
    'created',
    'updated',
    'status_changed',
    'deleted',
    'reminder_updated',
    'commented',
    'comment_deleted',
    'assignment_responded',
    'activity_added'
  ));

create or replace function enqueue_schedule_realtime_events()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'created';

    insert into family_schedule_events (
      family_id, schedule_item_id, recipient_member_id, event_type
    )
    select new.family_id, new.id, recipients.member_id, v_event_type
      from (
        select distinct fm.id as member_id
          from family_members fm
         where fm.family_id = new.family_id
           and fm.status = 'active'
           and (
             new.visibility = 'family'
             or fm.id in (new.creator_member_id, new.assignee_member_id)
           )
      ) recipients;

    delete from family_schedule_events
     where created_at < now() - interval '1 day';

    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    v_event_type := 'deleted';
  elsif old.status is distinct from new.status and new.status = 'cancelled' then
    v_event_type := 'deleted';
  elsif old.status is distinct from new.status then
    v_event_type := 'status_changed';
  elsif old.remind_at is distinct from new.remind_at
     or old.reminded_at is distinct from new.reminded_at
     or old.reminder_push_attempted_at is distinct from new.reminder_push_attempted_at
     or old.reminder_push_error is distinct from new.reminder_push_error then
    v_event_type := 'reminder_updated';
  elsif old.title is distinct from new.title
     or old.note is distinct from new.note
     or old.item_type is distinct from new.item_type
     or old.visibility is distinct from new.visibility
     or old.starts_at is distinct from new.starts_at
     or old.ends_at is distinct from new.ends_at
     or old.assignee_member_id is distinct from new.assignee_member_id then
    v_event_type := 'updated';
  else
    return new;
  end if;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select new.family_id, new.id, recipients.member_id, v_event_type
    from (
      select distinct fm.id as member_id
        from family_members fm
       where fm.family_id = new.family_id
         and fm.status = 'active'
         and (
           (
             new.visibility = 'family'
             or fm.id in (new.creator_member_id, new.assignee_member_id)
           )
           or (
             old.visibility = 'family'
             or fm.id in (old.creator_member_id, old.assignee_member_id)
           )
         )
    ) recipients;

  delete from family_schedule_events
   where created_at < now() - interval '1 day';

  return new;
end;
$$;

create or replace function enqueue_schedule_reminder_delivery_realtime_event()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending'
       and new.attempt_count = 0
       and new.delivered_at is null
       and new.last_attempt_at is null
       and new.next_retry_at is null
       and new.skipped_reason is null
       and new.error_status is null
       and new.error_message is null then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if row(
      old.status,
      old.attempt_count,
      old.delivered_at,
      old.last_attempt_at,
      old.next_retry_at,
      old.skipped_reason,
      old.error_status,
      old.error_message
    ) is not distinct from row(
      new.status,
      new.attempt_count,
      new.delivered_at,
      new.last_attempt_at,
      new.next_retry_at,
      new.skipped_reason,
      new.error_status,
      new.error_message
    ) then
      return new;
    end if;
  else
    return new;
  end if;

  perform enqueue_schedule_event_for_visible_members(
    new.schedule_item_id,
    'reminder_updated'
  );

  return new;
end;
$$;

revoke all on function enqueue_schedule_reminder_delivery_realtime_event()
  from public;

drop trigger if exists trg_schedule_reminder_delivery_realtime_event
  on family_schedule_reminder_deliveries;

create trigger trg_schedule_reminder_delivery_realtime_event
after insert or update of status, attempt_count, delivered_at, last_attempt_at,
  next_retry_at, skipped_reason, error_status, error_message
on family_schedule_reminder_deliveries
for each row
execute function enqueue_schedule_reminder_delivery_realtime_event();

insert into app_schema_migrations (version, name, description)
values (
  '20260524_realtime_regression_recovery',
  'realtime_regression_recovery',
  'Restores 30-second fallback compatible realtime invalidation for schedule reminder deliveries.'
)
on conflict (version) do nothing;
