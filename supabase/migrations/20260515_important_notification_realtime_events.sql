-- Broadcast lightweight important-notification changes over Realtime.
-- Clients use these events only as invalidation signals, then fetch the
-- complete notification list through token-checked RPCs.

create table if not exists important_notification_realtime_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  notification_id uuid not null references important_notifications(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  event_type text not null check (event_type in ('add', 'remove')),
  created_at timestamptz not null default now()
);

create index if not exists important_notification_realtime_events_family_created_idx
  on important_notification_realtime_events (family_id, created_at desc);

create index if not exists important_notification_realtime_events_created_idx
  on important_notification_realtime_events (created_at);

alter table important_notification_realtime_events enable row level security;

revoke all on important_notification_realtime_events from anon, authenticated;
grant select on important_notification_realtime_events to anon, authenticated;

drop policy if exists "important notification realtime events are readable" on important_notification_realtime_events;
create policy "important notification realtime events are readable"
  on important_notification_realtime_events for select
  to anon, authenticated
  using (true);

create or replace function enqueue_important_notification_realtime_event()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'add';
  elsif tg_op = 'UPDATE' and old.removed_at is null and new.removed_at is not null then
    v_event_type := 'remove';
  else
    return new;
  end if;

  insert into important_notification_realtime_events (
    family_id, notification_id, message_id, event_type
  )
  values (
    new.family_id, new.id, new.message_id, v_event_type
  );

  delete from important_notification_realtime_events
   where created_at < now() - interval '1 day';

  return new;
end;
$$;

drop trigger if exists trg_enqueue_important_notification_realtime_event on important_notifications;

create trigger trg_enqueue_important_notification_realtime_event
after insert or update on important_notifications
for each row
execute function enqueue_important_notification_realtime_event();

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'important_notification_realtime_events'
  ) then
    execute 'alter publication supabase_realtime add table important_notification_realtime_events';
  end if;
end $$;
