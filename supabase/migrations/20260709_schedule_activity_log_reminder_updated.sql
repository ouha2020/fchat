-- Allow schedule reminder edits to be written to the activity timeline.
-- update_schedule_item_with_recurrence logs reminder changes as `reminder_updated`,
-- so the activity log check constraint must accept that value.

alter table family_schedule_activity_logs
  drop constraint if exists family_schedule_activity_logs_type_check;

alter table family_schedule_activity_logs
  add constraint family_schedule_activity_logs_type_check
  check (activity_type in (
    'created',
    'updated',
    'assigned',
    'accepted',
    'declined',
    'commented',
    'completed',
    'restored',
    'deleted',
    'reminder_changed',
    'reminder_updated',
    'visibility_changed'
  ));
