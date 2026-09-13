-- Do not create overdue reminders for long-abandoned schedule items. Delivery
-- workers apply their own tighter freshness rules before sending Push.

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
     and s.assignee_response = 'accepted'
     and s.starts_at <= now() - interval '10 minutes'
     and s.starts_at >= now() - interval '24 hours'
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

revoke all on function ensure_overdue_schedule_reminders()
  from public, anon, authenticated;
grant execute on function ensure_overdue_schedule_reminders()
  to service_role;

insert into app_schema_migrations (version, name, description)
values (
  '20260711174308_schedule_reminder_stale_guard',
  'schedule_reminder_stale_guard',
  'Limits overdue generation to the last 24 hours and keeps the internal RPC service-role only.'
)
on conflict (version) do nothing;
