-- Lightweight realtime events for private message delivery.
-- Realtime emits only family/message ids; clients fetch message content through
-- token-checked RPCs.

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

  insert into message_realtime_events (family_id, message_id, event_type)
  values (new.family_id, new.id, v_event_type);

  delete from message_realtime_events
   where created_at < now() - interval '1 day';

  return new;
end;
$$;

drop trigger if exists trg_enqueue_message_realtime_event on messages;

create trigger trg_enqueue_message_realtime_event
after insert or update on messages
for each row
execute function enqueue_message_realtime_event();

drop function if exists get_message_for_member(uuid, text, uuid);

create or replace function get_message_for_member(
  p_member_id uuid,
  p_member_token text,
  p_message_id uuid
)
returns table (
  id uuid,
  family_id uuid,
  sender_member_id uuid,
  message_type text,
  content text,
  image_url text,
  audio_url text,
  audio_duration_ms int,
  latitude double precision,
  longitude double precision,
  address text,
  map_url text,
  effect_id text,
  effect_caption text,
  system_event_type text,
  system_event_payload jsonb,
  push_requested_at timestamptz,
  deleted_at timestamptz,
  deleted_by_member_id uuid,
  updated_at timestamptz,
  created_at timestamptz
)
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    return;
  end if;

  return query
  select m.id, m.family_id, m.sender_member_id, m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload, m.push_requested_at,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from messages m
   where m.id = p_message_id
     and m.family_id = v_member.family_id
   limit 1;
end;
$$;

grant execute on function get_message_for_member(uuid, text, uuid) to anon, authenticated;

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
end $$;
