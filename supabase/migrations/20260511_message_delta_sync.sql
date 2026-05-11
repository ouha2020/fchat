-- Phase 1 local-first message sync.
-- Adds a business updated_at cursor and a token-checked delta RPC.

alter table messages
  add column if not exists updated_at timestamptz;

update messages
   set updated_at = coalesce(deleted_at, created_at, now())
 where updated_at is null;

alter table messages
  alter column updated_at set default now(),
  alter column updated_at set not null;

create index if not exists messages_family_updated_id_idx
  on messages (family_id, updated_at asc, id asc);

create or replace function set_messages_business_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
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
      new.deleted_at,
      new.deleted_by_member_id,
      new.created_at
    ) then
      new.updated_at := old.updated_at;
    else
      new.updated_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_messages_business_updated_at on messages;

create trigger trg_messages_business_updated_at
before update on messages
for each row
execute function set_messages_business_updated_at();

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
  v_limit int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 300);

  return query
  select m.id, m.family_id, m.sender_member_id, m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption, m.push_requested_at,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from messages m
   where m.family_id = v_member.family_id
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
  v_limit int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 300), 1), 300);

  return query
  select m.id, m.family_id, m.sender_member_id, m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption, m.push_requested_at,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from messages m
   where m.family_id = v_member.family_id
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

grant execute on function list_messages_for_member(uuid, text, int) to anon, authenticated;
grant execute on function list_messages_delta(uuid, text, timestamptz, uuid, int) to anon, authenticated;

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
  message_deleted_at timestamptz,
  message_deleted_by_member_id uuid,
  message_updated_at timestamptz,
  message_created_at timestamptz
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
    raise exception 'unauthorized';
  end if;

  return query
  select n.id, n.family_id, n.message_id, n.created_by_member_id,
         n.removed_at, n.removed_by_member_id, n.created_at,
         m.family_id, m.sender_member_id, m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from important_notifications n
    join messages m on m.id = n.message_id and m.family_id = n.family_id
   where n.family_id = v_member.family_id
     and n.removed_at is null
   order by n.created_at desc;
end;
$$;

grant execute on function list_important_notifications_for_member(uuid, text) to anon, authenticated;
