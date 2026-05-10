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
     and created_at > now() - interval '1 minute';

  select count(*) into v_hour_count
    from join_attempts
   where ip_hash = v_ip_hash
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
  values (v_family_id, 'system', '家庭已创建，欢迎来到「' || trim(p_family_name) || '」');

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
  values (v_family.id, 'system', v_clean_nickname || ' 加入了家庭');

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
         m.deleted_at, m.deleted_by_member_id, m.created_at
    from messages m
   where m.family_id = v_member.family_id
   order by m.created_at desc
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
         m.deleted_at, m.deleted_by_member_id, m.created_at
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
  values (v_family_id, 'system', '家庭代码已重置');

  return v_new_code;
end;
$$;

grant execute on function create_family(text, text, text, text, text) to anon, authenticated;
grant execute on function join_family(text, text, text, text) to anon, authenticated;
grant execute on function rejoin_family_member(text, text, text, text) to anon, authenticated;
grant execute on function validate_member(uuid, text, text) to anon, authenticated;
grant execute on function get_family_settings_for_member(uuid, text) to anon, authenticated;
grant execute on function list_messages_for_member(uuid, text, int) to anon, authenticated;
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
