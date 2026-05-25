create table if not exists message_recipients (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  delivery_state text not null default 'pending',
  delivered_at timestamptz,
  read_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, member_id)
);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'message_recipients_delivery_state_check'
       and conrelid = 'message_recipients'::regclass
  ) then
    alter table message_recipients
      add constraint message_recipients_delivery_state_check
      check (delivery_state in ('pending', 'delivered', 'read'));
  end if;
end;
$$;

create index if not exists message_recipients_member_created_idx
  on message_recipients (member_id, created_at desc);

create index if not exists message_recipients_member_message_idx
  on message_recipients (member_id, message_id);

create index if not exists message_recipients_family_message_idx
  on message_recipients (family_id, message_id);

create index if not exists message_recipients_member_read_idx
  on message_recipients (member_id, read_at);

alter table message_recipients enable row level security;

revoke all on message_recipients from anon, authenticated;

drop policy if exists "message recipients are rpc only" on message_recipients;

create or replace function populate_message_recipients_for_message()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
begin
  if new.recipient_member_id is null then
    insert into message_recipients (family_id, message_id, member_id)
    select new.family_id, new.id, fm.id
      from family_members fm
     where fm.family_id = new.family_id
       and fm.status = 'active'
    on conflict (message_id, member_id) do nothing;
  else
    insert into message_recipients (family_id, message_id, member_id)
    select new.family_id, new.id, fm.id
      from family_members fm
     where fm.family_id = new.family_id
       and fm.id in (new.sender_member_id, new.recipient_member_id)
    on conflict (message_id, member_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_populate_message_recipients on messages;

create trigger trg_populate_message_recipients
after insert on messages
for each row
execute function populate_message_recipients_for_message();

insert into message_recipients (family_id, message_id, member_id)
select m.family_id, m.id, fm.id
  from messages m
  join family_members fm
    on fm.family_id = m.family_id
   and fm.status = 'active'
 where m.recipient_member_id is null
on conflict (message_id, member_id) do nothing;

insert into message_recipients (family_id, message_id, member_id)
select m.family_id, m.id, fm.id
  from messages m
  join family_members fm
    on fm.family_id = m.family_id
   and fm.id in (m.sender_member_id, m.recipient_member_id)
 where m.recipient_member_id is not null
on conflict (message_id, member_id) do nothing;

create or replace function list_messages_for_member(
  p_member_id uuid,
  p_member_token text,
  p_limit int default 100
)
returns table (
  id uuid,
  family_id uuid,
  sender_member_id uuid,
  recipient_member_id uuid,
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
#variable_conflict use_column
declare
  v_member record;
  v_limit int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 300);

  return query
  select m.id, m.family_id, m.sender_member_id, m.recipient_member_id,
         m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload, m.push_requested_at,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from message_recipients mr
    join messages m on m.id = mr.message_id and m.family_id = mr.family_id
   where mr.member_id = v_member.id
   order by m.created_at desc, m.id desc
   limit v_limit;
end;
$$;

create or replace function list_messages_delta(
  p_member_id uuid,
  p_member_token text,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit int default 300
)
returns table (
  id uuid,
  family_id uuid,
  sender_member_id uuid,
  recipient_member_id uuid,
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
#variable_conflict use_column
declare
  v_member record;
  v_limit int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 300), 1), 300);

  return query
  select m.id, m.family_id, m.sender_member_id, m.recipient_member_id,
         m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload, m.push_requested_at,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from message_recipients mr
    join messages m on m.id = mr.message_id and m.family_id = mr.family_id
   where mr.member_id = v_member.id
     and (
       p_cursor_updated_at is null
       or p_cursor_id is null
       or m.updated_at > p_cursor_updated_at
       or (m.updated_at = p_cursor_updated_at and m.id > p_cursor_id)
     )
   order by m.updated_at asc, m.id asc
   limit v_limit;
end;
$$;

create or replace function get_message_for_member(
  p_member_id uuid,
  p_member_token text,
  p_message_id uuid
)
returns table (
  id uuid,
  family_id uuid,
  sender_member_id uuid,
  recipient_member_id uuid,
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
#variable_conflict use_column
declare
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    return;
  end if;

  return query
  select m.id, m.family_id, m.sender_member_id, m.recipient_member_id,
         m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload, m.push_requested_at,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from message_recipients mr
    join messages m on m.id = mr.message_id and m.family_id = mr.family_id
   where mr.member_id = v_member.id
     and m.id = p_message_id
   limit 1;
end;
$$;

create or replace function get_messages_by_ids_for_member(
  p_member_id uuid,
  p_member_token text,
  p_message_ids uuid[]
)
returns table (
  id uuid,
  family_id uuid,
  sender_member_id uuid,
  recipient_member_id uuid,
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
#variable_conflict use_column
declare
  v_member record;
  v_count int;
begin
  if p_message_ids is null or cardinality(p_message_ids) = 0 then
    return;
  end if;

  v_count := cardinality(p_message_ids);
  if v_count > 100 then
    raise exception 'too_many_message_ids';
  end if;

  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    return;
  end if;

  return query
  select m.id, m.family_id, m.sender_member_id, m.recipient_member_id,
         m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload, m.push_requested_at,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from message_recipients mr
    join messages m on m.id = mr.message_id and m.family_id = mr.family_id
   where mr.member_id = v_member.id
     and m.id in (
       select distinct requested.message_id
         from unnest(p_message_ids) as requested(message_id)
        where requested.message_id is not null
     )
   order by m.created_at asc, m.id asc;
end;
$$;

create or replace function add_important_notification(
  p_member_id uuid,
  p_member_token text,
  p_message_id uuid
)
returns uuid
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_message messages%rowtype;
  v_notification_id uuid;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select m.* into v_message
    from message_recipients mr
    join messages m on m.id = mr.message_id and m.family_id = mr.family_id
   where mr.member_id = v_member.id
     and m.id = p_message_id
     and m.family_id = v_member.family_id;
  if not found then
    raise exception 'message_not_found';
  end if;
  if v_message.recipient_member_id is not null then
    raise exception 'private_message_not_allowed';
  end if;

  select id into v_notification_id
    from important_notifications
   where family_id = v_member.family_id
     and message_id = p_message_id
     and removed_at is null
   limit 1;

  if v_notification_id is not null then
    return v_notification_id;
  end if;

  insert into important_notifications (
    family_id, message_id, created_by_member_id
  )
  values (
    v_member.family_id, p_message_id, p_member_id
  )
  returning id into v_notification_id;

  update family_members
     set last_active_at = now()
   where id = p_member_id;

  return v_notification_id;
end;
$$;

create or replace function list_important_notifications_for_member(
  p_member_id uuid,
  p_member_token text
)
returns table (
  id uuid,
  family_id uuid,
  message_id uuid,
  created_by_member_id uuid,
  removed_at timestamptz,
  removed_by_member_id uuid,
  created_at timestamptz,
  message_family_id uuid,
  message_sender_member_id uuid,
  message_recipient_member_id uuid,
  message_type text,
  message_content text,
  message_image_url text,
  message_audio_url text,
  message_audio_duration_ms int,
  message_latitude double precision,
  message_longitude double precision,
  message_address text,
  message_map_url text,
  message_effect_id text,
  message_effect_caption text,
  message_system_event_type text,
  message_system_event_payload jsonb,
  message_deleted_at timestamptz,
  message_deleted_by_member_id uuid,
  message_updated_at timestamptz,
  message_created_at timestamptz
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  return query
  select n.id, n.family_id, n.message_id, n.created_by_member_id,
         n.removed_at, n.removed_by_member_id, n.created_at,
         m.family_id, m.sender_member_id, m.recipient_member_id,
         m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from important_notifications n
    join messages m on m.id = n.message_id and m.family_id = n.family_id
    join message_recipients mr
      on mr.message_id = m.id
     and mr.family_id = m.family_id
     and mr.member_id = v_member.id
   where n.family_id = v_member.family_id
     and n.removed_at is null
     and m.recipient_member_id is null
   order by n.created_at desc;
end;
$$;

grant execute on function list_messages_for_member(uuid, text, int) to anon, authenticated;
grant execute on function list_messages_delta(uuid, text, timestamptz, uuid, int) to anon, authenticated;
grant execute on function get_message_for_member(uuid, text, uuid) to anon, authenticated;
grant execute on function get_messages_by_ids_for_member(uuid, text, uuid[]) to anon, authenticated;
grant execute on function add_important_notification(uuid, text, uuid) to anon, authenticated;
grant execute on function list_important_notifications_for_member(uuid, text) to anon, authenticated;
