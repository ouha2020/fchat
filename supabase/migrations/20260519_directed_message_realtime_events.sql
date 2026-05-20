create table if not exists message_realtime_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  event_type text not null check (event_type in ('insert', 'update')),
  created_at timestamptz not null default now()
);

create index if not exists message_realtime_events_family_created_idx
  on message_realtime_events (family_id, created_at desc);

create index if not exists message_realtime_events_created_idx
  on message_realtime_events (created_at);

alter table message_realtime_events
  add column if not exists recipient_member_id uuid references family_members(id) on delete cascade;

create index if not exists message_realtime_events_recipient_created_idx
  on message_realtime_events (recipient_member_id, created_at desc);

alter table message_realtime_events enable row level security;

revoke all on message_realtime_events from anon, authenticated;
grant select on message_realtime_events to anon, authenticated;

drop policy if exists "message realtime events are readable" on message_realtime_events;
create policy "message realtime events are readable"
  on message_realtime_events for select
  to anon, authenticated
  using (true);

create or replace function enqueue_message_realtime_event()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_event_type text;
begin
  if tg_op = 'UPDATE' then
    if row(
      old.family_id,
      old.sender_member_id,
      old.message_type,
      old.content,
      old.image_url,
      old.audio_url,
      old.audio_duration_ms,
      old.latitude,
      old.longitude,
      old.address,
      old.map_url,
      old.effect_id,
      old.effect_caption,
      old.system_event_type,
      old.system_event_payload,
      old.deleted_at,
      old.deleted_by_member_id,
      old.created_at
    ) is not distinct from row(
      new.family_id,
      new.sender_member_id,
      new.message_type,
      new.content,
      new.image_url,
      new.audio_url,
      new.audio_duration_ms,
      new.latitude,
      new.longitude,
      new.address,
      new.map_url,
      new.effect_id,
      new.effect_caption,
      new.system_event_type,
      new.system_event_payload,
      new.deleted_at,
      new.deleted_by_member_id,
      new.created_at
    ) then
      return new;
    end if;

    v_event_type := 'update';
  else
    v_event_type := 'insert';
  end if;

  insert into message_realtime_events (
    family_id, message_id, recipient_member_id, event_type
  )
  select new.family_id, new.id, mr.member_id, v_event_type
    from message_recipients mr
   where mr.message_id = new.id
     and mr.family_id = new.family_id
     and mr.member_id is not null
  on conflict do nothing;

  delete from message_realtime_events
   where created_at < now() - interval '1 day';

  return new;
end;
$$;

drop trigger if exists trg_enqueue_message_realtime_event on messages;
drop trigger if exists trg_20_enqueue_message_realtime_event on messages;

create trigger trg_20_enqueue_message_realtime_event
after insert or update on messages
for each row
execute function enqueue_message_realtime_event();

drop trigger if exists trg_populate_message_recipients on messages;
drop trigger if exists trg_10_populate_message_recipients on messages;

create trigger trg_10_populate_message_recipients
after insert on messages
for each row
execute function populate_message_recipients_for_message();

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'message_realtime_events'
  ) then
    execute 'alter publication supabase_realtime add table message_realtime_events';
  end if;
end;
$$;
