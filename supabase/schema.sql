-- Family Chat MVP schema for Supabase / PostgreSQL
-- Run this in the Supabase SQL editor in order from top to bottom.

create extension if not exists "pgcrypto";

-- =====================================================================
-- Tables
-- =====================================================================

create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  family_code text unique not null,
  admin_password_hash text not null,
  join_enabled boolean not null default true,
  created_by_member_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  nickname text not null,
  role text not null check (role in ('father', 'mother', 'child')),
  member_token_hash text not null,
  is_admin boolean not null default false,
  status text not null default 'active' check (status in ('active', 'removed')),
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nicknames must be unique only among active members so that a removed
-- member can be re-invited with the same nickname later.
create unique index if not exists family_members_active_nickname_idx
  on family_members (family_id, nickname)
  where status = 'active';

create index if not exists family_members_family_id_idx
  on family_members (family_id);

-- Realtime UPDATE events (used for kicking removed members) need full row payloads.
alter table family_members replica identity full;

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  sender_member_id uuid references family_members(id) on delete set null,
  message_type text not null check (
    message_type in ('text', 'image', 'audio', 'location', 'system')
  ),
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
  deleted_by_member_id uuid references family_members(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Realtime UPDATE events need full row payloads (e.g. for delete_message).
alter table messages replica identity full;

create index if not exists messages_family_id_created_at_idx
  on messages (family_id, created_at desc);

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

create table if not exists important_notifications (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  created_by_member_id uuid references family_members(id) on delete set null,
  removed_at timestamptz,
  removed_by_member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists important_notifications_active_message_idx
  on important_notifications (family_id, message_id)
  where removed_at is null;

create index if not exists important_notifications_family_created_at_idx
  on important_notifications (family_id, created_at desc)
  where removed_at is null;

alter table important_notifications replica identity full;

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text not null default 'unknown'
    check (platform in ('ios', 'android', 'desktop', 'unknown')),
  enabled boolean not null default true,
  messages_enabled boolean not null default true,
  location_enabled boolean not null default true,
  important_enabled boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, endpoint)
);

create index if not exists push_subscriptions_family_member_idx
  on push_subscriptions (family_id, member_id)
  where enabled = true;

create table if not exists user_presence (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  current_page text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, member_id)
);

create index if not exists user_presence_family_active_idx
  on user_presence (family_id, current_page, is_active, last_seen_at desc);

-- =====================================================================
-- Helpers
-- =====================================================================

create or replace function gen_family_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  attempt int := 0;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(
        alphabet,
        1 + floor(random() * length(alphabet))::int,
        1
      );
    end loop;

    exit when not exists (select 1 from families where family_code = code);

    attempt := attempt + 1;
    if attempt > 25 then
      raise exception 'Could not generate unique family code';
    end if;
  end loop;

  return code;
end;
$$;

create or replace function hash_secret(secret text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(secret, 'sha256'), 'hex');
$$;

-- =====================================================================
-- RPC: create family
-- Creates a family, an admin member, and returns identifiers + token.
-- =====================================================================

create or replace function create_family(
  p_family_name text,
  p_admin_password text,
  p_nickname text,
  p_role text
)
returns table (
  family_id uuid,
  family_code text,
  member_id uuid,
  member_token text,
  is_admin boolean
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_family_id uuid;
  v_code text;
  v_member_id uuid;
  v_token text;
begin
  if p_family_name is null or length(trim(p_family_name)) = 0 then
    raise exception 'family_name_required';
  end if;
  if p_admin_password is null or length(p_admin_password) < 4 then
    raise exception 'admin_password_too_short';
  end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 then
    raise exception 'nickname_required';
  end if;
  if p_role not in ('father', 'mother', 'child') then
    raise exception 'invalid_role';
  end if;

  v_code := gen_family_code();
  v_token := encode(gen_random_bytes(24), 'hex');

  insert into families (name, family_code, admin_password_hash)
  values (trim(p_family_name), v_code, hash_secret(p_admin_password))
  returning id into v_family_id;

  insert into family_members (
    family_id, nickname, role, member_token_hash, is_admin
  )
  values (
    v_family_id, trim(p_nickname), p_role, hash_secret(v_token), true
  )
  returning id into v_member_id;

  update families
     set created_by_member_id = v_member_id
   where id = v_family_id;

  insert into messages (family_id, message_type, content)
  values (
    v_family_id,
    'system',
    '瀹跺涵宸插垱寤猴紝娆㈣繋鏉ュ埌銆? || trim(p_family_name) || '銆?
  );

  return query
  select v_family_id, v_code, v_member_id, v_token, true;
end;
$$;

-- =====================================================================
-- RPC: join family
-- =====================================================================

create or replace function join_family(
  p_family_code text,
  p_nickname text,
  p_role text
)
returns table (
  family_id uuid,
  family_name text,
  member_id uuid,
  member_token text,
  is_admin boolean
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_family families%rowtype;
  v_member_id uuid;
  v_token text;
  v_clean_nickname text;
begin
  if p_family_code is null or length(trim(p_family_code)) = 0 then
    raise exception 'family_code_required';
  end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 then
    raise exception 'nickname_required';
  end if;
  if p_role not in ('father', 'mother', 'child') then
    raise exception 'invalid_role';
  end if;

  v_clean_nickname := trim(p_nickname);

  select * into v_family
    from families
   where families.family_code = upper(trim(p_family_code))
   limit 1;

  if not found then
    raise exception 'family_not_found';
  end if;

  if exists (
    select 1
      from family_members fm
     where fm.family_id = v_family.id
       and fm.nickname = v_clean_nickname
       and fm.status in ('active', 'removed')
  ) then
    raise exception 'nickname_taken';
  end if;

  if not v_family.join_enabled then
    raise exception 'join_disabled';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into family_members (
    family_id, nickname, role, member_token_hash, is_admin
  )
  values (
    v_family.id, v_clean_nickname, p_role, hash_secret(v_token), false
  )
  returning id into v_member_id;

  insert into messages (family_id, message_type, content)
  values (
    v_family.id,
    'system',
    v_clean_nickname || ' 鍔犲叆浜嗗搴?
  );

  return query
  select v_family.id, v_family.name, v_member_id, v_token, false;
end;
$$;

-- =====================================================================
-- RPC: reclaim an existing nickname with the family admin password
-- Lets a family re-enter from a new browser/device when the nickname already exists.
-- =====================================================================

drop function if exists rejoin_family_member(text, text, text);

create or replace function rejoin_family_member(
  p_family_code text,
  p_nickname text,
  p_admin_password text
)
returns table (
  family_id uuid,
  family_name text,
  family_code text,
  member_id uuid,
  member_token text,
  nickname text,
  role text,
  is_admin boolean
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_family families%rowtype;
  v_member family_members%rowtype;
  v_clean_nickname text;
  v_token text;
begin
  if p_family_code is null or length(trim(p_family_code)) = 0 then
    raise exception 'family_code_required';
  end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 then
    raise exception 'nickname_required';
  end if;
  if p_admin_password is null or length(p_admin_password) = 0 then
    raise exception 'invalid_admin_password';
  end if;

  v_clean_nickname := trim(p_nickname);

  select * into v_family
    from families
   where families.family_code = upper(trim(p_family_code))
   limit 1;

  if not found then
    raise exception 'family_not_found';
  end if;

  if v_family.admin_password_hash <> hash_secret(p_admin_password) then
    raise exception 'invalid_admin_password';
  end if;

  select * into v_member
    from family_members fm
   where fm.family_id = v_family.id
     and fm.nickname = v_clean_nickname
     and fm.status in ('active', 'removed')
   order by fm.is_admin desc, fm.created_at
   limit 1;

  if not found then
    raise exception 'member_not_found';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  update messages
     set sender_member_id = v_member.id
   where sender_member_id in (
     select id
       from family_members fm
      where fm.family_id = v_family.id
        and fm.nickname = v_clean_nickname
        and fm.id <> v_member.id
   );

  update messages
     set deleted_by_member_id = v_member.id
   where deleted_by_member_id in (
     select id
       from family_members fm
      where fm.family_id = v_family.id
        and fm.nickname = v_clean_nickname
        and fm.id <> v_member.id
   );

  update important_notifications
     set created_by_member_id = v_member.id
   where created_by_member_id in (
     select id
       from family_members fm
      where fm.family_id = v_family.id
        and fm.nickname = v_clean_nickname
        and fm.id <> v_member.id
   );

  update important_notifications
     set removed_by_member_id = v_member.id
   where removed_by_member_id in (
     select id
       from family_members fm
      where fm.family_id = v_family.id
        and fm.nickname = v_clean_nickname
        and fm.id <> v_member.id
   );

  update family_members
     set status = 'removed',
         updated_at = now()
   where family_id = v_family.id
     and nickname = v_clean_nickname
     and id <> v_member.id
     and status = 'active';

  update family_members
     set status = 'active',
         member_token_hash = hash_secret(v_token),
         last_active_at = now(),
         updated_at = now()
   where id = v_member.id;

  return query
  select v_family.id,
         v_family.name,
         v_family.family_code,
         v_member.id,
         v_token,
         v_member.nickname,
         v_member.role,
         v_member.is_admin;
end;
$$;

-- =====================================================================
-- RPC: validate session token (used on app startup)
-- =====================================================================

create or replace function validate_member(
  p_member_id uuid,
  p_member_token text
)
returns table (
  member_id uuid,
  family_id uuid,
  family_name text,
  family_code text,
  nickname text,
  role text,
  is_admin boolean
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
begin
  return query
  select fm.id,
         f.id,
         f.name,
         f.family_code,
         fm.nickname,
         fm.role,
         fm.is_admin
    from family_members fm
    join families f on f.id = fm.family_id
   where fm.id = p_member_id
     and fm.member_token_hash = hash_secret(p_member_token)
     and fm.status = 'active';

  if not found then
    return;
  end if;

  update family_members
     set last_active_at = now()
   where id = p_member_id;
end;
$$;

-- =====================================================================
-- RPC: send a message (validates token before insert)
-- =====================================================================

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
  p_effect_caption text default null
)
returns uuid
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
  v_message_id uuid;
begin
  if p_message_type not in ('text', 'image', 'audio', 'location') then
    raise exception 'invalid_message_type';
  end if;
  if length(coalesce(p_content, '')) > 2000 then
    raise exception 'message_too_long';
  end if;
  if length(coalesce(p_address, '')) > 500 then
    raise exception 'message_too_long';
  end if;
  if length(coalesce(p_effect_caption, '')) > 120 then
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

  select family_id into v_family_id
    from family_members
   where id = p_member_id
     and member_token_hash = hash_secret(p_member_token)
     and status = 'active';

  if v_family_id is null then
    raise exception 'unauthorized';
  end if;

  insert into messages (
    family_id, sender_member_id, message_type,
    content, image_url, audio_url, audio_duration_ms,
    latitude, longitude, address, map_url,
    effect_id, effect_caption
  )
  values (
    v_family_id, p_member_id, p_message_type,
    p_content, p_image_url, p_audio_url, p_audio_duration_ms,
    p_latitude, p_longitude, p_address, p_map_url,
    p_effect_id, p_effect_caption
  )
  returning id into v_message_id;

  update family_members
     set last_active_at = now()
   where id = p_member_id;

  return v_message_id;
end;
$$;

-- =====================================================================
-- RPC: admin actions
-- =====================================================================

create or replace function require_admin(
  p_member_id uuid,
  p_member_token text,
  p_admin_password text
)
returns uuid
language plpgsql
as $$
declare
  v_family_id uuid;
  v_password_hash text;
  v_is_admin boolean;
begin
  select fm.family_id, fm.is_admin, f.admin_password_hash
    into v_family_id, v_is_admin, v_password_hash
    from family_members fm
    join families f on f.id = fm.family_id
   where fm.id = p_member_id
     and fm.member_token_hash = hash_secret(p_member_token)
     and fm.status = 'active';

  if v_family_id is null then
    raise exception 'unauthorized';
  end if;
  if not v_is_admin then
    raise exception 'not_admin';
  end if;
  if v_password_hash <> hash_secret(p_admin_password) then
    raise exception 'invalid_admin_password';
  end if;

  return v_family_id;
end;
$$;

create or replace function update_family_name(
  p_member_id uuid,
  p_member_token text,
  p_admin_password text,
  p_new_name text
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
begin
  if p_new_name is null or length(trim(p_new_name)) = 0 then
    raise exception 'family_name_required';
  end if;

  v_family_id := require_admin(p_member_id, p_member_token, p_admin_password);

  update families
     set name = trim(p_new_name),
         updated_at = now()
   where id = v_family_id;

  insert into messages (family_id, message_type, content)
  values (v_family_id, 'system', '瀹跺涵鍚嶇О宸叉洿鏂颁负銆? || trim(p_new_name) || '銆?);
end;
$$;

create or replace function reset_family_code(
  p_member_id uuid,
  p_member_token text,
  p_admin_password text
)
returns text
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
  v_new_code text;
begin
  v_family_id := require_admin(p_member_id, p_member_token, p_admin_password);
  v_new_code := gen_family_code();

  update families
     set family_code = v_new_code,
         updated_at = now()
   where id = v_family_id;

  insert into messages (family_id, message_type, content)
  values (v_family_id, 'system', '瀹跺涵浠ｇ爜宸查噸缃?);

  return v_new_code;
end;
$$;

create or replace function set_join_enabled(
  p_member_id uuid,
  p_member_token text,
  p_admin_password text,
  p_join_enabled boolean
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
begin
  v_family_id := require_admin(p_member_id, p_member_token, p_admin_password);

  update families
     set join_enabled = p_join_enabled,
         updated_at = now()
   where id = v_family_id;

  insert into messages (family_id, message_type, content)
  values (
    v_family_id,
    'system',
    case when p_join_enabled then '绠＄悊鍛樺紑鍚簡鏂版垚鍛樺姞鍏?
         else '绠＄悊鍛樺叧闂簡鏂版垚鍛樺姞鍏? end
  );
end;
$$;

create or replace function remove_member(
  p_member_id uuid,
  p_member_token text,
  p_target_member_id uuid
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_caller family_members%rowtype;
  v_target family_members%rowtype;
begin
  select * into v_caller
    from family_members
   where id = p_member_id
     and member_token_hash = hash_secret(p_member_token)
     and status = 'active';
  if not found then
    raise exception 'unauthorized';
  end if;
  if not v_caller.is_admin then
    raise exception 'not_admin';
  end if;
  if v_caller.id = p_target_member_id then
    raise exception 'cannot_remove_self';
  end if;

  select * into v_target
    from family_members
   where id = p_target_member_id
     and family_id = v_caller.family_id
     and status = 'active';
  if not found then
    raise exception 'member_not_found';
  end if;

  update family_members
     set status = 'removed',
         updated_at = now()
   where id = p_target_member_id;

  insert into messages (family_id, message_type, content)
  values (
    v_caller.family_id,
    'system',
    v_target.nickname || ' 宸茶绉诲嚭瀹跺涵'
  );
end;
$$;

create or replace function leave_family(
  p_member_id uuid,
  p_member_token text
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_member family_members%rowtype;
  v_active_admin_count int;
begin
  select * into v_member
    from family_members
   where id = p_member_id
     and member_token_hash = hash_secret(p_member_token)
     and status = 'active';

  if not found then
    raise exception 'unauthorized';
  end if;

  if v_member.is_admin then
    select count(*) into v_active_admin_count
      from family_members
     where family_id = v_member.family_id
       and is_admin = true
       and status = 'active';

    if v_active_admin_count <= 1 then
      raise exception 'last_admin_cannot_leave';
    end if;
  end if;

  update family_members
     set status = 'removed',
         updated_at = now()
   where id = p_member_id;

  insert into messages (family_id, message_type, content)
  values (
    v_member.family_id,
    'system',
    v_member.nickname || ' 绂诲紑浜嗗搴?
  );
end;
$$;

-- =====================================================================
-- Grants for RPC functions
-- =====================================================================

grant execute on function create_family(text, text, text, text) to anon, authenticated;
grant execute on function join_family(text, text, text) to anon, authenticated;
grant execute on function rejoin_family_member(text, text, text) to anon, authenticated;
grant execute on function validate_member(uuid, text) to anon, authenticated;
grant execute on function send_message(uuid, text, text, text, text, text, int, double precision, double precision, text, text, text, text) to anon, authenticated;

-- =====================================================================
-- RPC: soft-delete a message (sender or family admin)
-- =====================================================================

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
declare
  v_msg messages%rowtype;
  v_member family_members%rowtype;
begin
  select * into v_member
    from family_members
   where id = p_member_id
     and member_token_hash = hash_secret(p_member_token)
     and status = 'active';
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
  if v_msg.sender_member_id <> p_member_id and not v_member.is_admin then
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

grant execute on function delete_message(uuid, text, uuid) to anon, authenticated;

-- =====================================================================
-- RPC: shared important notifications
-- =====================================================================

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
declare
  v_member family_members%rowtype;
  v_message messages%rowtype;
  v_notification_id uuid;
begin
  select * into v_member
    from family_members
   where id = p_member_id
     and member_token_hash = hash_secret(p_member_token)
     and status = 'active';
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_message
    from messages
   where id = p_message_id
     and family_id = v_member.family_id;
  if not found then
    raise exception 'message_not_found';
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

create or replace function remove_important_notification(
  p_member_id uuid,
  p_member_token text,
  p_notification_id uuid
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_member family_members%rowtype;
  v_notification important_notifications%rowtype;
begin
  select * into v_member
    from family_members
   where id = p_member_id
     and member_token_hash = hash_secret(p_member_token)
     and status = 'active';
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_notification
    from important_notifications
   where id = p_notification_id
     and family_id = v_member.family_id;
  if not found then
    raise exception 'important_notification_not_found';
  end if;

  if v_notification.removed_at is null then
    update important_notifications
       set removed_at = now(),
           removed_by_member_id = p_member_id
     where id = p_notification_id;
  end if;

  update family_members
     set last_active_at = now()
   where id = p_member_id;
end;
$$;

grant execute on function add_important_notification(uuid, text, uuid) to anon, authenticated;
grant execute on function remove_important_notification(uuid, text, uuid) to anon, authenticated;
grant execute on function update_family_name(uuid, text, text, text) to anon, authenticated;
grant execute on function reset_family_code(uuid, text, text) to anon, authenticated;
grant execute on function set_join_enabled(uuid, text, text, boolean) to anon, authenticated;
grant execute on function remove_member(uuid, text, uuid) to anon, authenticated;
grant execute on function leave_family(uuid, text) to anon, authenticated;
-- =====================================================================
-- Row Level Security
--
-- Writes always go through the SECURITY DEFINER RPCs above; we only need
-- to allow anon to SELECT messages/members so Realtime + member-list work.
-- The RPCs validate member_token, and family rows hide the password hash
-- via the dedicated `families_public` view.
-- =====================================================================

alter table families        enable row level security;
alter table family_members  enable row level security;
alter table messages        enable row level security;
alter table important_notifications enable row level security;
alter table push_subscriptions enable row level security;
alter table user_presence enable row level security;

drop policy if exists "messages are readable by anon" on messages;
create policy "messages are readable by anon"
  on messages for select
  to anon, authenticated
  using (true);

drop policy if exists "members are readable by anon" on family_members;
create policy "members are readable by anon"
  on family_members for select
  to anon, authenticated
  using (true);

drop policy if exists "important notifications are readable by anon" on important_notifications;
create policy "important notifications are readable by anon"
  on important_notifications for select
  to anon, authenticated
  using (true);

grant select on important_notifications to anon, authenticated;

revoke all on push_subscriptions from anon, authenticated;
revoke all on user_presence from anon, authenticated;

-- Families table contains the password hash, so we expose a view instead.
create or replace view families_public as
  select id, name, family_code, join_enabled, created_at, updated_at
    from families;

grant select on families_public to anon, authenticated;

-- =====================================================================
-- Realtime publication
-- =====================================================================

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table messages';
  end if;
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and tablename = 'family_members'
  ) then
    execute 'alter publication supabase_realtime add table family_members';
  end if;
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and tablename = 'important_notifications'
  ) then
    execute 'alter publication supabase_realtime add table important_notifications';
  end if;
end
$$;

-- =====================================================================
-- Storage bucket for chat images
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do nothing;

drop policy if exists "chat-images public read" on storage.objects;
create policy "chat-images public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'chat-images');

drop policy if exists "chat-images anon upload" on storage.objects;
create policy "chat-images anon upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'chat-images');

insert into storage.buckets (id, name, public)
values ('chat-audios', 'chat-audios', true)
on conflict (id) do nothing;

drop policy if exists "chat-audios public read" on storage.objects;
create policy "chat-audios public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'chat-audios');

drop policy if exists "chat-audios anon upload" on storage.objects;
create policy "chat-audios anon upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'chat-audios');

-- =====================================================================
-- Security hardening: family-code access model
-- =====================================================================

-- Harden the family-code access model without adding account/password auth.

create extension if not exists "pgcrypto";

alter table families
  add column if not exists code_updated_at timestamptz not null default now(),
  add column if not exists code_expires_at timestamptz;

alter table family_members
  add column if not exists access_token_hash text,
  add column if not exists device_id text,
  add column if not exists last_seen_at timestamptz;

update families
   set code_updated_at = coalesce(code_updated_at, updated_at, created_at, now())
 where code_updated_at is null;

update family_members
   set access_token_hash = coalesce(access_token_hash, member_token_hash),
       last_seen_at = coalesce(last_seen_at, last_active_at, now())
 where access_token_hash is null
    or last_seen_at is null;

create unique index if not exists family_members_access_token_hash_idx
  on family_members (access_token_hash)
  where access_token_hash is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'families_family_code_format'
       and conrelid = 'families'::regclass
  ) then
    alter table families
      add constraint families_family_code_format
      check (family_code ~ '^[A-Z0-9]{6,12}$');
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_members_nickname_length'
       and conrelid = 'family_members'::regclass
  ) then
    alter table family_members
      add constraint family_members_nickname_length
      check (length(trim(nickname)) between 1 and 20);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'messages_text_length'
       and conrelid = 'messages'::regclass
  ) then
    alter table messages
      add constraint messages_text_length
      check (
        length(coalesce(content, '')) <= 1000
        and length(coalesce(address, '')) <= 500
        and length(coalesce(effect_caption, '')) <= 120
      );
  end if;
end
$$;

create table if not exists join_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  family_code_prefix text,
  success boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists join_attempts_ip_created_at_idx
  on join_attempts (ip_hash, created_at desc);

alter table join_attempts enable row level security;
revoke all on join_attempts from anon, authenticated;

create or replace function gen_family_code()
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  attempt int := 0;
  v_byte int;
begin
  loop
    code := '';
    for i in 1..8 loop
      v_byte := get_byte(gen_random_bytes(1), 0);
      code := code || substr(alphabet, (v_byte % length(alphabet)) + 1, 1);
    end loop;

    exit when not exists (select 1 from families where family_code = code);

    attempt := attempt + 1;
    if attempt > 25 then
      raise exception 'family_code_generation_failed';
    end if;
  end loop;

  return code;
end;
$$;

create or replace function request_ip_hash()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_headers jsonb := '{}'::jsonb;
  v_ip text;
begin
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_headers := '{}'::jsonb;
  end;

  v_ip := coalesce(
    nullif(trim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(trim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
    nullif(trim(v_headers ->> 'x-real-ip'), ''),
    'unknown'
  );

  return hash_secret(v_ip);
end;
$$;

create or replace function assert_join_rate_limit()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip_hash text;
  v_minute_count int;
  v_hour_count int;
begin
  v_ip_hash := request_ip_hash();

  select count(*) into v_minute_count
    from join_attempts
   where ip_hash = v_ip_hash
     and success = false
     and created_at > now() - interval '1 minute';

  select count(*) into v_hour_count
    from join_attempts
   where ip_hash = v_ip_hash
     and success = false
     and created_at > now() - interval '1 hour';

  if v_minute_count >= 5 or v_hour_count >= 30 then
    raise exception 'rate_limited';
  end if;

  return v_ip_hash;
end;
$$;

create or replace function record_join_attempt(
  p_ip_hash text,
  p_family_code text,
  p_success boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into join_attempts (ip_hash, family_code_prefix, success)
  values (
    coalesce(p_ip_hash, request_ip_hash()),
    case
      when p_family_code is null then null
      else left(upper(trim(p_family_code)), 2)
    end,
    p_success
  );
end;
$$;

drop function if exists resolve_join_family_state(text, text);

create or replace function resolve_join_family_state(
  p_family_code text,
  p_nickname text
)
returns table (
  status text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_family families%rowtype;
  v_clean_code text;
  v_clean_nickname text;
  v_ip_hash text;
begin
  begin
    v_ip_hash := assert_join_rate_limit();
  exception when others then
    if sqlerrm like '%rate_limited%' then
      return query select 'rate_limited'::text;
      return;
    end if;
    raise;
  end;

  v_clean_code := upper(trim(coalesce(p_family_code, '')));
  v_clean_nickname := trim(coalesce(p_nickname, ''));

  if v_clean_code !~ '^[A-Z0-9]{6,12}$' then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    return query select 'invalid_family_code'::text;
    return;
  end if;

  if length(v_clean_nickname) = 0 or length(v_clean_nickname) > 20 then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    return query select 'nickname_required'::text;
    return;
  end if;

  select * into v_family
    from families
   where families.family_code = v_clean_code
     and (families.code_expires_at is null or families.code_expires_at > now())
   limit 1;

  if not found or not v_family.join_enabled then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    return query select 'invalid_family_code'::text;
    return;
  end if;

  if exists (
    select 1
      from family_members fm
     where fm.family_id = v_family.id
       and fm.nickname = v_clean_nickname
       and fm.status in ('active', 'removed')
  ) then
    return query select 'rejoin_required'::text;
    return;
  end if;

  return query select 'can_join'::text;
end;
$$;

create or replace function current_member_from_token(
  p_member_id uuid,
  p_member_token text
)
returns table (
  id uuid,
  family_id uuid,
  nickname text,
  role text,
  is_admin boolean
)
language sql
security definer
set search_path = public, extensions
as $$
  select fm.id, fm.family_id, fm.nickname, fm.role, fm.is_admin
    from family_members fm
   where fm.id = p_member_id
     and fm.status = 'active'
     and (
       fm.access_token_hash = hash_secret(p_member_token)
       or fm.member_token_hash = hash_secret(p_member_token)
     )
   limit 1;
$$;

drop function if exists create_family(text, text, text, text);
drop function if exists create_family(text, text, text, text, text);

create or replace function create_family(
  p_family_name text,
  p_admin_password text,
  p_nickname text,
  p_role text,
  p_device_id text default null
)
returns table (
  family_id uuid,
  family_code text,
  member_id uuid,
  member_token text,
  is_admin boolean
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_family_id uuid;
  v_code text;
  v_member_id uuid;
  v_token text;
begin
  if p_family_name is null or length(trim(p_family_name)) = 0 or length(trim(p_family_name)) > 30 then
    raise exception 'family_name_required';
  end if;
  if p_admin_password is null or length(p_admin_password) < 4 or length(p_admin_password) > 128 then
    raise exception 'admin_password_too_short';
  end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 or length(trim(p_nickname)) > 20 then
    raise exception 'nickname_required';
  end if;
  if p_role not in ('father', 'mother', 'child') then
    raise exception 'invalid_role';
  end if;

  v_code := gen_family_code();
  v_token := gen_random_uuid()::text;

  insert into families (name, family_code, admin_password_hash, code_updated_at)
  values (trim(p_family_name), v_code, hash_secret(p_admin_password), now())
  returning id into v_family_id;

  insert into family_members (
    family_id, nickname, role, member_token_hash, access_token_hash,
    device_id, is_admin, last_active_at, last_seen_at
  )
  values (
    v_family_id, trim(p_nickname), p_role, hash_secret(v_token),
    hash_secret(v_token), nullif(trim(coalesce(p_device_id, '')), ''),
    true, now(), now()
  )
  returning id into v_member_id;

  update families
     set created_by_member_id = v_member_id
   where id = v_family_id;

  insert into messages (family_id, message_type, content)
  values (v_family_id, 'system', '瀹跺涵宸插垱寤猴紝娆㈣繋鏉ュ埌銆? || trim(p_family_name) || '銆?);

  return query
  select v_family_id, v_code, v_member_id, v_token, true;
end;
$$;

drop function if exists join_family(text, text, text);
drop function if exists join_family(text, text, text, text);

create or replace function join_family(
  p_family_code text,
  p_nickname text,
  p_role text,
  p_device_id text default null
)
returns table (
  family_id uuid,
  family_name text,
  family_code text,
  member_id uuid,
  member_token text,
  is_admin boolean
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_family families%rowtype;
  v_member_id uuid;
  v_token text;
  v_clean_code text;
  v_clean_nickname text;
  v_ip_hash text;
begin
  v_ip_hash := assert_join_rate_limit();
  v_clean_code := upper(trim(coalesce(p_family_code, '')));
  v_clean_nickname := trim(coalesce(p_nickname, ''));

  if v_clean_code !~ '^[A-Z0-9]{6,12}$' then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_family_code';
  end if;
  if length(v_clean_nickname) = 0 or length(v_clean_nickname) > 20 then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'nickname_required';
  end if;
  if p_role not in ('father', 'mother', 'child') then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_role';
  end if;

  select * into v_family
    from families
   where families.family_code = v_clean_code
     and (families.code_expires_at is null or families.code_expires_at > now())
   limit 1;

  if not found or not v_family.join_enabled then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_family_code';
  end if;

  if exists (
    select 1
      from family_members fm
     where fm.family_id = v_family.id
       and fm.nickname = v_clean_nickname
       and fm.status in ('active', 'removed')
  ) then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'nickname_taken';
  end if;

  v_token := gen_random_uuid()::text;

  insert into family_members (
    family_id, nickname, role, member_token_hash, access_token_hash,
    device_id, is_admin, last_active_at, last_seen_at
  )
  values (
    v_family.id, v_clean_nickname, p_role, hash_secret(v_token),
    hash_secret(v_token), nullif(trim(coalesce(p_device_id, '')), ''),
    false, now(), now()
  )
  returning id into v_member_id;

  perform record_join_attempt(v_ip_hash, v_clean_code, true);

  insert into messages (family_id, message_type, content)
  values (v_family.id, 'system', v_clean_nickname || ' 鍔犲叆浜嗗搴?);

  return query
  select v_family.id, v_family.name, v_family.family_code, v_member_id, v_token, false;
end;
$$;

drop function if exists rejoin_family_member(text, text, text);
drop function if exists rejoin_family_member(text, text, text, text);

create or replace function rejoin_family_member(
  p_family_code text,
  p_nickname text,
  p_admin_password text,
  p_device_id text default null
)
returns table (
  family_id uuid,
  family_name text,
  family_code text,
  member_id uuid,
  member_token text,
  nickname text,
  role text,
  is_admin boolean
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_family families%rowtype;
  v_member family_members%rowtype;
  v_clean_code text;
  v_clean_nickname text;
  v_token text;
  v_ip_hash text;
begin
  v_ip_hash := assert_join_rate_limit();
  v_clean_code := upper(trim(coalesce(p_family_code, '')));
  v_clean_nickname := trim(coalesce(p_nickname, ''));

  if v_clean_code !~ '^[A-Z0-9]{6,12}$' then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_family_code';
  end if;
  if length(v_clean_nickname) = 0 or length(v_clean_nickname) > 20 then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'nickname_required';
  end if;
  if p_admin_password is null or length(p_admin_password) = 0 or length(p_admin_password) > 128 then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_family_code';
  end if;

  select * into v_family
    from families
   where families.family_code = v_clean_code
     and (families.code_expires_at is null or families.code_expires_at > now())
   limit 1;

  if not found or v_family.admin_password_hash <> hash_secret(p_admin_password) then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_family_code';
  end if;

  select * into v_member
    from family_members fm
   where fm.family_id = v_family.id
     and fm.nickname = v_clean_nickname
     and fm.status in ('active', 'removed')
   order by fm.is_admin desc, fm.created_at
   limit 1;

  if not found then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_family_code';
  end if;

  v_token := gen_random_uuid()::text;

  update messages
     set sender_member_id = v_member.id
   where sender_member_id in (
     select id from family_members fm
      where fm.family_id = v_family.id
        and fm.nickname = v_clean_nickname
        and fm.id <> v_member.id
   );

  update messages
     set deleted_by_member_id = v_member.id
   where deleted_by_member_id in (
     select id from family_members fm
      where fm.family_id = v_family.id
        and fm.nickname = v_clean_nickname
        and fm.id <> v_member.id
   );

  update important_notifications
     set created_by_member_id = v_member.id
   where created_by_member_id in (
     select id from family_members fm
      where fm.family_id = v_family.id
        and fm.nickname = v_clean_nickname
        and fm.id <> v_member.id
   );

  update important_notifications
     set removed_by_member_id = v_member.id
   where removed_by_member_id in (
     select id from family_members fm
      where fm.family_id = v_family.id
        and fm.nickname = v_clean_nickname
        and fm.id <> v_member.id
   );

  update family_members
     set status = 'removed',
         updated_at = now()
   where family_id = v_family.id
     and nickname = v_clean_nickname
     and id <> v_member.id
     and status = 'active';

  update family_members
     set status = 'active',
         member_token_hash = hash_secret(v_token),
         access_token_hash = hash_secret(v_token),
         device_id = nullif(trim(coalesce(p_device_id, '')), ''),
         last_active_at = now(),
         last_seen_at = now(),
         updated_at = now()
   where id = v_member.id;

  perform record_join_attempt(v_ip_hash, v_clean_code, true);

  return query
  select v_family.id, v_family.name, v_family.family_code,
         v_member.id, v_token, v_member.nickname, v_member.role, v_member.is_admin;
end;
$$;

drop function if exists validate_member(uuid, text);
drop function if exists validate_member(uuid, text, text);

create or replace function validate_member(
  p_member_id uuid,
  p_member_token text,
  p_device_id text default null
)
returns table (
  member_id uuid,
  family_id uuid,
  family_name text,
  family_code text,
  nickname text,
  role text,
  is_admin boolean,
  device_id text
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
begin
  update family_members fm
     set last_active_at = now(),
         last_seen_at = now(),
         device_id = coalesce(nullif(trim(coalesce(p_device_id, '')), ''), fm.device_id),
         updated_at = now()
   where fm.id = p_member_id
     and fm.status = 'active'
     and (
       fm.access_token_hash = hash_secret(p_member_token)
       or fm.member_token_hash = hash_secret(p_member_token)
     );

  return query
  select fm.id,
         f.id,
         f.name,
         f.family_code,
         fm.nickname,
         fm.role,
         fm.is_admin,
         fm.device_id
    from family_members fm
    join families f on f.id = fm.family_id
   where fm.id = p_member_id
     and fm.status = 'active'
     and (
       fm.access_token_hash = hash_secret(p_member_token)
       or fm.member_token_hash = hash_secret(p_member_token)
     );
end;
$$;

create or replace function get_family_settings_for_member(
  p_member_id uuid,
  p_member_token text
)
returns table (
  family_id uuid,
  family_name text,
  family_code text,
  join_enabled boolean,
  code_updated_at timestamptz,
  code_expires_at timestamptz
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
  select f.id, f.name, f.family_code, f.join_enabled, f.code_updated_at, f.code_expires_at
    from families f
   where f.id = v_member.family_id;
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

create or replace function list_family_members_for_member(
  p_member_id uuid,
  p_member_token text,
  p_include_removed boolean default false
)
returns table (
  id uuid,
  family_id uuid,
  nickname text,
  role text,
  is_admin boolean,
  status text,
  last_active_at timestamptz
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
  select fm.id, fm.family_id, fm.nickname, fm.role, fm.is_admin,
         fm.status, fm.last_active_at
    from family_members fm
   where fm.family_id = v_member.family_id
     and (p_include_removed or fm.status = 'active')
   order by fm.created_at asc;
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
  p_effect_caption text default null
)
returns uuid
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_member record;
  v_message_id uuid;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
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
    family_id, sender_member_id, message_type,
    content, image_url, audio_url, audio_duration_ms,
    latitude, longitude, address, map_url,
    effect_id, effect_caption
  )
  values (
    v_member.family_id, p_member_id, p_message_type,
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

create or replace function require_admin(
  p_member_id uuid,
  p_member_token text,
  p_admin_password text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_member record;
  v_password_hash text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if not v_member.is_admin then
    raise exception 'not_admin';
  end if;

  select admin_password_hash into v_password_hash
    from families
   where id = v_member.family_id;

  if v_password_hash <> hash_secret(p_admin_password) then
    raise exception 'invalid_admin_password';
  end if;

  return v_member.family_id;
end;
$$;

create or replace function reset_family_code(
  p_member_id uuid,
  p_member_token text,
  p_admin_password text
)
returns text
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
  v_new_code text;
begin
  v_family_id := require_admin(p_member_id, p_member_token, p_admin_password);
  v_new_code := gen_family_code();

  update families
     set family_code = v_new_code,
         code_updated_at = now(),
         code_expires_at = null,
         updated_at = now()
   where id = v_family_id;

  insert into messages (family_id, message_type, content)
  values (v_family_id, 'system', '瀹跺涵浠ｇ爜宸查噸缃?);

  return v_new_code;
end;
$$;

grant execute on function create_family(text, text, text, text, text) to anon, authenticated;
grant execute on function resolve_join_family_state(text, text) to anon, authenticated;
grant execute on function join_family(text, text, text, text) to anon, authenticated;
grant execute on function rejoin_family_member(text, text, text, text) to anon, authenticated;
grant execute on function validate_member(uuid, text, text) to anon, authenticated;
grant execute on function get_family_settings_for_member(uuid, text) to anon, authenticated;
grant execute on function list_messages_for_member(uuid, text, int) to anon, authenticated;
grant execute on function list_messages_delta(uuid, text, timestamptz, uuid, int) to anon, authenticated;
grant execute on function list_family_members_for_member(uuid, text, boolean) to anon, authenticated;
grant execute on function list_important_notifications_for_member(uuid, text) to anon, authenticated;
grant execute on function send_message(uuid, text, text, text, text, text, int, double precision, double precision, text, text, text, text) to anon, authenticated;

drop policy if exists "messages are readable by anon" on messages;
create policy "messages require RPC"
  on messages for select
  to anon, authenticated
  using (false);

drop policy if exists "members are readable by anon" on family_members;
create policy "members require RPC"
  on family_members for select
  to anon, authenticated
  using (false);

drop policy if exists "important notifications are readable by anon" on important_notifications;
create policy "important notifications require RPC"
  on important_notifications for select
  to anon, authenticated
  using (false);

revoke select on messages from anon, authenticated;
revoke select on family_members from anon, authenticated;
revoke select on important_notifications from anon, authenticated;

drop view if exists families_public;
create or replace view families_public
with (security_invoker = true) as
  select id, name, join_enabled, created_at, updated_at
    from families;
revoke all on families_public from anon, authenticated;

drop policy if exists "chat-images anon upload" on storage.objects;
drop policy if exists "chat-audios anon upload" on storage.objects;



-- =====================================================================
-- Revoke public table grants
-- =====================================================================

-- Public clients should only use SECURITY DEFINER RPCs; no direct table access.

revoke all on families from anon, authenticated;
revoke all on family_members from anon, authenticated;
revoke all on messages from anon, authenticated;
revoke all on important_notifications from anon, authenticated;
revoke all on join_attempts from anon, authenticated;

grant execute on function create_family(text, text, text, text, text) to anon, authenticated;
grant execute on function resolve_join_family_state(text, text) to anon, authenticated;
grant execute on function join_family(text, text, text, text) to anon, authenticated;
grant execute on function rejoin_family_member(text, text, text, text) to anon, authenticated;
grant execute on function validate_member(uuid, text, text) to anon, authenticated;
grant execute on function get_family_settings_for_member(uuid, text) to anon, authenticated;
grant execute on function list_messages_for_member(uuid, text, int) to anon, authenticated;
grant execute on function list_messages_delta(uuid, text, timestamptz, uuid, int) to anon, authenticated;
grant execute on function list_family_members_for_member(uuid, text, boolean) to anon, authenticated;
grant execute on function list_important_notifications_for_member(uuid, text) to anon, authenticated;
grant execute on function send_message(uuid, text, text, text, text, text, int, double precision, double precision, text, text, text, text) to anon, authenticated;
grant execute on function delete_message(uuid, text, uuid) to anon, authenticated;
grant execute on function add_important_notification(uuid, text, uuid) to anon, authenticated;
grant execute on function remove_important_notification(uuid, text, uuid) to anon, authenticated;
grant execute on function update_family_name(uuid, text, text, text) to anon, authenticated;
grant execute on function reset_family_code(uuid, text, text) to anon, authenticated;
grant execute on function set_join_enabled(uuid, text, text, boolean) to anon, authenticated;
grant execute on function remove_member(uuid, text, uuid) to anon, authenticated;
grant execute on function leave_family(uuid, text) to anon, authenticated;


-- =====================================================================
-- Structured system messages
-- =====================================================================

-- Store system messages as stable events plus small display payloads.
-- This keeps old clients readable through content while new clients render
-- localized text from system_event_type/system_event_payload.

alter table messages
  add column if not exists system_event_type text,
  add column if not exists system_event_payload jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'messages_system_event_type_check'
       and conrelid = 'messages'::regclass
  ) then
    alter table messages
      add constraint messages_system_event_type_check
      check (
        system_event_type is null
        or system_event_type in (
          'family_created',
          'member_joined',
          'family_renamed',
          'family_code_reset',
          'join_enabled',
          'join_disabled',
          'member_removed',
          'member_left'
        )
      );
  end if;
end $$;

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

create or replace function create_family(
  p_family_name text,
  p_admin_password text,
  p_nickname text,
  p_role text,
  p_device_id text default null
)
returns table (
  family_id uuid,
  family_code text,
  member_id uuid,
  member_token text,
  is_admin boolean
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_family_id uuid;
  v_code text;
  v_member_id uuid;
  v_token text;
  v_family_name text;
begin
  v_family_name := trim(coalesce(p_family_name, ''));

  if length(v_family_name) = 0 or length(v_family_name) > 30 then
    raise exception 'family_name_required';
  end if;
  if p_admin_password is null or length(p_admin_password) < 4 or length(p_admin_password) > 128 then
    raise exception 'admin_password_too_short';
  end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 or length(trim(p_nickname)) > 20 then
    raise exception 'nickname_required';
  end if;
  if p_role not in ('father', 'mother', 'child') then
    raise exception 'invalid_role';
  end if;

  v_code := gen_family_code();
  v_token := gen_random_uuid()::text;

  insert into families (name, family_code, admin_password_hash, code_updated_at)
  values (v_family_name, v_code, hash_secret(p_admin_password), now())
  returning id into v_family_id;

  insert into family_members (
    family_id, nickname, role, member_token_hash, access_token_hash,
    device_id, is_admin, last_active_at, last_seen_at
  )
  values (
    v_family_id, trim(p_nickname), p_role, hash_secret(v_token),
    hash_secret(v_token), nullif(trim(coalesce(p_device_id, '')), ''),
    true, now(), now()
  )
  returning id into v_member_id;

  update families
     set created_by_member_id = v_member_id
   where id = v_family_id;

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_family_id,
    'system',
    U&'\5BB6\5EAD\5DF2\521B\5EFA\FF0C\6B22\8FCE\6765\5230\300C' || v_family_name || U&'\300D',
    'family_created',
    jsonb_build_object('family_name', v_family_name)
  );

  return query
  select v_family_id, v_code, v_member_id, v_token, true;
end;
$$;

create or replace function join_family(
  p_family_code text,
  p_nickname text,
  p_role text,
  p_device_id text default null
)
returns table (
  family_id uuid,
  family_name text,
  family_code text,
  member_id uuid,
  member_token text,
  is_admin boolean
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_family families%rowtype;
  v_member_id uuid;
  v_token text;
  v_clean_code text;
  v_clean_nickname text;
  v_ip_hash text;
begin
  v_ip_hash := assert_join_rate_limit();
  v_clean_code := upper(trim(coalesce(p_family_code, '')));
  v_clean_nickname := trim(coalesce(p_nickname, ''));

  if v_clean_code !~ '^[A-Z0-9]{6,12}$' then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_family_code';
  end if;
  if length(v_clean_nickname) = 0 or length(v_clean_nickname) > 20 then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'nickname_required';
  end if;
  if p_role not in ('father', 'mother', 'child') then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_role';
  end if;

  select * into v_family
    from families
   where families.family_code = v_clean_code
     and (families.code_expires_at is null or families.code_expires_at > now())
   limit 1;

  if not found or not v_family.join_enabled then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_family_code';
  end if;

  if exists (
    select 1
      from family_members fm
     where fm.family_id = v_family.id
       and fm.nickname = v_clean_nickname
       and fm.status in ('active', 'removed')
  ) then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'nickname_taken';
  end if;

  v_token := gen_random_uuid()::text;

  insert into family_members (
    family_id, nickname, role, member_token_hash, access_token_hash,
    device_id, is_admin, last_active_at, last_seen_at
  )
  values (
    v_family.id, v_clean_nickname, p_role, hash_secret(v_token),
    hash_secret(v_token), nullif(trim(coalesce(p_device_id, '')), ''),
    false, now(), now()
  )
  returning id into v_member_id;

  perform record_join_attempt(v_ip_hash, v_clean_code, true);

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_family.id,
    'system',
    v_clean_nickname || U&' \52A0\5165\4E86\5BB6\5EAD',
    'member_joined',
    jsonb_build_object('nickname', v_clean_nickname)
  );

  return query
  select v_family.id, v_family.name, v_family.family_code, v_member_id, v_token, false;
end;
$$;

create or replace function update_family_name(
  p_member_id uuid,
  p_member_token text,
  p_admin_password text,
  p_new_name text
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
  v_family_name text;
begin
  v_family_name := trim(coalesce(p_new_name, ''));

  if length(v_family_name) = 0 or length(v_family_name) > 30 then
    raise exception 'family_name_required';
  end if;

  v_family_id := require_admin(p_member_id, p_member_token, p_admin_password);

  update families
     set name = v_family_name,
         updated_at = now()
   where id = v_family_id;

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_family_id,
    'system',
    U&'\5BB6\5EAD\540D\79F0\5DF2\66F4\65B0\4E3A\300C' || v_family_name || U&'\300D',
    'family_renamed',
    jsonb_build_object('family_name', v_family_name)
  );
end;
$$;

create or replace function reset_family_code(
  p_member_id uuid,
  p_member_token text,
  p_admin_password text
)
returns text
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
  v_new_code text;
begin
  v_family_id := require_admin(p_member_id, p_member_token, p_admin_password);
  v_new_code := gen_family_code();

  update families
     set family_code = v_new_code,
         code_updated_at = now(),
         code_expires_at = null,
         updated_at = now()
   where id = v_family_id;

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_family_id,
    'system',
          'family_renamed',
    'family_code_reset',
    '{}'::jsonb
  );

  return v_new_code;
end;
$$;

create or replace function set_join_enabled(
  p_member_id uuid,
  p_member_token text,
  p_admin_password text,
  p_join_enabled boolean
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
begin
  v_family_id := require_admin(p_member_id, p_member_token, p_admin_password);

  update families
     set join_enabled = p_join_enabled,
         updated_at = now()
   where id = v_family_id;

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_family_id,
    'system',
    case when p_join_enabled
      then U&'\7BA1\7406\5458\5F00\542F\4E86\65B0\6210\5458\52A0\5165'
      else U&'\7BA1\7406\5458\5173\95ED\4E86\65B0\6210\5458\52A0\5165'
    end,
    case when p_join_enabled then 'join_enabled' else 'join_disabled' end,
    '{}'::jsonb
  );
end;
$$;

create or replace function remove_member(
  p_member_id uuid,
  p_member_token text,
  p_target_member_id uuid
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_caller record;
  v_target family_members%rowtype;
begin
  select * into v_caller from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if not v_caller.is_admin then
    raise exception 'not_admin';
  end if;
  if v_caller.id = p_target_member_id then
    raise exception 'cannot_remove_self';
  end if;

  select * into v_target
    from family_members
   where id = p_target_member_id
     and family_id = v_caller.family_id
     and status = 'active';
  if not found then
    raise exception 'member_not_found';
  end if;

  update family_members
     set status = 'removed',
         updated_at = now()
   where id = p_target_member_id;

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_caller.family_id,
    'system',
    v_target.nickname || U&' \5DF2\88AB\79FB\51FA\5BB6\5EAD',
    'member_removed',
    jsonb_build_object('nickname', v_target.nickname)
  );
end;
$$;

create or replace function leave_family(
  p_member_id uuid,
  p_member_token text
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_member record;
  v_active_admin_count int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if v_member.is_admin then
    select count(*) into v_active_admin_count
      from family_members
     where family_id = v_member.family_id
       and is_admin = true
       and status = 'active';

    if v_active_admin_count <= 1 then
      raise exception 'last_admin_cannot_leave';
    end if;
  end if;

  update family_members
     set status = 'removed',
         updated_at = now()
   where id = p_member_id;

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_member.family_id,
    'system',
    v_member.nickname || U&' \79BB\5F00\4E86\5BB6\5EAD',
    'member_left',
    jsonb_build_object('nickname', v_member.nickname)
  );
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
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload, m.push_requested_at,
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
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload, m.push_requested_at,
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
         m.system_event_type, m.system_event_payload,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from important_notifications n
    join messages m on m.id = n.message_id and m.family_id = n.family_id
   where n.family_id = v_member.family_id
     and n.removed_at is null
   order by n.created_at desc;
end;
$$;

grant execute on function create_family(text, text, text, text, text) to anon, authenticated;
grant execute on function join_family(text, text, text, text) to anon, authenticated;
grant execute on function update_family_name(uuid, text, text, text) to anon, authenticated;
grant execute on function reset_family_code(uuid, text, text) to anon, authenticated;
grant execute on function set_join_enabled(uuid, text, text, boolean) to anon, authenticated;
grant execute on function remove_member(uuid, text, uuid) to anon, authenticated;
grant execute on function leave_family(uuid, text) to anon, authenticated;
grant execute on function list_messages_for_member(uuid, text, int) to anon, authenticated;
grant execute on function list_messages_delta(uuid, text, timestamptz, uuid, int) to anon, authenticated;
grant execute on function list_important_notifications_for_member(uuid, text) to anon, authenticated;
