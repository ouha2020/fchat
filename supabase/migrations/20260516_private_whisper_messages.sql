-- Private whisper messages: DB-first visibility for one-to-one messages.

-- Private whisper messages
-- =====================================================================

alter table messages
  add column if not exists recipient_member_id uuid references family_members(id);

create index if not exists messages_family_recipient_created_idx
  on messages (family_id, recipient_member_id, created_at desc);

drop function if exists send_message(
  uuid, text, text, text, text, text, int,
  double precision, double precision, text, text, text, text
);

create or replace function send_message(
  p_member_id uuid,
  p_member_token text,
  p_message_type text,
  p_content text default null,
  p_image_url text default null,
  p_audio_url text default null,
  p_audio_duration_ms int default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_address text default null,
  p_map_url text default null,
  p_effect_id text default null,
  p_effect_caption text default null,
  p_recipient_member_id uuid default null
)
returns uuid
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_recipient family_members%rowtype;
  v_message_id uuid;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if p_recipient_member_id is not null then
    if p_recipient_member_id = p_member_id then
      raise exception 'cannot_whisper_self';
    end if;

    select * into v_recipient
      from family_members
     where id = p_recipient_member_id
       and family_id = v_member.family_id
       and status = 'active';
    if not found then
      raise exception 'member_not_found';
    end if;
  end if;

  if p_message_type not in ('text', 'image', 'audio', 'location') then
    raise exception 'invalid_message_type';
  end if;
  if p_content is not null and (length(trim(p_content)) = 0 or length(p_content) > 1000) then
    raise exception 'message_too_long';
  end if;
  if length(coalesce(p_address, '')) > 500 or length(coalesce(p_effect_caption, '')) > 120 then
    raise exception 'message_too_long';
  end if;
  if p_image_url is not null and (
    length(p_image_url) > 2048 or p_image_url !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception 'invalid_image_url';
  end if;
  if p_audio_url is not null and (
    length(p_audio_url) > 2048 or p_audio_url !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception 'invalid_audio_url';
  end if;
  if p_map_url is not null and (
    length(p_map_url) > 2048 or p_map_url !~* '^https://[^[:space:]]+$'
  ) then
    raise exception 'invalid_location';
  end if;
  if p_message_type = 'text' and (p_content is null or length(trim(p_content)) = 0) then
    raise exception 'message_too_long';
  end if;
  if p_message_type = 'image' and p_image_url is null then
    raise exception 'invalid_image_url';
  end if;
  if p_message_type = 'audio' and (
    p_audio_url is null or p_audio_duration_ms is null or
    p_audio_duration_ms < 0 or p_audio_duration_ms > 600000
  ) then
    raise exception 'invalid_audio_url';
  end if;
  if p_message_type = 'location' and (
    p_latitude is null or p_longitude is null or
    p_latitude < -90 or p_latitude > 90 or
    p_longitude < -180 or p_longitude > 180
  ) then
    raise exception 'invalid_location';
  end if;
  if p_effect_id is not null and p_effect_id not in
       ('hearts', 'fireworks', 'confetti', 'money', 'sparkles', 'cake') then
    raise exception 'invalid_effect_id';
  end if;

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, image_url, audio_url, audio_duration_ms,
    latitude, longitude, address, map_url,
    effect_id, effect_caption
  )
  values (
    v_member.family_id, p_member_id, p_recipient_member_id, p_message_type,
    p_content, p_image_url, p_audio_url, p_audio_duration_ms,
    p_latitude, p_longitude, p_address, p_map_url,
    p_effect_id, p_effect_caption
  )
  returning id into v_message_id;

  update family_members
     set last_active_at = now(),
         last_seen_at = now(),
         updated_at = now()
   where id = p_member_id;

  return v_message_id;
end;
$$;

drop function if exists list_messages_for_member(uuid, text, int);

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
    from messages m
   where m.family_id = v_member.family_id
     and (
       m.recipient_member_id is null
       or m.sender_member_id = v_member.id
       or m.recipient_member_id = v_member.id
     )
   order by m.created_at desc
   limit v_limit;
end;
$$;

drop function if exists list_messages_delta(uuid, text, timestamptz, uuid, int);

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
    from messages m
   where m.family_id = v_member.family_id
     and (
       m.recipient_member_id is null
       or m.sender_member_id = v_member.id
       or m.recipient_member_id = v_member.id
     )
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
    from messages m
   where m.id = p_message_id
     and m.family_id = v_member.family_id
     and (
       m.recipient_member_id is null
       or m.sender_member_id = v_member.id
       or m.recipient_member_id = v_member.id
     )
   limit 1;
end;
$$;

create or replace function delete_message(
  p_member_id uuid,
  p_member_token text,
  p_message_id uuid
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_msg messages%rowtype;
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_msg
    from messages
   where id = p_message_id
     and family_id = v_member.family_id;
  if not found then
    raise exception 'message_not_found';
  end if;

  if v_msg.deleted_at is not null then
    return;
  end if;
  if v_msg.message_type = 'system' then
    raise exception 'cannot_delete_system';
  end if;
  if v_msg.recipient_member_id is not null then
    if v_msg.sender_member_id is distinct from p_member_id then
      raise exception 'not_allowed';
    end if;
  elsif v_msg.sender_member_id is distinct from p_member_id and not v_member.is_admin then
    raise exception 'not_allowed';
  end if;

  update messages
     set deleted_at = now(),
         deleted_by_member_id = p_member_id
   where id = p_message_id;

  update family_members
     set last_active_at = now()
   where id = p_member_id;
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

  select * into v_message
    from messages
   where id = p_message_id
     and family_id = v_member.family_id
     and (
       recipient_member_id is null
       or sender_member_id = v_member.id
       or recipient_member_id = v_member.id
     );
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

drop function if exists list_important_notifications_for_member(uuid, text);

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
   where n.family_id = v_member.family_id
     and n.removed_at is null
     and (
       m.recipient_member_id is null
       or m.sender_member_id = v_member.id
       or m.recipient_member_id = v_member.id
     )
   order by n.created_at desc;
end;
$$;

grant execute on function send_message(
  uuid, text, text, text, text, text, int,
  double precision, double precision, text, text, text, text, uuid
) to anon, authenticated;
grant execute on function list_messages_for_member(uuid, text, int) to anon, authenticated;
grant execute on function list_messages_delta(uuid, text, timestamptz, uuid, int) to anon, authenticated;
grant execute on function get_message_for_member(uuid, text, uuid) to anon, authenticated;
grant execute on function delete_message(uuid, text, uuid) to anon, authenticated;
grant execute on function add_important_notification(uuid, text, uuid) to anon, authenticated;
grant execute on function list_important_notifications_for_member(uuid, text) to anon, authenticated;
