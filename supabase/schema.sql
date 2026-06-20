-- Family Chat MVP schema for Supabase / PostgreSQL
-- Run this in the Supabase SQL editor in order from top to bottom.

create extension if not exists "pgcrypto";
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

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
  avatar_url text,
  avatar_updated_at timestamptz,
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

alter table family_members
  add column if not exists avatar_url text,
  add column if not exists avatar_updated_at timestamptz;

-- Realtime UPDATE events (used for kicking removed members) need full row payloads.
alter table family_members replica identity full;

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  family_seq bigint,
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
  disabled_at timestamptz,
  disabled_reason text,
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

create table if not exists push_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  subscription_id uuid references push_subscriptions(id) on delete set null,
  member_id uuid references family_members(id) on delete set null,
  endpoint text,
  status text not null check (status in ('sent', 'failed', 'gone', 'skipped')),
  attempt_source text,
  skip_reason text,
  error_code text,
  error_message text,
  error_status int,
  retry_count int not null default 0,
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists push_delivery_logs_family_created_idx
  on push_delivery_logs (family_id, created_at desc);

create index if not exists push_delivery_logs_created_idx
  on push_delivery_logs (created_at);

create index if not exists push_delivery_logs_retry_idx
  on push_delivery_logs (status, next_retry_at)
  where status = 'failed';

create index if not exists push_delivery_logs_message_member_idx
  on push_delivery_logs (message_id, member_id, created_at desc);

create index if not exists push_delivery_logs_message_subscription_idx
  on push_delivery_logs (message_id, subscription_id, created_at desc);

alter table push_delivery_logs enable row level security;

drop policy if exists "push delivery logs are readable by anon" on push_delivery_logs;
drop policy if exists "push delivery logs are rpc only" on push_delivery_logs;
create policy "push delivery logs are rpc only"
  on push_delivery_logs for select
  to anon, authenticated
  using (false);

revoke select on push_delivery_logs from anon, authenticated;

create or replace function cleanup_push_delivery_logs()
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
begin
  delete from push_delivery_logs
   where status in ('sent', 'skipped')
     and created_at < now() - interval '7 days';

  delete from push_delivery_logs
   where status in ('failed', 'gone')
     and created_at < now() - interval '30 days';
end;
$$;

grant execute on function cleanup_push_delivery_logs() to anon, authenticated;

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
    '瀹跺涵宸插垱寤猴紝娆㈣繋鏉ュ埌銆? || trim(p_family_name) || '�?
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
    v_clean_nickname || ' 鍔犲叆浜嗗�?
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
  values (v_family_id, 'system', '瀹跺涵鍚嶇О宸叉洿鏂颁负銆? || trim(p_new_name) || '�?);
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
    v_target.nickname || ' 宸茶绉诲嚭瀹跺�?
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
    v_member.nickname || ' 绂诲紑浜嗗�?
  );
end;
$$;

-- =====================================================================
-- RPC: send message
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
  v_image_ref_prefix text;
  v_audio_ref_prefix text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_image_ref_prefix := 'storage://chat-images/family/' || v_member.family_id::text || '/';
  v_audio_ref_prefix := 'storage://chat-audios/family/' || v_member.family_id::text || '/';

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
    length(p_image_url) > 2048 or not (
      p_image_url ~* '^https?://[^[:space:]]+$'
      or (
        p_image_url like v_image_ref_prefix || '%'
        and p_image_url !~ '\.\.'
        and p_image_url ~ '^storage://chat-images/[A-Za-z0-9/_.$-]+$'
      )
    )
  ) then
    raise exception 'invalid_image_url';
  end if;
  if p_audio_url is not null and (
    length(p_audio_url) > 2048 or not (
      p_audio_url ~* '^https?://[^[:space:]]+$'
      or (
        p_audio_url like v_audio_ref_prefix || '%'
        and p_audio_url !~ '\.\.'
        and p_audio_url ~ '^storage://chat-audios/[A-Za-z0-9/_.$-]+$'
      )
    )
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

-- =====================================================================
-- Grants for RPC functions
-- =====================================================================

grant execute on function create_family(text, text, text, text) to anon, authenticated;
grant execute on function join_family(text, text, text) to anon, authenticated;
grant execute on function rejoin_family_member(text, text, text) to anon, authenticated;
grant execute on function validate_member(uuid, text) to anon, authenticated;
grant execute on function send_message(uuid, text, text, text, text, text, int, double precision, double precision, text, text, text, text, uuid) to anon, authenticated;

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

-- 20260525_member_avatar_in_chat
-- Include member avatars in the chat member list RPC used by message bubbles.
drop function if exists list_family_members_for_member(uuid, text, boolean);

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
  avatar_url text,
  is_admin boolean,
  status text,
  last_active_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
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
  select fm.id,
         fm.family_id,
         fm.nickname,
         fm.role,
         fm.avatar_url,
         fm.is_admin,
         fm.status,
         fm.last_active_at
    from family_members fm
   where fm.family_id = v_member.family_id
     and (p_include_removed or fm.status = 'active')
   order by fm.created_at asc;
end;
$$;

grant execute on function list_family_members_for_member(uuid, text, boolean)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260525_member_avatar_in_chat',
  'member_avatar_in_chat',
  'Returns member avatar URLs from the chat member list RPC.'
)
on conflict (version) do nothing;

-- 20260524_realtime_regression_recovery
-- Restore realtime invalidation coverage for schedule reminder state changes.

alter table family_schedule_events
  drop constraint if exists family_schedule_events_event_type_check;

alter table family_schedule_events
  add constraint family_schedule_events_event_type_check
  check (event_type in (
    'created',
    'updated',
    'status_changed',
    'deleted',
    'reminder_updated',
    'commented',
    'comment_deleted',
    'assignment_responded',
    'activity_added'
  ));

create or replace function enqueue_schedule_realtime_events()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'created';

    insert into family_schedule_events (
      family_id, schedule_item_id, recipient_member_id, event_type
    )
    select new.family_id, new.id, recipients.member_id, v_event_type
      from (
        select distinct fm.id as member_id
          from family_members fm
         where fm.family_id = new.family_id
           and fm.status = 'active'
           and (
             new.visibility = 'family'
             or fm.id in (new.creator_member_id, new.assignee_member_id)
           )
      ) recipients;

    delete from family_schedule_events
     where created_at < now() - interval '1 day';

    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    v_event_type := 'deleted';
  elsif old.status is distinct from new.status and new.status = 'cancelled' then
    v_event_type := 'deleted';
  elsif old.status is distinct from new.status then
    v_event_type := 'status_changed';
  elsif old.remind_at is distinct from new.remind_at
     or old.reminded_at is distinct from new.reminded_at
     or old.reminder_push_attempted_at is distinct from new.reminder_push_attempted_at
     or old.reminder_push_error is distinct from new.reminder_push_error then
    v_event_type := 'reminder_updated';
  elsif old.title is distinct from new.title
     or old.note is distinct from new.note
     or old.item_type is distinct from new.item_type
     or old.visibility is distinct from new.visibility
     or old.starts_at is distinct from new.starts_at
     or old.ends_at is distinct from new.ends_at
     or old.assignee_member_id is distinct from new.assignee_member_id then
    v_event_type := 'updated';
  else
    return new;
  end if;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select new.family_id, new.id, recipients.member_id, v_event_type
    from (
      select distinct fm.id as member_id
        from family_members fm
       where fm.family_id = new.family_id
         and fm.status = 'active'
         and (
           (
             new.visibility = 'family'
             or fm.id in (new.creator_member_id, new.assignee_member_id)
           )
           or (
             old.visibility = 'family'
             or fm.id in (old.creator_member_id, old.assignee_member_id)
           )
         )
    ) recipients;

  delete from family_schedule_events
   where created_at < now() - interval '1 day';

  return new;
end;
$$;

create or replace function enqueue_schedule_reminder_delivery_realtime_event()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending'
       and new.attempt_count = 0
       and new.delivered_at is null
       and new.last_attempt_at is null
       and new.next_retry_at is null
       and new.skipped_reason is null
       and new.error_status is null
       and new.error_message is null then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if row(
      old.status,
      old.attempt_count,
      old.delivered_at,
      old.last_attempt_at,
      old.next_retry_at,
      old.skipped_reason,
      old.error_status,
      old.error_message
    ) is not distinct from row(
      new.status,
      new.attempt_count,
      new.delivered_at,
      new.last_attempt_at,
      new.next_retry_at,
      new.skipped_reason,
      new.error_status,
      new.error_message
    ) then
      return new;
    end if;
  else
    return new;
  end if;

  perform enqueue_schedule_event_for_visible_members(
    new.schedule_item_id,
    'reminder_updated'
  );

  return new;
end;
$$;

revoke all on function enqueue_schedule_reminder_delivery_realtime_event()
  from public;

drop trigger if exists trg_schedule_reminder_delivery_realtime_event
  on family_schedule_reminder_deliveries;

create trigger trg_schedule_reminder_delivery_realtime_event
after insert or update of status, attempt_count, delivered_at, last_attempt_at,
  next_retry_at, skipped_reason, error_status, error_message
on family_schedule_reminder_deliveries
for each row
execute function enqueue_schedule_reminder_delivery_realtime_event();

insert into app_schema_migrations (version, name, description)
values (
  '20260524_realtime_regression_recovery',
  'realtime_regression_recovery',
  'Restores 30-second fallback compatible realtime invalidation for schedule reminder deliveries.'
)
on conflict (version) do nothing;

-- =====================================================================
-- 20260524_system_health_consistency_checks
-- =====================================================================

create or replace function get_system_health_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tables jsonb := '[]'::jsonb;
  v_columns jsonb := '[]'::jsonb;
  v_functions jsonb := '[]'::jsonb;
  v_grants jsonb := '[]'::jsonb;
  v_table_privileges jsonb := '[]'::jsonb;
  v_policies jsonb := '[]'::jsonb;
  v_triggers jsonb := '[]'::jsonb;
  v_realtime jsonb := '[]'::jsonb;
  v_buckets jsonb := '[]'::jsonb;
  v_storage_policies jsonb := '[]'::jsonb;
  v_supabase_migrations jsonb := '[]'::jsonb;
  v_app_migrations jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'name', c.relname,
    'rls', c.relrowsecurity
  ) order by n.nspname, c.relname), '[]'::jsonb)
    into v_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p')
     and n.nspname in ('public', 'storage');

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', table_schema,
    'table', table_name,
    'column', column_name
  ) order by table_schema, table_name, ordinal_position), '[]'::jsonb)
    into v_columns
    from information_schema.columns
   where table_schema in ('public', 'storage');

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'name', p.proname,
    'args', pg_get_function_identity_arguments(p.oid)
  ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    into v_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public';

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', routine_schema,
    'name', routine_name,
    'grantee', grantee,
    'privilege', privilege_type
  ) order by routine_schema, routine_name, grantee), '[]'::jsonb)
    into v_grants
    from information_schema.routine_privileges
   where routine_schema = 'public';

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', table_schema,
    'table', table_name,
    'grantee', grantee,
    'privilege', privilege_type
  ) order by table_schema, table_name, grantee, privilege_type), '[]'::jsonb)
    into v_table_privileges
    from information_schema.table_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated');

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', schemaname,
    'table', tablename,
    'policy', policyname,
    'roles', to_jsonb(roles),
    'command', cmd,
    'qual', qual
  ) order by schemaname, tablename, policyname), '[]'::jsonb)
    into v_policies
    from pg_policies
   where schemaname = 'public';

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'table', c.relname,
    'name', t.tgname,
    'enabled', t.tgenabled::text,
    'definition', pg_get_triggerdef(t.oid, true)
  ) order by n.nspname, c.relname, t.tgname), '[]'::jsonb)
    into v_triggers
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and not t.tgisinternal;

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', schemaname,
    'table', tablename
  ) order by schemaname, tablename), '[]'::jsonb)
    into v_realtime
    from pg_publication_tables
   where pubname = 'supabase_realtime';

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', b.name,
      'public', case
        when to_jsonb(b) ? 'public' then (to_jsonb(b)->>'public')::boolean
        else null
      end,
      'file_size_limit', case
        when to_jsonb(b) ? 'file_size_limit'
          and nullif(to_jsonb(b)->>'file_size_limit', '') is not null
          then (to_jsonb(b)->>'file_size_limit')::bigint
        else null
      end,
      'allowed_mime_types', case
        when to_jsonb(b) ? 'allowed_mime_types' then to_jsonb(b)->'allowed_mime_types'
        else null
      end
    ) order by b.name), '[]'::jsonb)
      into v_buckets
      from storage.buckets b;
  exception
    when undefined_table or undefined_column or insufficient_privilege then
      v_buckets := '[]'::jsonb;
      v_warnings := v_warnings || jsonb_build_array('storage_buckets_unavailable');
  end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname,
      'table', tablename,
      'policy', policyname,
      'roles', to_jsonb(roles),
      'command', cmd,
      'qual', qual
    ) order by schemaname, tablename, policyname), '[]'::jsonb)
      into v_storage_policies
      from pg_policies
     where schemaname = 'storage';
  exception
    when insufficient_privilege then
      v_storage_policies := '[]'::jsonb;
      v_warnings := v_warnings || jsonb_build_array('storage_policies_unavailable');
  end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'version', version::text,
      'name', name
    ) order by version), '[]'::jsonb)
      into v_supabase_migrations
      from supabase_migrations.schema_migrations;
  exception
    when undefined_table or insufficient_privilege then
      v_supabase_migrations := '[]'::jsonb;
      v_warnings := v_warnings || jsonb_build_array('supabase_migrations_unavailable');
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'version', version,
    'name', name
  ) order by version), '[]'::jsonb)
    into v_app_migrations
    from app_schema_migrations;

  return jsonb_build_object(
    'tables', v_tables,
    'columns', v_columns,
    'functions', v_functions,
    'routineGrants', v_grants,
    'tablePrivileges', v_table_privileges,
    'policies', v_policies,
    'triggers', v_triggers,
    'realtimeTables', v_realtime,
    'buckets', v_buckets,
    'storagePolicies', v_storage_policies,
    'supabaseMigrations', v_supabase_migrations,
    'appMigrations', v_app_migrations,
    'catalogWarnings', v_warnings
  );
end;
$$;

revoke execute on function get_system_health_catalog() from public, anon, authenticated;
grant execute on function get_system_health_catalog() to service_role;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_system_health_consistency_checks',
  'system_health_consistency_checks',
  'Adds trigger, bucket detail, storage policy, and consistency catalog data for system health checks.'
)
on conflict (version) do update
set name = excluded.name,
    description = excluded.description;

-- 20260524_assistant_collaboration_mvp
alter table assistant_action_cards
  drop constraint if exists assistant_action_cards_type_check;

alter table assistant_action_cards
  add constraint assistant_action_cards_type_check
  check (card_type in (
    'reminder',
    'schedule',
    'important',
    'todo',
    'schedule_update',
    'schedule_cancel'
  ));

create or replace function create_assistant_action_card(
  p_member_id uuid,
  p_member_token text,
  p_card_type text,
  p_title text,
  p_summary text,
  p_payload jsonb default '{}'::jsonb,
  p_source_message_id uuid default null,
  p_target_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_title text;
  v_summary text;
  v_payload jsonb;
  v_card_id uuid;
  v_message_id uuid;
  v_recipient_member_id uuid;
  v_visibility text;
  v_assignee_id uuid;
  v_source_visible boolean;
  v_target messages%rowtype;
  v_schedule_id uuid;
  v_schedule family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if coalesce(p_card_type, '') not in (
    'reminder', 'schedule', 'important', 'todo', 'schedule_update', 'schedule_cancel'
  ) then
    raise exception 'invalid_assistant_card_type';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_summary := nullif(trim(coalesce(p_summary, '')), '');
  v_payload := coalesce(p_payload, '{}'::jsonb);
  v_visibility := coalesce(nullif(v_payload->>'visibility', ''), 'family');

  if length(v_title) = 0 then
    raise exception 'assistant_card_title_required';
  end if;
  if length(v_title) > 80 then
    raise exception 'assistant_card_title_too_long';
  end if;
  if v_summary is not null and length(v_summary) > 300 then
    raise exception 'assistant_card_summary_too_long';
  end if;
  if v_visibility not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;

  if p_source_message_id is not null then
    select exists (
      select 1
        from message_recipients mr
       where mr.family_id = v_member.family_id
         and mr.member_id = v_member.id
         and mr.message_id = p_source_message_id
    ) into v_source_visible;
    if not v_source_visible then
      raise exception 'message_not_found';
    end if;
  end if;

  if p_card_type = 'important' then
    if p_target_message_id is null then
      raise exception 'assistant_target_required';
    end if;

    select m.* into v_target
      from message_recipients mr
      join messages m on m.id = mr.message_id and m.family_id = mr.family_id
     where mr.family_id = v_member.family_id
       and mr.member_id = v_member.id
       and mr.message_id = p_target_message_id
     limit 1;
    if not found then
      raise exception 'message_not_found';
    end if;
    if v_target.recipient_member_id is not null or v_target.message_type = 'system' or v_target.deleted_at is not null then
      raise exception 'assistant_target_not_allowed';
    end if;
  end if;

  if p_card_type in ('schedule_update', 'schedule_cancel') then
    v_schedule_id := nullif(v_payload->>'schedule_item_id', '')::uuid;
    if v_schedule_id is null then
      raise exception 'schedule_item_not_found';
    end if;

    select * into v_schedule
      from family_schedule_items s
     where s.id = v_schedule_id
       and s.family_id = v_member.family_id
       and s.deleted_at is null
       and s.status = 'active'
     limit 1;
    if not found or not schedule_item_is_visible_to_member(v_schedule, v_member.id) then
      raise exception 'schedule_item_not_found';
    end if;
  end if;

  v_assignee_id := nullif(v_payload->>'assignee_member_id', '')::uuid;
  if v_assignee_id is not null then
    if not exists (
      select 1 from family_members fm
       where fm.id = v_assignee_id
         and fm.family_id = v_member.family_id
         and fm.status = 'active'
    ) then
      raise exception 'member_not_found';
    end if;
  end if;

  if v_visibility = 'private' then
    v_recipient_member_id := coalesce(v_assignee_id, v_member.id);
  end if;

  insert into assistant_action_cards (
    family_id, created_by_member_id, source_message_id, target_message_id,
    card_type, status, title, summary, payload
  )
  values (
    v_member.family_id, v_member.id, p_source_message_id, p_target_message_id,
    p_card_type, 'pending', v_title, v_summary, v_payload
  )
  returning id into v_card_id;

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, system_event_type, system_event_payload
  )
  values (
    v_member.family_id,
    v_member.id,
    v_member.id,
    'system',
    'Home Assistant confirmation card',
    'assistant_card_created',
    jsonb_build_object(
      'actor_type', 'assistant',
      'card_id', v_card_id,
      'card_type', p_card_type,
      'status', 'pending'
    )
  )
  returning id into v_message_id;

  update assistant_action_cards
     set card_message_id = v_message_id
   where id = v_card_id;

  update family_members
     set last_active_at = now()
   where id = v_member.id;

  return jsonb_build_object('card_id', v_card_id, 'message_id', v_message_id);
end;
$$;

create or replace function confirm_assistant_action_card(
  p_member_id uuid,
  p_member_token text,
  p_card_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_card assistant_action_cards%rowtype;
  v_assignee_id uuid;
  v_visibility text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remind_at timestamptz;
  v_item_type text;
  v_schedule_item_id uuid;
  v_notification_id uuid;
  v_done_message_id uuid;
  v_done_recipient_member_id uuid;
  v_existing_item family_schedule_items%rowtype;
  v_note text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_card
    from assistant_action_cards c
   where c.id = p_card_id
     and c.family_id = v_member.family_id
   for update;
  if not found then
    raise exception 'assistant_card_not_found';
  end if;
  if v_card.created_by_member_id <> v_member.id then
    raise exception 'assistant_card_not_allowed';
  end if;
  if v_card.status <> 'pending' then
    raise exception 'assistant_card_not_pending';
  end if;
  if v_card.expires_at <= now() then
    update assistant_action_cards
       set status = 'expired'
     where id = v_card.id;
    raise exception 'assistant_card_expired';
  end if;

  if v_card.card_type in ('reminder', 'schedule', 'todo') then
    v_visibility := coalesce(nullif(v_card.payload->>'visibility', ''), 'family');
    v_item_type := case
      when v_card.card_type = 'todo' then 'todo'
      else coalesce(nullif(v_card.payload->>'item_type', ''), v_card.card_type)
    end;
    v_assignee_id := coalesce(nullif(v_card.payload->>'assignee_member_id', '')::uuid, v_member.id);
    v_starts_at := nullif(v_card.payload->>'starts_at', '')::timestamptz;
    v_ends_at := nullif(v_card.payload->>'ends_at', '')::timestamptz;
    v_remind_at := nullif(v_card.payload->>'remind_at', '')::timestamptz;

    if v_starts_at is null then
      raise exception 'invalid_schedule_time';
    end if;

    v_schedule_item_id := create_schedule_item(
      p_member_id,
      p_member_token,
      v_card.title,
      v_card.summary,
      v_item_type,
      v_visibility,
      v_starts_at,
      v_ends_at,
      coalesce(v_remind_at, case when v_card.card_type = 'reminder' then v_starts_at else null end),
      v_assignee_id,
      'none'
    );

    if v_card.card_type = 'reminder' or v_remind_at is not null then
      perform set_schedule_reminder_rules(
        p_member_id,
        p_member_token,
        v_schedule_item_id,
        array[0]::int[],
        'single'
      );
    end if;
  elsif v_card.card_type = 'schedule_update' then
    v_schedule_item_id := nullif(v_card.payload->>'schedule_item_id', '')::uuid;
    if v_schedule_item_id is null then
      raise exception 'schedule_item_not_found';
    end if;

    select * into v_existing_item
      from family_schedule_items s
     where s.id = v_schedule_item_id
       and s.family_id = v_member.family_id
       and s.deleted_at is null
     for update;
    if not found or not schedule_item_is_visible_to_member(v_existing_item, v_member.id) then
      raise exception 'schedule_item_not_found';
    end if;

    v_starts_at := coalesce(
      nullif(v_card.payload->>'starts_at', '')::timestamptz,
      v_existing_item.starts_at
    );
    v_ends_at := case
      when v_card.payload ? 'ends_at' then nullif(v_card.payload->>'ends_at', '')::timestamptz
      else v_existing_item.ends_at
    end;
    v_remind_at := case
      when v_card.payload ? 'remind_at' then nullif(v_card.payload->>'remind_at', '')::timestamptz
      else v_existing_item.remind_at
    end;
    v_assignee_id := coalesce(
      nullif(v_card.payload->>'assignee_member_id', '')::uuid,
      v_existing_item.assignee_member_id
    );
    v_visibility := coalesce(
      nullif(v_card.payload->>'visibility', ''),
      v_existing_item.visibility
    );
    v_item_type := coalesce(
      nullif(v_card.payload->>'item_type', ''),
      v_existing_item.item_type
    );
    v_note := case
      when v_card.payload ? 'note' then nullif(v_card.payload->>'note', '')
      else v_existing_item.note
    end;

    perform update_schedule_item(
      p_member_id,
      p_member_token,
      v_schedule_item_id,
      coalesce(nullif(v_card.payload->>'title', ''), v_existing_item.title),
      v_note,
      v_item_type,
      v_visibility,
      v_assignee_id,
      v_starts_at,
      v_ends_at,
      v_remind_at,
      'single'
    );
  elsif v_card.card_type = 'schedule_cancel' then
    v_schedule_item_id := nullif(v_card.payload->>'schedule_item_id', '')::uuid;
    if v_schedule_item_id is null then
      raise exception 'schedule_item_not_found';
    end if;

    perform delete_schedule_item(
      p_member_id,
      p_member_token,
      v_schedule_item_id,
      'single'
    );
  elsif v_card.card_type = 'important' then
    v_notification_id := add_important_notification(
      p_member_id,
      p_member_token,
      v_card.target_message_id
    );
  end if;

  update assistant_action_cards
     set status = 'confirmed',
         confirmed_at = now(),
         confirmed_by_member_id = v_member.id,
         result_schedule_item_id = v_schedule_item_id,
         result_important_notification_id = v_notification_id
   where id = v_card.id;

  update messages
     set system_event_payload =
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 coalesce(system_event_payload, '{}'::jsonb),
                 '{status}',
                 to_jsonb('confirmed'::text),
                 true
               ),
               '{result_schedule_item_id}',
               coalesce(to_jsonb(v_schedule_item_id), 'null'::jsonb),
               true
             ),
             '{result_important_notification_id}',
             coalesce(to_jsonb(v_notification_id), 'null'::jsonb),
             true
           ),
         system_event_type = 'assistant_card_confirmed'
   where id = v_card.card_message_id;

  if coalesce(v_card.payload->>'visibility', 'family') = 'private' then
    v_done_recipient_member_id := coalesce(
      nullif(v_card.payload->>'assignee_member_id', '')::uuid,
      v_member.id
    );
  end if;

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, system_event_type, system_event_payload
  )
  values (
    v_member.family_id,
    v_member.id,
    v_done_recipient_member_id,
    'system',
    'Home Assistant action done',
    'assistant_action_done',
    jsonb_build_object(
      'actor_type', 'assistant',
      'card_id', v_card.id,
      'card_type', v_card.card_type,
      'schedule_item_id', v_schedule_item_id,
      'important_notification_id', v_notification_id
    )
  )
  returning id into v_done_message_id;

  update assistant_action_cards
     set result_message_id = v_done_message_id
   where id = v_card.id;

  return jsonb_build_object(
    'card_id', v_card.id,
    'message_id', v_card.card_message_id,
    'result_message_id', v_done_message_id,
    'schedule_item_id', v_schedule_item_id,
    'important_notification_id', v_notification_id,
    'status', 'confirmed'
  );
end;
$$;

create or replace function get_important_notification_read_state(
  p_member_id uuid,
  p_member_token text,
  p_notification_id uuid
)
returns table (
  notification_id uuid,
  member_id uuid,
  nickname text,
  role text,
  delivered_at timestamptz,
  read_at timestamptz,
  is_read boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_notification important_notifications%rowtype;
  v_message messages%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_notification
    from important_notifications n
   where n.id = p_notification_id
     and n.family_id = v_member.family_id
     and n.removed_at is null
   limit 1;
  if not found then
    raise exception 'important_notification_not_found';
  end if;

  select * into v_message
    from messages m
   where m.id = v_notification.message_id
     and m.family_id = v_member.family_id
   limit 1;
  if not found then
    raise exception 'message_not_found';
  end if;
  if v_message.recipient_member_id is not null then
    raise exception 'private_message_not_allowed';
  end if;

  if not exists (
    select 1
      from message_recipients mr
     where mr.family_id = v_member.family_id
       and mr.message_id = v_message.id
       and mr.member_id = v_member.id
  ) then
    raise exception 'message_not_found';
  end if;

  return query
  select v_notification.id,
         fm.id,
         fm.nickname,
         fm.role,
         mr.delivered_at,
         mr.read_at,
         (mr.read_at is not null)
    from message_recipients mr
    join family_members fm
      on fm.id = mr.member_id
     and fm.family_id = mr.family_id
   where mr.family_id = v_member.family_id
     and mr.message_id = v_message.id
     and fm.status = 'active'
   order by
     case when mr.read_at is null then 1 else 0 end,
     coalesce(mr.read_at, mr.delivered_at, mr.created_at) asc,
     fm.nickname asc,
     fm.id asc;
end;
$$;

grant execute on function create_assistant_action_card(uuid, text, text, text, text, jsonb, uuid, uuid)
  to anon, authenticated;
grant execute on function confirm_assistant_action_card(uuid, text, uuid)
  to anon, authenticated;
grant execute on function get_important_notification_read_state(uuid, text, uuid)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_assistant_collaboration_mvp',
  'assistant_collaboration_mvp',
  'Extends assistant cards for lightweight family collaboration and important read state.'
)
on conflict (version) do nothing;

-- 20260524_schedule_context_chat_backfill
-- Backfill schedule collaboration history into the schedule context timeline.

alter table family_context_events
  add column if not exists source_table text,
  add column if not exists source_id uuid;

create unique index if not exists family_context_events_source_uidx
  on family_context_events (source_table, source_id)
  where source_table is not null and source_id is not null;

create index if not exists family_context_events_source_idx
  on family_context_events (source_table, source_id);

with inserted as (
  insert into family_context_events (
    family_id,
    target_type,
    target_id,
    schedule_item_id,
    sender_type,
    sender_member_id,
    recipient_member_id,
    event_type,
    visibility,
    text_content,
    source_table,
    source_id,
    created_at,
    updated_at
  )
  select
    c.family_id,
    'schedule_item',
    c.schedule_item_id,
    c.schedule_item_id,
    'member',
    c.member_id,
    null,
    'text',
    'family',
    c.content,
    'family_schedule_comments',
    c.id,
    c.created_at,
    coalesce(c.updated_at, c.created_at)
  from family_schedule_comments c
  join family_schedule_items s on s.id = c.schedule_item_id
  where c.deleted_at is null
    and s.deleted_at is null
  on conflict do nothing
  returning id, family_id, schedule_item_id
)
insert into family_context_event_recipients (family_id, event_id, member_id)
select inserted.family_id, inserted.id, fm.id
from inserted
join family_schedule_items s on s.id = inserted.schedule_item_id
join family_members fm on fm.family_id = inserted.family_id
where fm.status = 'active'
  and schedule_item_is_visible_to_member(s, fm.id)
on conflict (event_id, member_id) do nothing;

with inserted as (
  insert into family_context_events (
    family_id,
    target_type,
    target_id,
    schedule_item_id,
    sender_type,
    sender_member_id,
    recipient_member_id,
    event_type,
    visibility,
    text_content,
    source_table,
    source_id,
    created_at,
    updated_at
  )
  select
    a.family_id,
    'schedule_item',
    a.schedule_item_id,
    a.schedule_item_id,
    case when a.actor_member_id is null then 'keeper' else 'member' end,
    a.actor_member_id,
    null,
    case
      when a.activity_type in ('created', 'assigned', 'accepted', 'declined', 'completed', 'restored', 'deleted') then a.activity_type
      when a.activity_type in ('reminder_updated', 'reminder_changed') then 'reminder_updated'
      else 'updated'
    end,
    case when s.visibility = 'private' then 'private' else 'family' end,
    nullif(trim(coalesce(a.summary, '')), ''),
    'family_schedule_activity_logs',
    a.id,
    a.created_at,
    a.created_at
  from family_schedule_activity_logs a
  join family_schedule_items s on s.id = a.schedule_item_id
  where s.deleted_at is null
  on conflict do nothing
  returning id, family_id, schedule_item_id
)
insert into family_context_event_recipients (family_id, event_id, member_id)
select inserted.family_id, inserted.id, fm.id
from inserted
join family_schedule_items s on s.id = inserted.schedule_item_id
join family_members fm on fm.family_id = inserted.family_id
where fm.status = 'active'
  and schedule_item_is_visible_to_member(s, fm.id)
on conflict (event_id, member_id) do nothing;

with inserted as (
  insert into family_context_events (
    family_id,
    target_type,
    target_id,
    schedule_item_id,
    sender_type,
    sender_member_id,
    recipient_member_id,
    event_type,
    visibility,
    text_content,
    source_table,
    source_id,
    created_at,
    updated_at
  )
  select
    s.family_id,
    'schedule_item',
    s.id,
    s.id,
    'keeper',
    null,
    null,
    'created',
    case when s.visibility = 'private' then 'private' else 'family' end,
    '日程已安排' ||
      case when assignee.nickname is not null then '给' || assignee.nickname else '' end,
    'family_schedule_items',
    s.id,
    s.created_at,
    s.created_at
  from family_schedule_items s
  left join family_members assignee on assignee.id = s.assignee_member_id
  where s.deleted_at is null
    and not exists (
      select 1
      from family_context_events e
      where e.schedule_item_id = s.id
        and e.deleted_at is null
    )
  on conflict do nothing
  returning id, family_id, schedule_item_id
)
insert into family_context_event_recipients (family_id, event_id, member_id)
select inserted.family_id, inserted.id, fm.id
from inserted
join family_schedule_items s on s.id = inserted.schedule_item_id
join family_members fm on fm.family_id = inserted.family_id
where fm.status = 'active'
  and schedule_item_is_visible_to_member(s, fm.id)
on conflict (event_id, member_id) do nothing;

insert into family_context_event_recipients (family_id, event_id, member_id)
select e.family_id, e.id, fm.id
from family_context_events e
join family_schedule_items s on s.id = e.schedule_item_id
join family_members fm on fm.family_id = e.family_id
where e.deleted_at is null
  and e.source_table in (
    'family_schedule_comments',
    'family_schedule_activity_logs',
    'family_schedule_items'
  )
  and fm.status = 'active'
  and schedule_item_is_visible_to_member(s, fm.id)
on conflict (event_id, member_id) do nothing;

create or replace function list_schedule_context_events_for_member(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns table (
  id uuid,
  family_id uuid,
  schedule_item_id uuid,
  sender_type text,
  sender_member_id uuid,
  sender_nickname text,
  recipient_member_id uuid,
  recipient_nickname text,
  event_type text,
  visibility text,
  text_content text,
  audio_url text,
  audio_duration_ms integer,
  latitude double precision,
  longitude double precision,
  location_label text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null;

  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;

  return query
  select *
    from (
      select e.id,
             e.family_id,
             e.schedule_item_id,
             e.sender_type,
             e.sender_member_id,
             sender.nickname as sender_nickname,
             e.recipient_member_id,
             recipient.nickname as recipient_nickname,
             e.event_type,
             e.visibility,
             e.text_content,
             e.audio_url,
             e.audio_duration_ms,
             e.latitude,
             e.longitude,
             e.location_label,
             e.created_at
        from family_context_events e
        join family_context_event_recipients r
          on r.event_id = e.id
         and r.member_id = v_member.id
        left join family_members sender on sender.id = e.sender_member_id
        left join family_members recipient on recipient.id = e.recipient_member_id
       where e.schedule_item_id = v_item.id
         and e.deleted_at is null
      union all
      select c.id,
             c.family_id,
             c.schedule_item_id,
             'member'::text as sender_type,
             c.member_id as sender_member_id,
             fm.nickname as sender_nickname,
             null::uuid as recipient_member_id,
             null::text as recipient_nickname,
             'text'::text as event_type,
             'family'::text as visibility,
             c.content as text_content,
             null::text as audio_url,
             null::integer as audio_duration_ms,
             null::double precision as latitude,
             null::double precision as longitude,
             null::text as location_label,
             c.created_at
        from family_schedule_comments c
        join family_members fm on fm.id = c.member_id
       where c.schedule_item_id = v_item.id
         and c.deleted_at is null
         and schedule_item_is_visible_to_member(v_item, v_member.id)
         and not exists (
           select 1
             from family_context_events existing
            where existing.source_table = 'family_schedule_comments'
              and existing.source_id = c.id
         )
    ) timeline
   order by timeline.created_at asc, timeline.id asc
   limit 200;
end;
$$;

grant execute on function list_schedule_context_events_for_member(uuid, text, uuid)
  to anon, authenticated;

create or replace function delete_schedule_context_event(
  p_member_id uuid,
  p_member_token text,
  p_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_event family_context_events%rowtype;
  v_item family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_event
    from family_context_events e
   where e.id = p_event_id
     and e.deleted_at is null
   limit 1;
  if not found then
    raise exception 'schedule_context_event_not_found';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = v_event.schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   limit 1;
  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_context_event_not_found';
  end if;

  if v_event.sender_member_id is distinct from v_member.id then
    raise exception 'unauthorized';
  end if;
  if v_event.event_type not in ('text', 'audio', 'location') then
    raise exception 'schedule_context_event_not_deletable';
  end if;

  update family_context_events
     set deleted_at = now(),
         deleted_by_member_id = v_member.id,
         updated_at = now()
   where id = v_event.id;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select v_event.family_id, v_event.schedule_item_id, r.member_id, 'comment_deleted'
    from family_context_event_recipients r
   where r.event_id = v_event.id;
end;
$$;

grant execute on function delete_schedule_context_event(uuid, text, uuid)
  to anon, authenticated;

insert into app_schema_migrations(version, name)
values (
  '20260524_schedule_context_chat_backfill',
  'schedule_context_chat_backfill'
)
on conflict (version) do nothing;

-- =====================================================================
-- Home Assistant action cards
-- =====================================================================

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
      old.recipient_member_id,
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
      new.recipient_member_id,
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

create table if not exists assistant_action_cards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  created_by_member_id uuid not null references family_members(id) on delete cascade,
  card_message_id uuid references messages(id) on delete set null,
  source_message_id uuid references messages(id) on delete set null,
  target_message_id uuid references messages(id) on delete set null,
  card_type text not null,
  status text not null default 'pending',
  title text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  result_schedule_item_id uuid references family_schedule_items(id) on delete set null,
  result_important_notification_id uuid references important_notifications(id) on delete set null,
  result_message_id uuid references messages(id) on delete set null,
  confirmed_at timestamptz,
  confirmed_by_member_id uuid references family_members(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by_member_id uuid references family_members(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '1 day'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_action_cards_type_check
    check (card_type in ('reminder', 'schedule', 'important')),
  constraint assistant_action_cards_status_check
    check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  constraint assistant_action_cards_title_length_check
    check (char_length(trim(title)) between 1 and 80),
  constraint assistant_action_cards_summary_length_check
    check (summary is null or char_length(summary) <= 300)
);

create index if not exists assistant_action_cards_family_created_idx
  on assistant_action_cards (family_id, created_at desc);

create index if not exists assistant_action_cards_family_status_idx
  on assistant_action_cards (family_id, status, created_at desc);

create index if not exists assistant_action_cards_card_message_idx
  on assistant_action_cards (card_message_id)
  where card_message_id is not null;

create index if not exists assistant_action_cards_target_message_idx
  on assistant_action_cards (target_message_id)
  where target_message_id is not null;

alter table assistant_action_cards enable row level security;
revoke all on assistant_action_cards from anon, authenticated;

drop policy if exists "assistant action cards are rpc only" on assistant_action_cards;
create policy "assistant action cards are rpc only"
  on assistant_action_cards for select
  to anon, authenticated
  using (false);

create or replace function touch_assistant_action_card_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_assistant_action_cards on assistant_action_cards;
create trigger trg_touch_assistant_action_cards
before update on assistant_action_cards
for each row
execute function touch_assistant_action_card_updated_at();

create or replace function list_assistant_action_cards_for_member(
  p_member_id uuid,
  p_member_token text
)
returns table (
  id uuid,
  family_id uuid,
  created_by_member_id uuid,
  card_message_id uuid,
  source_message_id uuid,
  target_message_id uuid,
  card_type text,
  status text,
  title text,
  summary text,
  payload jsonb,
  result_schedule_item_id uuid,
  result_important_notification_id uuid,
  result_message_id uuid,
  confirmed_at timestamptz,
  confirmed_by_member_id uuid,
  cancelled_at timestamptz,
  cancelled_by_member_id uuid,
  expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
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
  select c.id, c.family_id, c.created_by_member_id, c.card_message_id,
         c.source_message_id, c.target_message_id, c.card_type, c.status,
         c.title, c.summary, c.payload, c.result_schedule_item_id,
         c.result_important_notification_id, c.result_message_id,
         c.confirmed_at, c.confirmed_by_member_id,
         c.cancelled_at, c.cancelled_by_member_id,
         c.expires_at, c.created_at, c.updated_at
    from assistant_action_cards c
   where c.family_id = v_member.family_id
     and (
       coalesce(c.payload->>'visibility', 'family') = 'family'
       or c.created_by_member_id = v_member.id
       or nullif(c.payload->>'assignee_member_id', '')::uuid = v_member.id
     )
   order by c.created_at desc, c.id desc
   limit 200;
end;
$$;

create or replace function create_assistant_action_card(
  p_member_id uuid,
  p_member_token text,
  p_card_type text,
  p_title text,
  p_summary text,
  p_payload jsonb default '{}'::jsonb,
  p_source_message_id uuid default null,
  p_target_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_title text;
  v_summary text;
  v_payload jsonb;
  v_card_id uuid;
  v_message_id uuid;
  v_recipient_member_id uuid;
  v_visibility text;
  v_assignee_id uuid;
  v_source_visible boolean;
  v_target messages%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if coalesce(p_card_type, '') not in ('reminder', 'schedule', 'important') then
    raise exception 'invalid_assistant_card_type';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_summary := nullif(trim(coalesce(p_summary, '')), '');
  v_payload := coalesce(p_payload, '{}'::jsonb);
  v_visibility := coalesce(nullif(v_payload->>'visibility', ''), 'family');

  if length(v_title) = 0 then
    raise exception 'assistant_card_title_required';
  end if;
  if length(v_title) > 80 then
    raise exception 'assistant_card_title_too_long';
  end if;
  if v_summary is not null and length(v_summary) > 300 then
    raise exception 'assistant_card_summary_too_long';
  end if;
  if v_visibility not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;

  if p_source_message_id is not null then
    select exists (
      select 1
        from message_recipients mr
       where mr.family_id = v_member.family_id
         and mr.member_id = v_member.id
         and mr.message_id = p_source_message_id
    ) into v_source_visible;
    if not v_source_visible then
      raise exception 'message_not_found';
    end if;
  end if;

  if p_card_type = 'important' then
    if p_target_message_id is null then
      raise exception 'assistant_target_required';
    end if;

    select m.* into v_target
      from message_recipients mr
      join messages m on m.id = mr.message_id and m.family_id = mr.family_id
     where mr.family_id = v_member.family_id
       and mr.member_id = v_member.id
       and mr.message_id = p_target_message_id
     limit 1;
    if not found then
      raise exception 'message_not_found';
    end if;
    if v_target.recipient_member_id is not null or v_target.message_type = 'system' or v_target.deleted_at is not null then
      raise exception 'assistant_target_not_allowed';
    end if;
  end if;

  v_assignee_id := nullif(v_payload->>'assignee_member_id', '')::uuid;
  if v_assignee_id is not null then
    if not exists (
      select 1 from family_members fm
       where fm.id = v_assignee_id
         and fm.family_id = v_member.family_id
         and fm.status = 'active'
    ) then
      raise exception 'member_not_found';
    end if;
  end if;

  if v_visibility = 'private' then
    v_recipient_member_id := coalesce(v_assignee_id, v_member.id);
  end if;

  insert into assistant_action_cards (
    family_id, created_by_member_id, source_message_id, target_message_id,
    card_type, status, title, summary, payload
  )
  values (
    v_member.family_id, v_member.id, p_source_message_id, p_target_message_id,
    p_card_type, 'pending', v_title, v_summary, v_payload
  )
  returning id into v_card_id;

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, system_event_type, system_event_payload
  )
  values (
    v_member.family_id,
    v_member.id,
    v_member.id,
    'system',
    'Home Assistant confirmation card',
    'assistant_card_created',
    jsonb_build_object(
      'actor_type', 'assistant',
      'card_id', v_card_id,
      'card_type', p_card_type,
      'status', 'pending'
    )
  )
  returning id into v_message_id;

  update assistant_action_cards
     set card_message_id = v_message_id
   where id = v_card_id;

  update family_members
     set last_active_at = now()
   where id = v_member.id;

  return jsonb_build_object('card_id', v_card_id, 'message_id', v_message_id);
end;
$$;

create or replace function cancel_assistant_action_card(
  p_member_id uuid,
  p_member_token text,
  p_card_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_card assistant_action_cards%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_card
    from assistant_action_cards c
   where c.id = p_card_id
     and c.family_id = v_member.family_id
   for update;
  if not found then
    raise exception 'assistant_card_not_found';
  end if;
  if v_card.created_by_member_id <> v_member.id then
    raise exception 'assistant_card_not_allowed';
  end if;
  if v_card.status <> 'pending' then
    raise exception 'assistant_card_not_pending';
  end if;

  update assistant_action_cards
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by_member_id = v_member.id
   where id = v_card.id;

  update messages
     set system_event_payload = jsonb_set(
           coalesce(system_event_payload, '{}'::jsonb),
           '{status}',
           to_jsonb('cancelled'::text),
           true
         ),
         system_event_type = 'assistant_card_cancelled'
   where id = v_card.card_message_id;

  return jsonb_build_object(
    'card_id', v_card.id,
    'message_id', v_card.card_message_id,
    'status', 'cancelled'
  );
end;
$$;

create or replace function confirm_assistant_action_card(
  p_member_id uuid,
  p_member_token text,
  p_card_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_card assistant_action_cards%rowtype;
  v_assignee_id uuid;
  v_visibility text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remind_at timestamptz;
  v_item_type text;
  v_schedule_item_id uuid;
  v_notification_id uuid;
  v_done_message_id uuid;
  v_done_recipient_member_id uuid;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_card
    from assistant_action_cards c
   where c.id = p_card_id
     and c.family_id = v_member.family_id
   for update;
  if not found then
    raise exception 'assistant_card_not_found';
  end if;
  if v_card.created_by_member_id <> v_member.id then
    raise exception 'assistant_card_not_allowed';
  end if;
  if v_card.status <> 'pending' then
    raise exception 'assistant_card_not_pending';
  end if;
  if v_card.expires_at <= now() then
    update assistant_action_cards
       set status = 'expired'
     where id = v_card.id;
    raise exception 'assistant_card_expired';
  end if;

  if v_card.card_type in ('reminder', 'schedule') then
    v_visibility := coalesce(nullif(v_card.payload->>'visibility', ''), 'family');
    v_item_type := coalesce(nullif(v_card.payload->>'item_type', ''), v_card.card_type);
    v_assignee_id := coalesce(nullif(v_card.payload->>'assignee_member_id', '')::uuid, v_member.id);
    v_starts_at := nullif(v_card.payload->>'starts_at', '')::timestamptz;
    v_ends_at := nullif(v_card.payload->>'ends_at', '')::timestamptz;
    v_remind_at := nullif(v_card.payload->>'remind_at', '')::timestamptz;

    if v_starts_at is null then
      raise exception 'invalid_schedule_time';
    end if;

    v_schedule_item_id := create_schedule_item(
      p_member_id,
      p_member_token,
      v_card.title,
      v_card.summary,
      v_item_type,
      v_visibility,
      v_starts_at,
      v_ends_at,
      coalesce(v_remind_at, case when v_card.card_type = 'reminder' then v_starts_at else null end),
      v_assignee_id,
      'none'
    );

    if v_card.card_type = 'reminder' or v_remind_at is not null then
      perform set_schedule_reminder_rules(
        p_member_id,
        p_member_token,
        v_schedule_item_id,
        array[0]::int[],
        'single'
      );
    end if;
  elsif v_card.card_type = 'important' then
    v_notification_id := add_important_notification(
      p_member_id,
      p_member_token,
      v_card.target_message_id
    );
  end if;

  update assistant_action_cards
     set status = 'confirmed',
         confirmed_at = now(),
         confirmed_by_member_id = v_member.id,
         result_schedule_item_id = v_schedule_item_id,
         result_important_notification_id = v_notification_id
   where id = v_card.id;

  update messages
     set system_event_payload =
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 coalesce(system_event_payload, '{}'::jsonb),
                 '{status}',
                 to_jsonb('confirmed'::text),
                 true
               ),
               '{result_schedule_item_id}',
               coalesce(to_jsonb(v_schedule_item_id), 'null'::jsonb),
               true
             ),
             '{result_important_notification_id}',
             coalesce(to_jsonb(v_notification_id), 'null'::jsonb),
             true
           ),
         system_event_type = 'assistant_card_confirmed'
   where id = v_card.card_message_id;

  if coalesce(v_card.payload->>'visibility', 'family') = 'private' then
    v_done_recipient_member_id := coalesce(
      nullif(v_card.payload->>'assignee_member_id', '')::uuid,
      v_member.id
    );
  end if;

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, system_event_type, system_event_payload
  )
  values (
    v_member.family_id,
    v_member.id,
    v_done_recipient_member_id,
    'system',
    'Home Assistant action done',
    'assistant_action_done',
    jsonb_build_object(
      'actor_type', 'assistant',
      'card_id', v_card.id,
      'card_type', v_card.card_type,
      'schedule_item_id', v_schedule_item_id,
      'important_notification_id', v_notification_id
    )
  )
  returning id into v_done_message_id;

  update assistant_action_cards
     set result_message_id = v_done_message_id
   where id = v_card.id;

  return jsonb_build_object(
    'card_id', v_card.id,
    'message_id', v_card.card_message_id,
    'result_message_id', v_done_message_id,
    'schedule_item_id', v_schedule_item_id,
    'important_notification_id', v_notification_id,
    'status', 'confirmed'
  );
end;
$$;

grant execute on function list_assistant_action_cards_for_member(uuid, text)
  to anon, authenticated;
grant execute on function create_assistant_action_card(uuid, text, text, text, text, jsonb, uuid, uuid)
  to anon, authenticated;
grant execute on function confirm_assistant_action_card(uuid, text, uuid)
  to anon, authenticated;
grant execute on function cancel_assistant_action_card(uuid, text, uuid)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_assistant_action_cards',
  'assistant_action_cards',
  'Adds Home Assistant confirmation cards over chat messages, schedules, and important notices.'
)
on conflict (version) do nothing;

-- =====================================================================
-- おうち係 request workflow
-- =====================================================================

alter table messages
  add column if not exists recipient_member_id uuid references family_members(id) on delete set null,
  add column if not exists system_event_type text,
  add column if not exists system_event_payload jsonb;

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'messages_system_event_type_check'
       and conrelid = 'messages'::regclass
  ) then
    alter table messages
      drop constraint messages_system_event_type_check;
  end if;

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
        'member_left',
        'admin_password_changed',
        'keeper_request_created',
        'assistant_card_created',
        'assistant_card_confirmed',
        'assistant_card_cancelled',
        'assistant_action_done'
      )
    );
end $$;

create table if not exists keeper_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  requester_member_id uuid not null references family_members(id) on delete cascade,
  assignee_member_id uuid references family_members(id) on delete set null,
  schedule_item_id uuid references family_schedule_items(id) on delete set null,
  source_message_id uuid references messages(id) on delete set null,
  request_text text not null,
  request_type text not null,
  visibility text not null,
  status text not null default 'created',
  due_at timestamptz,
  remind_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint keeper_requests_request_type_check
    check (request_type in ('schedule', 'todo', 'reminder')),
  constraint keeper_requests_visibility_check
    check (visibility in ('family', 'private')),
  constraint keeper_requests_status_check
    check (status in ('draft', 'created', 'done', 'cancelled')),
  constraint keeper_requests_text_length_check
    check (char_length(trim(request_text)) between 1 and 300)
);

create index if not exists keeper_requests_family_created_idx
  on keeper_requests (family_id, created_at desc);

create index if not exists keeper_requests_requester_idx
  on keeper_requests (requester_member_id, created_at desc);

create index if not exists keeper_requests_assignee_idx
  on keeper_requests (assignee_member_id, created_at desc)
  where assignee_member_id is not null;

alter table keeper_requests enable row level security;
revoke all on keeper_requests from anon, authenticated;

drop policy if exists "keeper requests are rpc only" on keeper_requests;
create policy "keeper requests are rpc only"
  on keeper_requests for select
  to anon, authenticated
  using (false);

create or replace function create_keeper_request(
  p_member_id uuid,
  p_member_token text,
  p_request_text text,
  p_request_type text,
  p_assignee_member_id uuid,
  p_visibility text,
  p_starts_at timestamptz,
  p_remind_at timestamptz,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_assignee family_members%rowtype;
  v_request_text text;
  v_note text;
  v_schedule_item_id uuid;
  v_request_id uuid;
  v_message_id uuid;
  v_target_kind text;
  v_content text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_request_text := trim(coalesce(p_request_text, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');

  if length(v_request_text) = 0 then
    raise exception 'keeper_request_required';
  end if;
  if length(v_request_text) > 300 then
    raise exception 'keeper_request_too_long';
  end if;
  if coalesce(p_request_type, '') not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_keeper_request_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_keeper_visibility';
  end if;
  if p_starts_at is null then
    raise exception 'invalid_schedule_time';
  end if;

  select * into v_assignee
    from family_members fm
   where fm.id = coalesce(p_assignee_member_id, v_member.id)
     and fm.family_id = v_member.family_id
     and fm.status = 'active'
   limit 1;
  if not found then
    raise exception 'member_not_found';
  end if;

  v_schedule_item_id := create_schedule_item(
    p_member_id,
    p_member_token,
    v_request_text,
    v_note,
    p_request_type,
    p_visibility,
    p_starts_at,
    null,
    p_remind_at,
    v_assignee.id,
    'none'
  );

  if p_remind_at is not null then
    perform set_schedule_reminder_rules(
      p_member_id,
      p_member_token,
      v_schedule_item_id,
      array[0]::int[],
      'single'
    );
  end if;

  insert into keeper_requests (
    family_id, requester_member_id, assignee_member_id, schedule_item_id,
    request_text, request_type, visibility, status, due_at, remind_at
  )
  values (
    v_member.family_id, v_member.id, v_assignee.id, v_schedule_item_id,
    v_request_text, p_request_type, p_visibility, 'created', p_starts_at, p_remind_at
  )
  returning id into v_request_id;

  v_target_kind := case
    when p_visibility = 'family' then 'family'
    when v_assignee.id = v_member.id then 'self'
    else 'assignee'
  end;

  v_content := case
    when v_target_kind = 'family' then '收到，我会提醒大家。'
    when v_target_kind = 'assignee' then '收到，我会提醒' || v_assignee.nickname || '。'
    else '收到，我会提醒你。'
  end;

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, system_event_type, system_event_payload
  )
  values (
    v_member.family_id,
    v_member.id,
    case when p_visibility = 'private' then v_assignee.id else null end,
    'system',
    v_content,
    'keeper_request_created',
    jsonb_build_object(
      'actor_type', 'keeper',
      'actor_name', 'おうち係',
      'request_id', v_request_id,
      'schedule_item_id', v_schedule_item_id,
      'target_kind', v_target_kind,
      'assignee_member_id', v_assignee.id,
      'assignee_nickname', v_assignee.nickname,
      'request_type', p_request_type
    )
  )
  returning id into v_message_id;

  update keeper_requests
     set source_message_id = v_message_id,
         updated_at = now()
   where id = v_request_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'schedule_item_id', v_schedule_item_id,
    'message_id', v_message_id
  );
end;
$$;

grant execute on function create_keeper_request(
  uuid, text, text, text, uuid, text, timestamptz, timestamptz, text
) to anon, authenticated;

create or replace function list_keeper_requests_for_member(
  p_member_id uuid,
  p_member_token text
)
returns table (
  id uuid,
  family_id uuid,
  requester_member_id uuid,
  assignee_member_id uuid,
  schedule_item_id uuid,
  source_message_id uuid,
  request_text text,
  request_type text,
  visibility text,
  status text,
  due_at timestamptz,
  remind_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
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
  select kr.id, kr.family_id, kr.requester_member_id, kr.assignee_member_id,
         kr.schedule_item_id, kr.source_message_id, kr.request_text,
         kr.request_type, kr.visibility, kr.status, kr.due_at, kr.remind_at,
         kr.created_at, kr.updated_at
    from keeper_requests kr
   where kr.family_id = v_member.family_id
     and (
       kr.visibility = 'family'
       or kr.requester_member_id = v_member.id
       or kr.assignee_member_id = v_member.id
     )
   order by kr.created_at desc, kr.id desc
   limit 200;
end;
$$;

grant execute on function list_keeper_requests_for_member(uuid, text)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_keeper_requests',
  'keeper_requests',
  'Adds the HomeGarden おうち係 request workflow.'
)
on conflict (version) do nothing;

-- 20260524_schedule_context_events
-- Schedule context conversation events with recipient-level visibility.

create table if not exists family_context_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  target_type text not null default 'schedule_item',
  target_id uuid not null,
  schedule_item_id uuid references family_schedule_items(id) on delete cascade,
  sender_type text not null default 'member',
  sender_member_id uuid references family_members(id) on delete set null,
  recipient_member_id uuid references family_members(id) on delete set null,
  event_type text not null,
  visibility text not null,
  text_content text,
  audio_url text,
  audio_duration_ms integer,
  latitude double precision,
  longitude double precision,
  location_label text,
  deleted_at timestamptz,
  deleted_by_member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_context_events_target_type_check
    check (target_type in ('schedule_item', 'keeper_request')),
  constraint family_context_events_sender_type_check
    check (sender_type in ('member', 'keeper', 'system')),
  constraint family_context_events_event_type_check
    check (event_type in ('text', 'audio', 'location', 'system')),
  constraint family_context_events_visibility_check
    check (visibility in ('family', 'private')),
  constraint family_context_events_text_length_check
    check (text_content is null or char_length(trim(text_content)) between 1 and 300),
  constraint family_context_events_audio_duration_check
    check (audio_duration_ms is null or audio_duration_ms >= 0),
  constraint family_context_events_latitude_check
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint family_context_events_longitude_check
    check (longitude is null or (longitude >= -180 and longitude <= 180))
);

create table if not exists family_context_event_recipients (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  event_id uuid not null references family_context_events(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, member_id)
);

create index if not exists family_context_events_schedule_created_idx
  on family_context_events (schedule_item_id, created_at asc)
  where schedule_item_id is not null and deleted_at is null;

create index if not exists family_context_events_family_created_idx
  on family_context_events (family_id, created_at desc);

create index if not exists family_context_event_recipients_member_created_idx
  on family_context_event_recipients (member_id, created_at desc);

create index if not exists family_context_event_recipients_event_member_idx
  on family_context_event_recipients (event_id, member_id);

alter table family_context_events enable row level security;
alter table family_context_event_recipients enable row level security;
revoke all on family_context_events from anon, authenticated;
revoke all on family_context_event_recipients from anon, authenticated;

drop policy if exists "family context events are rpc only" on family_context_events;
create policy "family context events are rpc only"
  on family_context_events for select
  to anon, authenticated
  using (false);

drop policy if exists "family context event recipients are rpc only" on family_context_event_recipients;
create policy "family context event recipients are rpc only"
  on family_context_event_recipients for select
  to anon, authenticated
  using (false);

create or replace function create_schedule_context_event(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_event_type text,
  p_text_content text default null,
  p_visibility text default 'family',
  p_recipient_member_id uuid default null,
  p_audio_url text default null,
  p_audio_duration_ms integer default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_location_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_recipient family_members%rowtype;
  v_text text;
  v_event_id uuid;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if coalesce(p_event_type, '') not in ('text', 'audio', 'location') then
    raise exception 'invalid_schedule_context_event_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_schedule_context_visibility';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.status <> 'cancelled';

  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;

  v_text := nullif(trim(coalesce(p_text_content, '')), '');
  if p_event_type = 'text' then
    if v_text is null then
      raise exception 'schedule_context_text_required';
    end if;
    if length(v_text) > 300 then
      raise exception 'schedule_context_text_too_long';
    end if;
  elsif p_event_type = 'audio' then
    if nullif(trim(coalesce(p_audio_url, '')), '') is null then
      raise exception 'schedule_context_audio_required';
    end if;
  elsif p_event_type = 'location' then
    if p_latitude is null or p_longitude is null then
      raise exception 'schedule_context_location_required';
    end if;
  end if;

  if p_visibility = 'private' then
    if p_recipient_member_id is null then
      raise exception 'schedule_context_recipient_required';
    end if;
    if p_recipient_member_id = v_member.id then
      raise exception 'cannot_whisper_self';
    end if;

    select * into v_recipient
      from family_members fm
     where fm.id = p_recipient_member_id
       and fm.family_id = v_member.family_id
       and fm.status = 'active'
     limit 1;
    if not found or not schedule_item_is_visible_to_member(v_item, v_recipient.id) then
      raise exception 'member_not_found';
    end if;
  end if;

  insert into family_context_events (
    family_id,
    target_type,
    target_id,
    schedule_item_id,
    sender_type,
    sender_member_id,
    recipient_member_id,
    event_type,
    visibility,
    text_content,
    audio_url,
    audio_duration_ms,
    latitude,
    longitude,
    location_label
  )
  values (
    v_member.family_id,
    'schedule_item',
    v_item.id,
    v_item.id,
    'member',
    v_member.id,
    case when p_visibility = 'private' then p_recipient_member_id else null end,
    p_event_type,
    p_visibility,
    v_text,
    nullif(trim(coalesce(p_audio_url, '')), ''),
    p_audio_duration_ms,
    p_latitude,
    p_longitude,
    nullif(trim(coalesce(p_location_label, '')), '')
  )
  returning id into v_event_id;

  if p_visibility = 'private' then
    insert into family_context_event_recipients (family_id, event_id, member_id)
    values
      (v_member.family_id, v_event_id, v_member.id),
      (v_member.family_id, v_event_id, p_recipient_member_id)
    on conflict (event_id, member_id) do nothing;
  else
    insert into family_context_event_recipients (family_id, event_id, member_id)
    select v_member.family_id, v_event_id, fm.id
      from family_members fm
     where fm.family_id = v_member.family_id
       and fm.status = 'active'
       and schedule_item_is_visible_to_member(v_item, fm.id)
    on conflict (event_id, member_id) do nothing;
  end if;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select v_member.family_id, v_item.id, r.member_id, 'commented'
    from family_context_event_recipients r
   where r.event_id = v_event_id;

  delete from family_schedule_events
   where created_at < now() - interval '1 day';

  return v_event_id;
end;
$$;

grant execute on function create_schedule_context_event(
  uuid, text, uuid, text, text, text, uuid, text, integer, double precision, double precision, text
) to anon, authenticated;

create or replace function list_schedule_context_events_for_member(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns table (
  id uuid,
  family_id uuid,
  schedule_item_id uuid,
  sender_type text,
  sender_member_id uuid,
  sender_nickname text,
  recipient_member_id uuid,
  recipient_nickname text,
  event_type text,
  visibility text,
  text_content text,
  audio_url text,
  audio_duration_ms integer,
  latitude double precision,
  longitude double precision,
  location_label text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null;

  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;

  return query
  select e.id,
         e.family_id,
         e.schedule_item_id,
         e.sender_type,
         e.sender_member_id,
         sender.nickname as sender_nickname,
         e.recipient_member_id,
         recipient.nickname as recipient_nickname,
         e.event_type,
         e.visibility,
         e.text_content,
         e.audio_url,
         e.audio_duration_ms,
         e.latitude,
         e.longitude,
         e.location_label,
         e.created_at
    from family_context_events e
    join family_context_event_recipients r
      on r.event_id = e.id
     and r.member_id = v_member.id
    left join family_members sender on sender.id = e.sender_member_id
    left join family_members recipient on recipient.id = e.recipient_member_id
   where e.schedule_item_id = v_item.id
     and e.deleted_at is null
   order by e.created_at asc, e.id asc
   limit 200;
end;
$$;

grant execute on function list_schedule_context_events_for_member(uuid, text, uuid)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_schedule_context_events',
  'schedule_context_events',
  'Adds schedule context conversation events with recipient visibility.'
)
on conflict (version) do nothing;

-- 20260524_member_avatar_profile
-- Personal profile avatar, owned by the current member token.

alter table family_members
  add column if not exists avatar_url text,
  add column if not exists avatar_updated_at timestamptz;

create or replace function update_member_avatar(
  p_member_id uuid,
  p_member_token text,
  p_avatar_url text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_clean_url text;
  v_avatar_ref_prefix text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_avatar_ref_prefix :=
    'storage://chat-images/avatars/'
    || v_member.family_id::text
    || '/'
    || v_member.id::text
    || '/';

  v_clean_url := nullif(trim(coalesce(p_avatar_url, '')), '');
  if v_clean_url is not null then
    if length(v_clean_url) > 2048 or not (
      v_clean_url ~* '^https?://[^[:space:]]+$'
      or (
        v_clean_url like v_avatar_ref_prefix || '%'
        and v_clean_url !~ '\.\.'
        and v_clean_url ~ '^storage://chat-images/[A-Za-z0-9/_.$-]+$'
      )
    ) then
      raise exception 'invalid_avatar_url';
    end if;
  end if;

  update family_members
     set avatar_url = v_clean_url,
         avatar_updated_at = case when v_clean_url is null then null else now() end,
         updated_at = now(),
         last_active_at = now()
   where id = v_member.id
     and family_id = v_member.family_id
     and status = 'active';

  return v_clean_url;
end;
$$;

grant execute on function update_member_avatar(uuid, text, text) to anon, authenticated;

-- 20260523_admin_security_foundation
-- Management admin security foundation.

alter table families
  add column if not exists is_disabled boolean not null default false,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_reason text,
  add column if not exists disabled_by_admin_id uuid;

create index if not exists families_disabled_created_idx
  on families (is_disabled, created_at desc);

alter table messages
  add column if not exists admin_deleted_by_admin_id uuid,
  add column if not exists admin_deleted_reason text;

create table if not exists admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'readonly'
    check (role in ('super_admin', 'operator', 'readonly')),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists admin_role_permissions (
  role text not null check (role in ('super_admin', 'operator', 'readonly')),
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (role, permission)
);

create table if not exists admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references admin_profiles(id) on delete set null,
  admin_email text,
  admin_role text not null default 'unknown',
  action text not null,
  target_type text not null,
  target_id text not null,
  family_id uuid references families(id) on delete set null,
  reason text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on admin_audit_logs (created_at desc);

create index if not exists admin_audit_logs_family_created_idx
  on admin_audit_logs (family_id, created_at desc)
  where family_id is not null;

create index if not exists admin_audit_logs_admin_created_idx
  on admin_audit_logs (admin_id, created_at desc)
  where admin_id is not null;

create index if not exists admin_audit_logs_action_created_idx
  on admin_audit_logs (action, created_at desc);

create table if not exists admin_metric_snapshots (
  snapshot_key text primary key default 'latest',
  period_start timestamptz not null,
  period_end timestamptz not null,
  recent_messages_24h int not null default 0,
  active_families_today int not null default 0,
  push_sent_24h int not null default 0,
  push_failed_24h int not null default 0,
  push_success_rate numeric(6, 5) not null default 0,
  upload_bytes_24h bigint not null default 0,
  generated_at timestamptz not null default now(),
  constraint admin_metric_snapshots_singleton check (snapshot_key = 'latest')
);

create table if not exists storage_upload_logs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references families(id) on delete set null,
  member_id uuid references family_members(id) on delete set null,
  bucket_id text not null,
  object_path text not null,
  mime_type text,
  byte_size bigint not null default 0,
  cleanup_status text not null default 'active'
    check (cleanup_status in ('active', 'marked_for_cleanup', 'cleaned')),
  cleanup_reason text,
  cleanup_marked_at timestamptz,
  cleanup_marked_by_admin_id uuid references admin_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table storage_upload_logs
  add column if not exists cleanup_status text not null default 'active',
  add column if not exists cleanup_reason text,
  add column if not exists cleanup_marked_at timestamptz,
  add column if not exists cleanup_marked_by_admin_id uuid references admin_profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'storage_upload_logs_cleanup_status_check'
       and conrelid = 'storage_upload_logs'::regclass
  ) then
    alter table storage_upload_logs
      add constraint storage_upload_logs_cleanup_status_check
      check (cleanup_status in ('active', 'marked_for_cleanup', 'cleaned'));
  end if;
end;
$$;

create index if not exists storage_upload_logs_family_created_idx
  on storage_upload_logs (family_id, created_at desc);

create index if not exists storage_upload_logs_created_idx
  on storage_upload_logs (created_at desc);

create index if not exists storage_upload_logs_cleanup_status_idx
  on storage_upload_logs (cleanup_status, created_at desc);

alter table admin_profiles enable row level security;
alter table admin_role_permissions enable row level security;
alter table admin_audit_logs enable row level security;
alter table admin_metric_snapshots enable row level security;
alter table storage_upload_logs enable row level security;

revoke all on admin_profiles from anon, authenticated;
revoke all on admin_role_permissions from anon, authenticated;
revoke all on admin_audit_logs from anon, authenticated;
revoke all on admin_metric_snapshots from anon, authenticated;
revoke all on storage_upload_logs from anon, authenticated;

grant select, insert, update on admin_profiles to service_role;
grant select, insert, update, delete on admin_role_permissions to service_role;
grant select, insert on admin_audit_logs to service_role;
grant select, insert, update, delete on admin_metric_snapshots to service_role;
grant select, insert, update on storage_upload_logs to service_role;

create or replace function prevent_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  raise exception 'admin_audit_logs_append_only';
end;
$$;

drop trigger if exists trg_admin_audit_logs_append_only on admin_audit_logs;
create trigger trg_admin_audit_logs_append_only
before update or delete on admin_audit_logs
for each row execute function prevent_admin_audit_mutation();

insert into admin_role_permissions (role, permission)
select role, permission
from (
  values
    ('readonly', 'admin.session'),
    ('readonly', 'dashboard.read'),
    ('readonly', 'audit.read'),
    ('readonly', 'system_health.read'),
    ('readonly', 'family.read'),
    ('readonly', 'member.read'),
    ('readonly', 'message.read_metadata'),
    ('readonly', 'push.read'),
    ('readonly', 'upload.read_metadata'),
    ('operator', 'admin.session'),
    ('operator', 'dashboard.read'),
    ('operator', 'audit.read'),
    ('operator', 'system_health.read'),
    ('operator', 'family.read'),
    ('operator', 'family.disable'),
    ('operator', 'family.reset_code'),
    ('operator', 'member.read'),
    ('operator', 'member.remove'),
    ('operator', 'member.restore'),
    ('operator', 'message.read_metadata'),
    ('operator', 'message.soft_delete'),
    ('operator', 'push.read'),
    ('operator', 'push.disable_endpoint'),
    ('operator', 'upload.read_metadata'),
    ('operator', 'upload.mark_cleanup'),
    ('super_admin', 'admin.session'),
    ('super_admin', 'admin.manage'),
    ('super_admin', 'dashboard.read'),
    ('super_admin', 'audit.read'),
    ('super_admin', 'system_health.read'),
    ('super_admin', 'family.read'),
    ('super_admin', 'family.disable'),
    ('super_admin', 'family.reset_code'),
    ('super_admin', 'member.read'),
    ('super_admin', 'member.remove'),
    ('super_admin', 'member.restore'),
    ('super_admin', 'message.read_metadata'),
    ('super_admin', 'message.soft_delete'),
    ('super_admin', 'push.read'),
    ('super_admin', 'push.disable_endpoint'),
    ('super_admin', 'upload.read_metadata'),
    ('super_admin', 'upload.mark_cleanup')
) as seed(role, permission)
on conflict (role, permission) do nothing;

create or replace function refresh_admin_metric_snapshot()
returns admin_metric_snapshots
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_start timestamptz := now() - interval '24 hours';
  v_today timestamptz := date_trunc('day', now());
  v_end timestamptz := now();
  v_sent int := 0;
  v_failed int := 0;
  v_row admin_metric_snapshots%rowtype;
begin
  select count(*)::int
    into v_sent
    from push_delivery_logs
   where created_at >= v_start
     and created_at < v_end
     and status = 'sent';

  select count(*)::int
    into v_failed
    from push_delivery_logs
   where created_at >= v_start
     and created_at < v_end
     and status in ('failed', 'gone');

  insert into admin_metric_snapshots (
    snapshot_key,
    period_start,
    period_end,
    recent_messages_24h,
    active_families_today,
    push_sent_24h,
    push_failed_24h,
    push_success_rate,
    upload_bytes_24h,
    generated_at
  )
  values (
    'latest',
    v_start,
    v_end,
    (select count(*)::int from messages where created_at >= v_start and created_at < v_end),
    (select count(distinct family_id)::int from messages where created_at >= v_today and created_at < v_end),
    v_sent,
    v_failed,
    case when (v_sent + v_failed) = 0 then 0 else v_sent::numeric / (v_sent + v_failed)::numeric end,
    (select coalesce(sum(byte_size), 0)::bigint from storage_upload_logs where created_at >= v_start and created_at < v_end),
    now()
  )
  on conflict (snapshot_key) do update set
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    recent_messages_24h = excluded.recent_messages_24h,
    active_families_today = excluded.active_families_today,
    push_sent_24h = excluded.push_sent_24h,
    push_failed_24h = excluded.push_failed_24h,
    push_success_rate = excluded.push_success_rate,
    upload_bytes_24h = excluded.upload_bytes_24h,
    generated_at = excluded.generated_at
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function refresh_admin_metric_snapshot() from public, anon, authenticated;
grant execute on function refresh_admin_metric_snapshot() to service_role;

insert into app_schema_migrations (version, name, description)
values (
  '20260523_admin_security_foundation',
  'admin_security_foundation',
  'Adds independent admin RBAC, audit logs, metric snapshot cache, and upload cleanup metadata.'
)
on conflict (version) do nothing;

-- 20260523_app_schema_health
-- Platform-only schema health catalog for production database consistency checks.

create table if not exists app_schema_migrations (
  version text primary key,
  name text not null,
  description text,
  applied_at timestamptz not null default now()
);

alter table app_schema_migrations enable row level security;
revoke all on app_schema_migrations from anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260523_app_schema_health',
  'app_schema_health',
  'Adds platform-only schema health catalog checks.'
)
on conflict (version) do nothing;

create or replace function schema_health_ping()
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('ok', true, 'checkedAt', now());
$$;

create or replace function get_system_health_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tables jsonb := '[]'::jsonb;
  v_columns jsonb := '[]'::jsonb;
  v_functions jsonb := '[]'::jsonb;
  v_grants jsonb := '[]'::jsonb;
  v_table_privileges jsonb := '[]'::jsonb;
  v_policies jsonb := '[]'::jsonb;
  v_realtime jsonb := '[]'::jsonb;
  v_buckets jsonb := '[]'::jsonb;
  v_supabase_migrations jsonb := '[]'::jsonb;
  v_app_migrations jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'name', c.relname,
    'rls', c.relrowsecurity
  ) order by n.nspname, c.relname), '[]'::jsonb)
    into v_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p')
     and n.nspname in ('public', 'storage');

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', table_schema,
    'table', table_name,
    'column', column_name
  ) order by table_schema, table_name, ordinal_position), '[]'::jsonb)
    into v_columns
    from information_schema.columns
   where table_schema in ('public', 'storage');

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'name', p.proname,
    'args', pg_get_function_identity_arguments(p.oid)
  ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    into v_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public';

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', routine_schema,
    'name', routine_name,
    'grantee', grantee,
    'privilege', privilege_type
  ) order by routine_schema, routine_name, grantee), '[]'::jsonb)
    into v_grants
    from information_schema.routine_privileges
   where routine_schema = 'public';

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', table_schema,
    'table', table_name,
    'grantee', grantee,
    'privilege', privilege_type
  ) order by table_schema, table_name, grantee, privilege_type), '[]'::jsonb)
    into v_table_privileges
    from information_schema.table_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated');

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', schemaname,
    'table', tablename,
    'policy', policyname,
    'roles', to_jsonb(roles),
    'command', cmd,
    'qual', qual
  ) order by schemaname, tablename, policyname), '[]'::jsonb)
    into v_policies
    from pg_policies
   where schemaname = 'public';

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', schemaname,
    'table', tablename
  ) order by schemaname, tablename), '[]'::jsonb)
    into v_realtime
    from pg_publication_tables
   where pubname = 'supabase_realtime';

  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', name) order by name), '[]'::jsonb)
      into v_buckets
      from storage.buckets;
  exception
    when undefined_table or insufficient_privilege then
      v_buckets := '[]'::jsonb;
      v_warnings := v_warnings || jsonb_build_array('storage_buckets_unavailable');
  end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'version', version::text,
      'name', name
    ) order by version), '[]'::jsonb)
      into v_supabase_migrations
      from supabase_migrations.schema_migrations;
  exception
    when undefined_table or insufficient_privilege then
      v_supabase_migrations := '[]'::jsonb;
      v_warnings := v_warnings || jsonb_build_array('supabase_migrations_unavailable');
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'version', version,
    'name', name
  ) order by version), '[]'::jsonb)
    into v_app_migrations
    from app_schema_migrations;

  return jsonb_build_object(
    'tables', v_tables,
    'columns', v_columns,
    'functions', v_functions,
    'routineGrants', v_grants,
    'tablePrivileges', v_table_privileges,
    'policies', v_policies,
    'realtimeTables', v_realtime,
    'buckets', v_buckets,
    'supabaseMigrations', v_supabase_migrations,
    'appMigrations', v_app_migrations,
    'catalogWarnings', v_warnings
  );
end;
$$;

revoke execute on function schema_health_ping() from public, anon, authenticated;
revoke execute on function get_system_health_catalog() from public, anon, authenticated;
grant execute on function schema_health_ping() to service_role;
grant execute on function get_system_health_catalog() to service_role;

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
-- Writes and private reads go through SECURITY DEFINER RPCs. Message bodies,
-- important notifications, and recipient rows must not be readable directly
-- through the Data API; Realtime uses content-free event tables instead.
-- =====================================================================

alter table families        enable row level security;
alter table family_members  enable row level security;
alter table messages        enable row level security;
alter table important_notifications enable row level security;
alter table push_subscriptions enable row level security;
alter table user_presence enable row level security;

revoke all on messages from anon, authenticated;
revoke all on important_notifications from anon, authenticated;

drop policy if exists "messages are readable by anon" on messages;
drop policy if exists "messages require RPC" on messages;
create policy "messages require RPC"
  on messages for select
  to anon, authenticated
  using (false);

drop policy if exists "members are readable by anon" on family_members;
create policy "members are readable by anon"
  on family_members for select
  to anon, authenticated
  using (true);

drop policy if exists "important notifications are readable by anon" on important_notifications;
drop policy if exists "important notifications require RPC" on important_notifications;
create policy "important notifications require RPC"
  on important_notifications for select
  to anon, authenticated
  using (false);

insert into app_schema_migrations (version, name, description)
values (
  '20260523_message_visibility_privacy_hardening',
  'message_visibility_privacy_hardening',
  'Enforces RPC-only reads for message privacy tables and adds privacy drift health checks.'
)
on conflict (version) do nothing;

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
values ('chat-images', 'chat-images', false)
on conflict (id) do update
set public = false;

drop policy if exists "chat-images public read" on storage.objects;

drop policy if exists "chat-images anon upload" on storage.objects;

insert into storage.buckets (id, name, public)
values ('chat-audios', 'chat-audios', false)
on conflict (id) do update
set public = false;

drop policy if exists "chat-audios public read" on storage.objects;

drop policy if exists "chat-audios anon upload" on storage.objects;

-- =====================================================================
-- Security hardening: family-code access model
-- =====================================================================

-- Harden the family-code access model without adding account/password auth.

create extension if not exists "pgcrypto";

alter table families
  add column if not exists code_updated_at timestamptz not null default now(),
  add column if not exists code_expires_at timestamptz,
  add column if not exists admin_password_updated_at timestamptz;

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

grant execute on function add_important_notification(uuid, text, uuid) to anon, authenticated;
grant execute on function list_important_notifications_for_member(uuid, text) to anon, authenticated;

-- =====================================================================
-- Message recipients inbox
-- =====================================================================

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
create policy "message recipients are rpc only"
  on message_recipients for select
  to anon, authenticated
  using (false);

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
drop trigger if exists trg_10_populate_message_recipients on messages;

create trigger trg_10_populate_message_recipients
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

-- =====================================================================
-- Message family seq sync
-- =====================================================================

alter table messages
  add column if not exists family_seq bigint;

create table if not exists family_message_sequences (
  family_id uuid primary key references families(id) on delete cascade,
  next_seq bigint not null default 1
);

alter table family_message_sequences enable row level security;

revoke all on table family_message_sequences from public;
revoke all on table family_message_sequences from anon, authenticated;

grant all on table family_message_sequences to service_role;

with ranked as (
  select m.id,
         coalesce(existing.max_seq, 0) +
           row_number() over (
             partition by m.family_id
             order by m.created_at asc, m.id asc
           ) as next_family_seq
    from messages m
    left join lateral (
      select max(family_seq) as max_seq
        from messages existing
       where existing.family_id = m.family_id
         and existing.family_seq is not null
    ) existing on true
   where m.family_seq is null
)
update messages m
   set family_seq = ranked.next_family_seq
  from ranked
 where ranked.id = m.id;

create unique index if not exists messages_family_seq_uidx
  on messages (family_id, family_seq)
  where family_seq is not null;

create index if not exists messages_family_seq_idx
  on messages (family_id, family_seq asc);

insert into family_message_sequences (family_id, next_seq)
select f.id, coalesce(max(m.family_seq), 0) + 1
  from families f
  left join messages m on m.family_id = f.id
 group by f.id
on conflict (family_id) do update
   set next_seq = excluded.next_seq
 where family_message_sequences.next_seq < excluded.next_seq;

create or replace function next_family_message_seq(p_family_id uuid)
returns bigint
security definer
set search_path = public, extensions
language sql
as $$
  insert into family_message_sequences (family_id, next_seq)
  values (p_family_id, 2)
  on conflict (family_id) do update
     set next_seq = family_message_sequences.next_seq + 1
  returning next_seq - 1;
$$;

revoke all on function next_family_message_seq(uuid) from public;
revoke all on function next_family_message_seq(uuid) from anon, authenticated;

create or replace function assign_message_family_seq()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
begin
  if new.family_seq is null then
    new.family_seq := next_family_message_seq(new.family_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_message_family_seq on messages;

create trigger trg_assign_message_family_seq
before insert on messages
for each row
execute function assign_message_family_seq();

drop function if exists list_messages_for_member(uuid, text, int);
drop function if exists list_messages_delta(uuid, text, timestamptz, uuid, int);
drop function if exists get_message_for_member(uuid, text, uuid);
drop function if exists get_messages_by_ids_for_member(uuid, text, uuid[]);
drop function if exists list_messages_after_seq(uuid, text, bigint, int);
drop function if exists list_important_notifications_for_member(uuid, text);

create or replace function list_messages_for_member(
  p_member_id uuid,
  p_member_token text,
  p_limit int default 100
)
returns table (
  id uuid,
  family_id uuid,
  family_seq bigint,
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
  select m.id, m.family_id, m.family_seq, m.sender_member_id, m.recipient_member_id,
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
  family_seq bigint,
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
  select m.id, m.family_id, m.family_seq, m.sender_member_id, m.recipient_member_id,
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

create or replace function list_messages_after_seq(
  p_member_id uuid,
  p_member_token text,
  p_after_seq bigint default 0,
  p_limit int default 300
)
returns table (
  id uuid,
  family_id uuid,
  family_seq bigint,
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
  v_after_seq bigint;
  v_limit int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_after_seq := greatest(coalesce(p_after_seq, 0), 0);
  v_limit := least(greatest(coalesce(p_limit, 300), 1), 300);

  return query
  select m.id, m.family_id, m.family_seq, m.sender_member_id, m.recipient_member_id,
         m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload, m.push_requested_at,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from message_recipients mr
    join messages m on m.id = mr.message_id and m.family_id = mr.family_id
   where mr.member_id = v_member.id
     and m.family_seq is not null
     and m.family_seq > v_after_seq
   order by m.family_seq asc, m.id asc
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
  family_seq bigint,
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
  select m.id, m.family_id, m.family_seq, m.sender_member_id, m.recipient_member_id,
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
  family_seq bigint,
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
  select m.id, m.family_id, m.family_seq, m.sender_member_id, m.recipient_member_id,
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
   order by m.family_seq asc nulls last, m.created_at asc, m.id asc;
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
  message_family_seq bigint,
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
         m.family_id, m.family_seq, m.sender_member_id, m.recipient_member_id,
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
grant execute on function list_messages_after_seq(uuid, text, bigint, int) to anon, authenticated;
grant execute on function get_message_for_member(uuid, text, uuid) to anon, authenticated;
grant execute on function get_messages_by_ids_for_member(uuid, text, uuid[]) to anon, authenticated;
grant execute on function list_important_notifications_for_member(uuid, text) to anon, authenticated;

-- =====================================================================
-- Message delivery and read state
-- =====================================================================

create index if not exists message_recipients_member_delivery_idx
  on message_recipients (member_id, delivery_state, created_at desc);

create index if not exists message_recipients_pending_notify_idx
  on message_recipients (family_id, delivery_state, notified_at)
  where delivery_state = 'pending';

create or replace function mark_messages_delivered(
  p_member_id uuid,
  p_member_token text,
  p_message_ids uuid[]
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_count int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if p_message_ids is null or cardinality(p_message_ids) = 0 then
    return;
  end if;

  v_count := cardinality(p_message_ids);
  if v_count > 300 then
    raise exception 'too_many_message_ids';
  end if;

  update message_recipients mr
     set delivery_state = 'delivered',
         delivered_at = coalesce(mr.delivered_at, now())
    from (
      select distinct requested.message_id
        from unnest(p_message_ids) as requested(message_id)
       where requested.message_id is not null
    ) requested
   where mr.member_id = v_member.id
     and mr.family_id = v_member.family_id
     and mr.message_id = requested.message_id
     and mr.delivery_state = 'pending';
end;
$$;

create or replace function mark_messages_read(
  p_member_id uuid,
  p_member_token text,
  p_message_ids uuid[]
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_count int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if p_message_ids is null or cardinality(p_message_ids) = 0 then
    return;
  end if;

  v_count := cardinality(p_message_ids);
  if v_count > 300 then
    raise exception 'too_many_message_ids';
  end if;

  update message_recipients mr
     set delivery_state = 'read',
         delivered_at = coalesce(mr.delivered_at, now()),
         read_at = coalesce(mr.read_at, now())
    from (
      select distinct requested.message_id
        from unnest(p_message_ids) as requested(message_id)
       where requested.message_id is not null
    ) requested
   where mr.member_id = v_member.id
     and mr.family_id = v_member.family_id
     and mr.message_id = requested.message_id
     and (mr.delivery_state <> 'read' or mr.read_at is null);
end;
$$;

create or replace function get_unread_count_for_member(
  p_member_id uuid,
  p_member_token text
)
returns int
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_count int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select count(*)::int into v_count
    from message_recipients mr
    join messages m
      on m.id = mr.message_id
     and m.family_id = mr.family_id
   where mr.member_id = v_member.id
     and mr.family_id = v_member.family_id
     and mr.read_at is null
     and coalesce(m.sender_member_id, '00000000-0000-0000-0000-000000000000'::uuid)
         <> v_member.id;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function mark_messages_delivered(uuid, text, uuid[]) to anon, authenticated;
grant execute on function mark_messages_read(uuid, text, uuid[]) to anon, authenticated;
grant execute on function get_unread_count_for_member(uuid, text) to anon, authenticated;

-- =====================================================================
-- Auth owner + pending family code flow
-- =====================================================================

alter table families
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists family_code_email_sent_at timestamptz;

alter table family_members
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists families_owner_user_id_idx
  on families (owner_user_id)
  where owner_user_id is not null;

create index if not exists family_members_user_id_idx
  on family_members (user_id)
  where user_id is not null;

create table if not exists pending_family_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  family_code text unique not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'used', 'expired')),
  verified_at timestamptz,
  used_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pending_family_codes_user_status_idx
  on pending_family_codes (user_id, status, expires_at desc);

create index if not exists pending_family_codes_active_code_idx
  on pending_family_codes (family_code)
  where status in ('pending', 'verified');

alter table pending_family_codes enable row level security;

revoke all on pending_family_codes from anon, authenticated;

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
    for i in 1..6 loop
      v_byte := get_byte(gen_random_bytes(1), 0);
      code := code || substr(alphabet, (v_byte % length(alphabet)) + 1, 1);
    end loop;

    exit when not exists (select 1 from families where family_code = code)
      and not exists (
        select 1
          from pending_family_codes p
         where p.family_code = code
           and p.status in ('pending', 'verified')
           and p.expires_at > now()
      );

    attempt := attempt + 1;
    if attempt > 50 then
      raise exception 'family_code_generation_failed';
    end if;
  end loop;

  return code;
end;
$$;

create or replace function hash_admin_password(secret text)
returns text
language sql
set search_path = public, extensions
as $$
  select crypt(secret, gen_salt('bf', 10));
$$;

create or replace function verify_admin_password_hash(secret text, stored_hash text)
returns boolean
language plpgsql
set search_path = public, extensions
as $$
begin
  if secret is null or stored_hash is null then
    return false;
  end if;

  if stored_hash ~ '^[0-9a-f]{64}$' then
    return stored_hash = hash_secret(secret);
  end if;

  return stored_hash = crypt(secret, stored_hash);
end;
$$;

create or replace function require_admin(
  p_member_id uuid,
  p_member_token text,
  p_admin_password text
)
returns uuid
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
  v_is_admin boolean;
  v_password_hash text;
begin
  select fm.family_id, fm.is_admin, f.admin_password_hash
    into v_family_id, v_is_admin, v_password_hash
    from family_members fm
    join families f on f.id = fm.family_id
   where fm.id = p_member_id
     and fm.status = 'active'
     and (
       fm.access_token_hash = hash_secret(p_member_token)
       or fm.member_token_hash = hash_secret(p_member_token)
     );

  if v_family_id is null then
    raise exception 'unauthorized';
  end if;
  if not v_is_admin then
    raise exception 'not_admin';
  end if;
  if not verify_admin_password_hash(p_admin_password, v_password_hash) then
    raise exception 'invalid_admin_password';
  end if;

  return v_family_id;
end;
$$;

create or replace function create_family_with_verified_code(
  p_user_id uuid,
  p_email text,
  p_family_code text,
  p_family_name text,
  p_admin_password text,
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
  v_pending pending_family_codes%rowtype;
  v_family_id uuid;
  v_member_id uuid;
  v_token text;
  v_family_name text;
  v_code text;
begin
  v_family_name := trim(coalesce(p_family_name, ''));
  v_code := upper(trim(coalesce(p_family_code, '')));

  if p_user_id is null then
    raise exception 'unauthorized';
  end if;
  if exists (
    select 1
      from family_members fm
     where fm.user_id = p_user_id
       and fm.status = 'active'
     limit 1
  ) then
    raise exception 'account_already_has_family';
  end if;
  if length(v_family_name) = 0 or length(v_family_name) > 30 then
    raise exception 'family_name_required';
  end if;
  if p_admin_password is null or length(p_admin_password) < 6 or length(p_admin_password) > 128 then
    raise exception 'admin_password_too_short';
  end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 or length(trim(p_nickname)) > 20 then
    raise exception 'nickname_required';
  end if;
  if p_role not in ('father', 'mother', 'child') then
    raise exception 'invalid_role';
  end if;

  select * into v_pending
    from pending_family_codes p
   where p.user_id = p_user_id
     and p.family_code = v_code
   order by p.created_at desc
   limit 1
   for update;

  if not found then
    raise exception 'invalid_family_code';
  end if;
  if v_pending.status = 'used' then
    raise exception 'family_code_used';
  end if;
  if v_pending.expires_at <= now() or v_pending.status = 'expired' then
    update pending_family_codes
       set status = 'expired', updated_at = now()
     where id = v_pending.id and status <> 'expired';
    raise exception 'family_code_expired';
  end if;
  if v_pending.status <> 'verified' then
    raise exception 'family_code_not_verified';
  end if;
  if exists (select 1 from families f where f.family_code = v_code) then
    raise exception 'family_code_used';
  end if;

  v_token := gen_random_uuid()::text;

  insert into families (
    owner_user_id, name, family_code, admin_password_hash,
    family_code_email_sent_at, code_updated_at
  )
  values (
    p_user_id, v_family_name, v_code, hash_admin_password(p_admin_password),
    now(), now()
  )
  returning id into v_family_id;

  insert into family_members (
    family_id, user_id, nickname, role, member_token_hash, access_token_hash,
    device_id, is_admin, last_active_at, last_seen_at
  )
  values (
    v_family_id, p_user_id, trim(p_nickname), p_role, hash_secret(v_token),
    hash_secret(v_token), nullif(trim(coalesce(p_device_id, '')), ''),
    true, now(), now()
  )
  returning id into v_member_id;

  update families
     set created_by_member_id = v_member_id
   where id = v_family_id;

  update pending_family_codes
     set status = 'used', used_at = now(), updated_at = now()
   where id = v_pending.id;

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_family_id,
    'system',
    trim(p_nickname) || U&'\521B\5EFA\4E86\5BB6\5EAD',
    'family_created',
    jsonb_build_object('family_name', v_family_name, 'nickname', trim(p_nickname))
  );

  return query
  select v_family_id, v_family_name, v_code, v_member_id, v_token, true;
end;
$$;

create or replace function issue_member_session_for_user(
  p_user_id uuid,
  p_device_id text default null
)
returns table (
  family_id uuid,
  family_name text,
  family_code text,
  member_id uuid,
  member_token text,
  device_id text,
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
  v_member family_members%rowtype;
  v_family families%rowtype;
  v_token text;
  v_device text;
begin
  if p_user_id is null then
    raise exception 'unauthorized';
  end if;

  select * into v_member
    from family_members fm
   where fm.user_id = p_user_id
     and fm.status = 'active'
   order by fm.created_at asc
   limit 1;

  if not found then
    return;
  end if;

  select * into v_family from families where id = v_member.family_id;
  if not found then
    return;
  end if;

  v_token := gen_random_uuid()::text;
  v_device := nullif(trim(coalesce(p_device_id, '')), '');

  update family_members
     set member_token_hash = hash_secret(v_token),
         access_token_hash = hash_secret(v_token),
         device_id = coalesce(v_device, device_id),
         last_active_at = now(),
         last_seen_at = now(),
         updated_at = now()
   where id = v_member.id;

  return query
  select v_family.id, v_family.name, v_family.family_code,
         v_member.id, v_token, coalesce(v_device, v_member.device_id),
         v_member.nickname, v_member.role, v_member.is_admin;
end;
$$;

revoke execute on function create_family(text, text, text, text, text) from anon, authenticated;
grant execute on function create_family_with_verified_code(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function issue_member_session_for_user(uuid, text) to service_role;

create or replace function update_admin_password(
  p_member_id uuid,
  p_member_token text,
  p_current_password text,
  p_new_password text
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
begin
  if p_new_password is null or length(p_new_password) < 6 or length(p_new_password) > 128 then
    raise exception 'admin_password_too_short';
  end if;

  v_family_id := require_admin(p_member_id, p_member_token, p_current_password);

  update families
     set admin_password_hash = hash_admin_password(p_new_password),
         admin_password_updated_at = now(),
         updated_at = now()
   where id = v_family_id;

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_family_id,
    'system',
    U&'\7BA1\7406\5458\5DF2\4FEE\6539\7BA1\7406\5BC6\7801',
    'admin_password_changed',
    '{}'::jsonb
  );
end;
$$;

grant execute on function update_admin_password(uuid, text, text, text) to anon, authenticated;

create or replace function resolve_join_family_state(
  p_family_code text,
  p_nickname text
)
returns table (status text)
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

  if not found then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    return query select 'invalid_family_code'::text;
    return;
  end if;

  if not v_family.join_enabled then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    return query select 'join_disabled'::text;
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

  if not found then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_family_code';
  end if;

  if not v_family.join_enabled then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'join_disabled';
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

grant execute on function resolve_join_family_state(text, text) to anon, authenticated;
grant execute on function join_family(text, text, text, text) to anon, authenticated;

-- Tighten newly added auth-family RPC grants.
revoke execute on function create_family(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function create_family_with_verified_code(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function issue_member_session_for_user(uuid, text) from public, anon, authenticated;
revoke execute on function require_admin(uuid, text, text) from public, anon, authenticated;

grant execute on function create_family_with_verified_code(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function issue_member_session_for_user(uuid, text) to service_role;

-- 20260518_rejoin_uses_admin_password_hash_verify
-- Rejoin-by-nickname must accept both legacy sha256 admin password hashes
-- and newer salted hashes created by create_family_with_verified_code.

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
    raise exception 'invalid_admin_password';
  end if;

  select * into v_family
    from families
   where families.family_code = v_clean_code
     and (families.code_expires_at is null or families.code_expires_at > now())
   limit 1;

  if not found then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'invalid_family_code';
  end if;

  if not verify_admin_password_hash(p_admin_password, v_family.admin_password_hash) then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
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
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    raise exception 'member_not_found';
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

grant execute on function rejoin_family_member(text, text, text, text) to anon, authenticated;


-- 20260518_reset_admin_password_by_owner
-- Allow the family owner account to reset the family admin password
-- without knowing the current admin password.

create or replace function reset_admin_password_by_owner(
  p_user_id uuid,
  p_member_id uuid,
  p_member_token text,
  p_new_password text
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
  v_owner_user_id uuid;
  v_is_admin boolean;
begin
  if p_user_id is null then
    raise exception 'unauthorized';
  end if;
  if p_new_password is null or length(p_new_password) < 6 or length(p_new_password) > 128 then
    raise exception 'admin_password_too_short';
  end if;

  select fm.family_id, fm.is_admin, f.owner_user_id
    into v_family_id, v_is_admin, v_owner_user_id
    from family_members fm
    join families f on f.id = fm.family_id
   where fm.id = p_member_id
     and fm.status = 'active'
     and (
       fm.access_token_hash = hash_secret(p_member_token)
       or fm.member_token_hash = hash_secret(p_member_token)
     );

  if v_family_id is null then
    raise exception 'member_not_found';
  end if;
  if not v_is_admin then
    raise exception 'not_admin';
  end if;
  if v_owner_user_id is null or v_owner_user_id <> p_user_id then
    raise exception 'owner_required';
  end if;

  update families
     set admin_password_hash = hash_admin_password(p_new_password),
         admin_password_updated_at = now(),
         updated_at = now()
   where id = v_family_id;

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_family_id,
    'system',
    U&'\7BA1\7406\5BC6\7801\5DF2\91CD\7F6E',
    'admin_password_changed',
    jsonb_build_object('by_owner_user_id', p_user_id)
  );
end;
$$;

revoke execute on function reset_admin_password_by_owner(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function reset_admin_password_by_owner(uuid, uuid, text, text)
  to service_role;

-- 20260518_email_login_replaces_admin_password
-- Admin-sensitive flows now use the family owner's Supabase Auth session.
-- Keep legacy functions defined for old deployments, but stop exposing them
-- to browser clients where a separate admin password could be used directly.

revoke execute on function update_family_name(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function reset_family_code(uuid, text, text) from public, anon, authenticated;
revoke execute on function set_join_enabled(uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function update_admin_password(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function rejoin_family_member(text, text, text, text) from public, anon, authenticated;
revoke execute on function remove_member(uuid, text, uuid) from public, anon, authenticated;

grant execute on function update_family_name(uuid, text, text, text) to service_role;
grant execute on function reset_family_code(uuid, text, text) to service_role;
grant execute on function set_join_enabled(uuid, text, text, boolean) to service_role;
grant execute on function update_admin_password(uuid, text, text, text) to service_role;
grant execute on function rejoin_family_member(text, text, text, text) to service_role;
grant execute on function remove_member(uuid, text, uuid) to service_role;

-- 20260518_resend_existing_family_code
-- Store the creator email for already-created families so the current
-- official family code can be resent to that mailbox without exposing it.

alter table families
  add column if not exists owner_email text;

create index if not exists families_owner_email_lower_idx
  on families (lower(owner_email))
  where owner_email is not null;

with used_codes as (
  select distinct on (p.user_id)
         p.user_id,
         lower(trim(p.email)) as email
    from pending_family_codes p
   where p.status = 'used'
     and p.email is not null
     and length(trim(p.email)) > 0
   order by p.user_id, p.used_at desc nulls last, p.created_at desc
)
update families f
   set owner_email = used_codes.email,
       updated_at = f.updated_at
  from used_codes
 where f.owner_user_id = used_codes.user_id
   and f.owner_email is null;

create table if not exists family_code_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  ip_hash text not null,
  sent boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists family_code_recovery_attempts_email_created_idx
  on family_code_recovery_attempts (email_hash, created_at desc);

create index if not exists family_code_recovery_attempts_ip_created_idx
  on family_code_recovery_attempts (ip_hash, created_at desc);

alter table family_code_recovery_attempts enable row level security;
revoke all on family_code_recovery_attempts from anon, authenticated;

create or replace function create_family_with_verified_code(
  p_user_id uuid,
  p_email text,
  p_family_code text,
  p_family_name text,
  p_admin_password text,
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
  v_pending pending_family_codes%rowtype;
  v_family_id uuid;
  v_member_id uuid;
  v_token text;
  v_family_name text;
  v_code text;
  v_owner_email text;
begin
  v_family_name := trim(coalesce(p_family_name, ''));
  v_code := upper(trim(coalesce(p_family_code, '')));
  v_owner_email := lower(trim(coalesce(p_email, '')));

  if p_user_id is null then
    raise exception 'unauthorized';
  end if;
  if length(v_owner_email) = 0 then
    raise exception 'email_required';
  end if;
  if exists (
    select 1
      from family_members fm
     where fm.user_id = p_user_id
       and fm.status = 'active'
     limit 1
  ) then
    raise exception 'account_already_has_family';
  end if;
  if length(v_family_name) = 0 or length(v_family_name) > 30 then
    raise exception 'family_name_required';
  end if;
  if p_admin_password is null or length(p_admin_password) < 6 or length(p_admin_password) > 128 then
    raise exception 'admin_password_too_short';
  end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 or length(trim(p_nickname)) > 20 then
    raise exception 'nickname_required';
  end if;
  if p_role not in ('father', 'mother', 'child') then
    raise exception 'invalid_role';
  end if;

  select * into v_pending
    from pending_family_codes p
   where p.user_id = p_user_id
     and p.family_code = v_code
   order by p.created_at desc
   limit 1
   for update;

  if not found then
    raise exception 'invalid_family_code';
  end if;
  if v_pending.status = 'used' then
    raise exception 'family_code_used';
  end if;
  if v_pending.expires_at <= now() or v_pending.status = 'expired' then
    update pending_family_codes
       set status = 'expired', updated_at = now()
     where id = v_pending.id and status <> 'expired';
    raise exception 'family_code_expired';
  end if;
  if v_pending.status <> 'verified' then
    raise exception 'family_code_not_verified';
  end if;
  if exists (select 1 from families f where f.family_code = v_code) then
    raise exception 'family_code_used';
  end if;

  v_token := gen_random_uuid()::text;

  insert into families (
    owner_user_id, owner_email, name, family_code, admin_password_hash,
    family_code_email_sent_at, code_updated_at
  )
  values (
    p_user_id, v_owner_email, v_family_name, v_code, hash_admin_password(p_admin_password),
    now(), now()
  )
  returning id into v_family_id;

  insert into family_members (
    family_id, user_id, nickname, role, member_token_hash, access_token_hash,
    device_id, is_admin, last_active_at, last_seen_at
  )
  values (
    v_family_id, p_user_id, trim(p_nickname), p_role, hash_secret(v_token),
    hash_secret(v_token), nullif(trim(coalesce(p_device_id, '')), ''),
    true, now(), now()
  )
  returning id into v_member_id;

  update families
     set created_by_member_id = v_member_id
   where id = v_family_id;

  update pending_family_codes
     set status = 'used', used_at = now(), updated_at = now()
   where id = v_pending.id;

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_family_id,
    'system',
    trim(p_nickname) || U&'\521B\5EFA\4E86\5BB6\5EAD',
    'family_created',
    jsonb_build_object('family_name', v_family_name, 'nickname', trim(p_nickname))
  );

  return query
  select v_family_id, v_family_name, v_code, v_member_id, v_token, true;
end;
$$;

revoke execute on function create_family_with_verified_code(uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function create_family_with_verified_code(uuid, text, text, text, text, text, text, text)
  to service_role;

-- 20260522_family_schedule_items
-- Family schedule v1: private/family-visible items managed through RPCs.

create table if not exists family_schedule_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  creator_member_id uuid not null references family_members(id) on delete cascade,
  assignee_member_id uuid not null references family_members(id) on delete cascade,
  title text not null,
  note text,
  item_type text not null default 'schedule',
  visibility text not null default 'family',
  starts_at timestamptz not null,
  ends_at timestamptz,
  remind_at timestamptz,
  status text not null default 'active',
  completed_at timestamptz,
  completed_by_member_id uuid references family_members(id) on delete set null,
  deleted_at timestamptz,
  deleted_by_member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_item_type_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_item_type_check
      check (item_type in ('schedule', 'todo', 'reminder'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_visibility_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_visibility_check
      check (visibility in ('family', 'private'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_status_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_status_check
      check (status in ('active', 'done', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_title_length_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_title_length_check
      check (char_length(trim(title)) between 1 and 60);
  end if;
end;
$$;

create index if not exists family_schedule_items_family_starts_idx
  on family_schedule_items (family_id, starts_at);

create index if not exists family_schedule_items_assignee_starts_idx
  on family_schedule_items (assignee_member_id, starts_at);

create index if not exists family_schedule_items_creator_starts_idx
  on family_schedule_items (creator_member_id, starts_at);

create index if not exists family_schedule_items_family_visibility_starts_idx
  on family_schedule_items (family_id, visibility, starts_at);

alter table family_schedule_items enable row level security;
revoke all on family_schedule_items from anon, authenticated;

drop policy if exists "family schedule items are rpc only" on family_schedule_items;

drop function if exists list_schedule_items_for_member(uuid, text, timestamptz, timestamptz);

create or replace function list_schedule_items_for_member(
  p_member_id uuid,
  p_member_token text,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns table (
  id uuid,
  family_id uuid,
  creator_member_id uuid,
  assignee_member_id uuid,
  title text,
  note text,
  item_type text,
  visibility text,
  starts_at timestamptz,
  ends_at timestamptz,
  remind_at timestamptz,
  status text,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_nickname text,
  assignee_nickname text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'invalid_schedule_range';
  end if;

  return query
  select s.id, s.family_id, s.creator_member_id, s.assignee_member_id,
         s.title, s.note, s.item_type, s.visibility, s.starts_at, s.ends_at,
         s.remind_at, s.status, s.completed_at, s.completed_by_member_id,
         s.created_at, s.updated_at,
         creator.nickname as creator_nickname,
         assignee.nickname as assignee_nickname
    from family_schedule_items s
    join family_members creator on creator.id = s.creator_member_id
    join family_members assignee on assignee.id = s.assignee_member_id
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.starts_at >= p_range_start
     and s.starts_at < p_range_end
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   order by s.starts_at asc, s.created_at asc, s.id asc;
end;
$$;

create or replace function create_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_assignee_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_assignee family_members%rowtype;
  v_title text;
  v_note text;
  v_id uuid;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if length(v_title) = 0 then
    raise exception 'schedule_title_required';
  end if;
  if length(v_title) > 60 then
    raise exception 'schedule_title_too_long';
  end if;
  if coalesce(p_item_type, '') not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_schedule_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;
  if p_starts_at is null then
    raise exception 'invalid_schedule_time';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'invalid_schedule_time';
  end if;

  select * into v_assignee
    from family_members fm
   where fm.id = p_assignee_member_id
     and fm.family_id = v_member.family_id
     and fm.status = 'active'
   limit 1;
  if not found then
    raise exception 'member_not_found';
  end if;

  insert into family_schedule_items (
    family_id, creator_member_id, assignee_member_id, title, note, item_type,
    visibility, starts_at, ends_at, remind_at
  )
  values (
    v_member.family_id, v_member.id, v_assignee.id, v_title, v_note,
    p_item_type, p_visibility, p_starts_at, p_ends_at, p_remind_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function set_schedule_item_status(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if coalesce(p_status, '') not in ('active', 'done') then
    raise exception 'invalid_schedule_status';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if v_item.creator_member_id <> v_member.id and v_item.assignee_member_id <> v_member.id then
    raise exception 'not_allowed';
  end if;

  update family_schedule_items
     set status = p_status,
         completed_at = case when p_status = 'done' then now() else null end,
         completed_by_member_id = case when p_status = 'done' then v_member.id else null end,
         updated_at = now()
   where id = v_item.id;
end;
$$;

create or replace function delete_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_can_delete boolean;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;

  v_can_delete :=
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin);

  if not v_can_delete then
    raise exception 'not_allowed';
  end if;

  update family_schedule_items
     set status = 'cancelled',
         deleted_at = now(),
         deleted_by_member_id = v_member.id,
         updated_at = now()
   where id = v_item.id;
end;
$$;

grant execute on function list_schedule_items_for_member(uuid, text, timestamptz, timestamptz)
  to anon, authenticated;

-- Family schedule stage 8: server-side search and filters.
drop function if exists search_schedule_items_for_member(
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  uuid,
  text,
  text,
  int
);

create or replace function search_schedule_items_for_member(
  p_member_id uuid,
  p_member_token text,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_query text default null,
  p_assignee_member_id uuid default null,
  p_item_type text default null,
  p_visibility text default null,
  p_limit int default 300
)
returns table (
  id uuid,
  family_id uuid,
  creator_member_id uuid,
  assignee_member_id uuid,
  title text,
  note text,
  item_type text,
  visibility text,
  starts_at timestamptz,
  ends_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  reminder_push_attempted_at timestamptz,
  recurrence_group_id uuid,
  recurrence_rule text,
  recurrence_index int,
  status text,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_nickname text,
  assignee_nickname text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_query text;
  v_limit int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'invalid_schedule_range';
  end if;

  v_query := nullif(trim(coalesce(p_query, '')), '');
  if v_query is not null and length(v_query) > 40 then
    raise exception 'invalid_schedule_search';
  end if;

  if p_item_type is not null and p_item_type not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_schedule_filter';
  end if;
  if p_visibility is not null and p_visibility not in ('family', 'private') then
    raise exception 'invalid_schedule_filter';
  end if;
  if p_assignee_member_id is not null and not exists (
    select 1
      from family_members fm
     where fm.id = p_assignee_member_id
       and fm.family_id = v_member.family_id
       and fm.status = 'active'
  ) then
    raise exception 'invalid_schedule_filter';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 300), 1), 300);

  return query
  select s.id, s.family_id, s.creator_member_id, s.assignee_member_id,
         s.title, s.note, s.item_type, s.visibility, s.starts_at, s.ends_at,
         s.remind_at, s.reminded_at, s.reminder_push_attempted_at,
         s.recurrence_group_id, s.recurrence_rule, s.recurrence_index,
         s.status, s.completed_at, s.completed_by_member_id,
         s.created_at, s.updated_at,
         creator.nickname as creator_nickname,
         assignee.nickname as assignee_nickname
    from family_schedule_items s
    join family_members creator on creator.id = s.creator_member_id
    join family_members assignee on assignee.id = s.assignee_member_id
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.starts_at >= p_range_start
     and s.starts_at < p_range_end
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
     and (v_query is null or s.title ilike '%' || v_query || '%' or coalesce(s.note, '') ilike '%' || v_query || '%')
     and (p_assignee_member_id is null or s.assignee_member_id = p_assignee_member_id)
     and (p_item_type is null or s.item_type = p_item_type)
     and (p_visibility is null or s.visibility = p_visibility)
   order by s.starts_at asc, s.created_at asc, s.id asc
   limit v_limit;
end;
$$;

grant execute on function search_schedule_items_for_member(
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  uuid,
  text,
  text,
  int
) to anon, authenticated;

-- 20260523_personal_dashboard
-- Family schedule stage 7: personal dashboard aggregation.

create or replace function get_personal_dashboard_for_member(
  p_member_id uuid,
  p_member_token text,
  p_today_start timestamptz,
  p_today_end timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_result jsonb;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_today_start is null or p_today_end is null or p_today_end <= p_today_start then
    raise exception 'invalid_schedule_range';
  end if;
  if p_now is null then
    raise exception 'invalid_schedule_time';
  end if;

  with visible_items as (
    select s.*,
           creator.nickname as creator_nickname,
           assignee.nickname as assignee_nickname
      from family_schedule_items s
      join family_members creator on creator.id = s.creator_member_id
      join family_members assignee on assignee.id = s.assignee_member_id
     where s.family_id = v_member.family_id
       and s.deleted_at is null
       and (
         s.visibility = 'family'
         or s.creator_member_id = v_member.id
         or s.assignee_member_id = v_member.id
       )
  ),
  today_assigned as (
    select *
      from visible_items
     where assignee_member_id = v_member.id
       and status = 'active'
       and starts_at >= p_today_start
       and starts_at < p_today_end
     order by starts_at asc, id asc
     limit 5
  ),
  upcoming as (
    select *
      from visible_items
     where status = 'active'
       and starts_at >= p_now
       and starts_at < p_now + interval '7 days'
       and not (
         assignee_member_id = v_member.id
         and starts_at >= p_today_start
         and starts_at < p_today_end
       )
     order by starts_at asc, id asc
     limit 8
  ),
  created_by_me as (
    select *
      from visible_items
     where creator_member_id = v_member.id
       and status = 'active'
       and starts_at >= p_now
     order by starts_at asc, id asc
     limit 5
  ),
  recent_done as (
    select *
      from visible_items
     where status = 'done'
       and (
         assignee_member_id = v_member.id
         or creator_member_id = v_member.id
         or completed_by_member_id = v_member.id
       )
     order by completed_at desc nulls last, updated_at desc, id desc
     limit 5
  )
  select jsonb_build_object(
    'profile',
      jsonb_build_object(
        'member_id', v_member.id,
        'nickname', v_member.nickname,
        'role', v_member.role,
        'is_admin', v_member.is_admin,
        'family_id', v_member.family_id,
        'family_name', f.name,
        'avatar_url', fm.avatar_url
      ),
    'today_assigned',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(today_assigned)::jsonb)) from today_assigned), '[]'::jsonb),
    'upcoming',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(upcoming)::jsonb)) from upcoming), '[]'::jsonb),
    'created_by_me',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(created_by_me)::jsonb)) from created_by_me), '[]'::jsonb),
    'recent_done',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(recent_done)::jsonb)) from recent_done), '[]'::jsonb)
  )
  into v_result
  from families f
  join family_members fm on fm.id = v_member.id
  where f.id = v_member.family_id;

  return v_result;
end;
$$;

create or replace function schedule_item_json(p_item jsonb)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', p_item ->> 'id',
    'title', p_item ->> 'title',
    'item_type', p_item ->> 'item_type',
    'visibility', p_item ->> 'visibility',
    'starts_at', p_item ->> 'starts_at',
    'ends_at', p_item ->> 'ends_at',
    'remind_at', p_item ->> 'remind_at',
    'status', p_item ->> 'status',
    'assignee_member_id', p_item ->> 'assignee_member_id',
    'assignee_nickname', p_item ->> 'assignee_nickname',
    'creator_member_id', p_item ->> 'creator_member_id',
    'creator_nickname', p_item ->> 'creator_nickname',
    'recurrence_group_id', p_item ->> 'recurrence_group_id',
    'recurrence_rule', p_item ->> 'recurrence_rule'
  );
$$;

grant execute on function get_personal_dashboard_for_member(uuid, text, timestamptz, timestamptz, timestamptz)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_member_avatar_profile',
  'member_avatar_profile',
  'Adds member avatar fields and a self-service avatar update RPC.'
)
on conflict (version) do nothing;

-- 20260523_schedule_details_editing
-- Family schedule stage 6: item details, editing, URL targeting, and recurring scopes.

create or replace function get_schedule_item_for_member(
  p_member_id uuid,
  p_member_token text,
  p_item_id uuid
)
returns table (
  id uuid,
  family_id uuid,
  creator_member_id uuid,
  assignee_member_id uuid,
  title text,
  note text,
  item_type text,
  visibility text,
  starts_at timestamptz,
  ends_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  reminder_push_attempted_at timestamptz,
  recurrence_group_id uuid,
  recurrence_rule text,
  recurrence_index int,
  status text,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_nickname text,
  assignee_nickname text
)
language plpgsql
security definer
set search_path = public, extensions
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
  select s.id, s.family_id, s.creator_member_id, s.assignee_member_id,
         s.title, s.note, s.item_type, s.visibility, s.starts_at, s.ends_at,
         s.remind_at, s.reminded_at, s.reminder_push_attempted_at,
         s.recurrence_group_id, s.recurrence_rule, s.recurrence_index,
         s.status, s.completed_at, s.completed_by_member_id,
         s.created_at, s.updated_at,
         creator.nickname as creator_nickname,
         assignee.nickname as assignee_nickname
    from family_schedule_items s
    join family_members creator on creator.id = s.creator_member_id
    join family_members assignee on assignee.id = s.assignee_member_id
   where s.id = p_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   limit 1;
end;
$$;

create or replace function update_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_item_id uuid,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_assignee_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_recurrence_scope text default 'single'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_assignee family_members%rowtype;
  v_title text;
  v_note text;
  v_scope text;
  v_start_delta interval;
  v_duration interval;
  v_reminder_offset interval;
  v_updated int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_scope := coalesce(nullif(trim(coalesce(p_recurrence_scope, '')), ''), 'single');

  if length(v_title) = 0 then
    raise exception 'schedule_title_required';
  end if;
  if length(v_title) > 60 then
    raise exception 'schedule_title_too_long';
  end if;
  if coalesce(p_item_type, '') not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_schedule_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;
  if v_scope not in ('single', 'future', 'all') then
    raise exception 'invalid_schedule_scope';
  end if;
  if p_starts_at is null then
    raise exception 'invalid_schedule_time';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'invalid_schedule_time';
  end if;

  select * into v_assignee
    from family_members fm
   where fm.id = p_assignee_member_id
     and fm.family_id = v_member.family_id
     and fm.status = 'active'
   limit 1;
  if not found then
    raise exception 'member_not_found';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if v_item.status = 'cancelled' then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  if v_item.recurrence_group_id is null then
    v_scope := 'single';
  end if;
  v_start_delta := p_starts_at - v_item.starts_at;
  v_duration := case when p_ends_at is null then null else p_ends_at - p_starts_at end;
  v_reminder_offset := case when p_remind_at is null then null else p_starts_at - p_remind_at end;

  update family_schedule_items s
     set title = v_title,
         note = v_note,
         item_type = p_item_type,
         visibility = p_visibility,
         assignee_member_id = v_assignee.id,
         starts_at = case when v_scope = 'single' then p_starts_at else s.starts_at + v_start_delta end,
         ends_at = case
           when p_ends_at is null then null
           when v_scope = 'single' then p_ends_at
           else (s.starts_at + v_start_delta) + v_duration
         end,
         remind_at = case
           when p_remind_at is null then null
           when v_scope = 'single' then p_remind_at
           else (s.starts_at + v_start_delta) - v_reminder_offset
         end,
         reminded_at = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminded_at
         end,
         reminder_push_attempted_at = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminder_push_attempted_at
         end,
         reminder_push_error = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminder_push_error
         end,
         updated_at = now()
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       (
         v_scope = 'single'
         and s.id = v_item.id
       )
       or (
         v_scope = 'future'
         and s.recurrence_group_id = v_item.recurrence_group_id
         and s.starts_at >= v_item.starts_at
       )
       or (
         v_scope = 'all'
         and s.recurrence_group_id = v_item.recurrence_group_id
       )
     )
     and (
       s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
       or (s.visibility = 'family' and v_member.is_admin)
     );

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'not_allowed';
  end if;
end;
$$;

create or replace function delete_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_recurrence_scope text default 'single'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_scope text;
  v_deleted int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_scope := coalesce(nullif(trim(coalesce(p_recurrence_scope, '')), ''), 'single');
  if v_scope not in ('single', 'future', 'all') then
    raise exception 'invalid_schedule_scope';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  if v_item.recurrence_group_id is null then
    v_scope := 'single';
  end if;

  v_summary := v_member.nickname || ' deleted the schedule';
  perform add_schedule_activity_log(v_item.id, v_member.id, 'deleted', v_summary, '{}'::jsonb);
  perform insert_schedule_context_event(v_item.id, 'member', v_member.id, 'deleted', v_summary, null, null);

  update family_schedule_items s
     set status = 'cancelled',
         deleted_at = now(),
         deleted_by_member_id = v_member.id,
         updated_at = now()
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       (
         v_scope = 'single'
         and s.id = v_item.id
       )
       or (
         v_scope = 'future'
         and s.recurrence_group_id = v_item.recurrence_group_id
         and s.starts_at >= v_item.starts_at
       )
       or (
         v_scope = 'all'
         and s.recurrence_group_id = v_item.recurrence_group_id
       )
     )
     and (
       s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
       or (s.visibility = 'family' and v_member.is_admin)
     );

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'not_allowed';
  end if;
end;
$$;

create or replace function delete_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  select delete_schedule_item(
    p_member_id, p_member_token, p_schedule_item_id, 'single'
  );
$$;

grant execute on function get_schedule_item_for_member(uuid, text, uuid)
  to anon, authenticated;
grant execute on function update_schedule_item(uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz, timestamptz, text)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid, text)
  to anon, authenticated;

-- Final schedule list shape after reminders + recurrence.
drop function if exists list_schedule_items_for_member(uuid, text, timestamptz, timestamptz);

create or replace function list_schedule_items_for_member(
  p_member_id uuid,
  p_member_token text,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns table (
  id uuid,
  family_id uuid,
  creator_member_id uuid,
  assignee_member_id uuid,
  title text,
  note text,
  item_type text,
  visibility text,
  starts_at timestamptz,
  ends_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  reminder_push_attempted_at timestamptz,
  recurrence_group_id uuid,
  recurrence_rule text,
  recurrence_index int,
  status text,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_nickname text,
  assignee_nickname text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'invalid_schedule_range';
  end if;

  return query
  select s.id, s.family_id, s.creator_member_id, s.assignee_member_id,
         s.title, s.note, s.item_type, s.visibility, s.starts_at, s.ends_at,
         s.remind_at, s.reminded_at, s.reminder_push_attempted_at,
         s.recurrence_group_id, s.recurrence_rule, s.recurrence_index,
         s.status, s.completed_at, s.completed_by_member_id,
         s.created_at, s.updated_at,
         creator.nickname as creator_nickname,
         assignee.nickname as assignee_nickname
    from family_schedule_items s
    join family_members creator on creator.id = s.creator_member_id
    join family_members assignee on assignee.id = s.assignee_member_id
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.starts_at >= p_range_start
     and s.starts_at < p_range_end
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   order by s.starts_at asc, s.created_at asc, s.id asc;
end;
$$;

grant execute on function list_schedule_items_for_member(uuid, text, timestamptz, timestamptz)
  to anon, authenticated;

-- Final schedule list shape after reminders + recurrence.
drop function if exists list_schedule_items_for_member(uuid, text, timestamptz, timestamptz);

create or replace function list_schedule_items_for_member(
  p_member_id uuid,
  p_member_token text,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns table (
  id uuid,
  family_id uuid,
  creator_member_id uuid,
  assignee_member_id uuid,
  title text,
  note text,
  item_type text,
  visibility text,
  starts_at timestamptz,
  ends_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  reminder_push_attempted_at timestamptz,
  recurrence_group_id uuid,
  recurrence_rule text,
  recurrence_index int,
  status text,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_nickname text,
  assignee_nickname text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'invalid_schedule_range';
  end if;

  return query
  select s.id, s.family_id, s.creator_member_id, s.assignee_member_id,
         s.title, s.note, s.item_type, s.visibility, s.starts_at, s.ends_at,
         s.remind_at, s.reminded_at, s.reminder_push_attempted_at,
         s.recurrence_group_id, s.recurrence_rule, s.recurrence_index,
         s.status, s.completed_at, s.completed_by_member_id,
         s.created_at, s.updated_at,
         creator.nickname as creator_nickname,
         assignee.nickname as assignee_nickname
    from family_schedule_items s
    join family_members creator on creator.id = s.creator_member_id
    join family_members assignee on assignee.id = s.assignee_member_id
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.starts_at >= p_range_start
     and s.starts_at < p_range_end
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   order by s.starts_at asc, s.created_at asc, s.id asc;
end;
$$;

grant execute on function list_schedule_items_for_member(uuid, text, timestamptz, timestamptz)
  to anon, authenticated;

-- 20260523_schedule_recurrence
-- Family schedule recurrence: finite instance generation.

alter table family_schedule_items
  add column if not exists recurrence_group_id uuid,
  add column if not exists recurrence_rule text,
  add column if not exists recurrence_index int;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_recurrence_rule_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_recurrence_rule_check
      check (
        recurrence_rule is null
        or recurrence_rule in ('none', 'daily', 'weekly', 'monthly')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_recurrence_index_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_recurrence_index_check
      check (recurrence_index is null or recurrence_index >= 0);
  end if;
end;
$$;

create index if not exists family_schedule_items_recurrence_group_idx
  on family_schedule_items (recurrence_group_id, recurrence_index);

drop function if exists list_schedule_items_for_member(uuid, text, timestamptz, timestamptz);

create or replace function list_schedule_items_for_member(
  p_member_id uuid,
  p_member_token text,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns table (
  id uuid,
  family_id uuid,
  creator_member_id uuid,
  assignee_member_id uuid,
  title text,
  note text,
  item_type text,
  visibility text,
  starts_at timestamptz,
  ends_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  reminder_push_attempted_at timestamptz,
  recurrence_group_id uuid,
  recurrence_rule text,
  recurrence_index int,
  status text,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_nickname text,
  assignee_nickname text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'invalid_schedule_range';
  end if;

  return query
  select s.id, s.family_id, s.creator_member_id, s.assignee_member_id,
         s.title, s.note, s.item_type, s.visibility, s.starts_at, s.ends_at,
         s.remind_at, s.reminded_at, s.reminder_push_attempted_at,
         s.recurrence_group_id, s.recurrence_rule, s.recurrence_index,
         s.status, s.completed_at, s.completed_by_member_id,
         s.created_at, s.updated_at,
         creator.nickname as creator_nickname,
         assignee.nickname as assignee_nickname
    from family_schedule_items s
    join family_members creator on creator.id = s.creator_member_id
    join family_members assignee on assignee.id = s.assignee_member_id
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.starts_at >= p_range_start
     and s.starts_at < p_range_end
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   order by s.starts_at asc, s.created_at asc, s.id asc;
end;
$$;

drop function if exists create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid);
drop function if exists create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, text);

create or replace function create_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_assignee_member_id uuid,
  p_recurrence_rule text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_assignee family_members%rowtype;
  v_title text;
  v_note text;
  v_rule text;
  v_count int;
  v_group_id uuid;
  v_first_id uuid;
  v_id uuid;
  v_index int;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remind_at timestamptz;
  v_duration interval;
  v_reminder_offset interval;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_rule := coalesce(nullif(trim(coalesce(p_recurrence_rule, '')), ''), 'none');

  if length(v_title) = 0 then
    raise exception 'schedule_title_required';
  end if;
  if length(v_title) > 60 then
    raise exception 'schedule_title_too_long';
  end if;
  if coalesce(p_item_type, '') not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_schedule_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;
  if v_rule not in ('none', 'daily', 'weekly', 'monthly') then
    raise exception 'invalid_schedule_recurrence';
  end if;
  if p_starts_at is null then
    raise exception 'invalid_schedule_time';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'invalid_schedule_time';
  end if;

  select * into v_assignee
    from family_members fm
   where fm.id = p_assignee_member_id
     and fm.family_id = v_member.family_id
     and fm.status = 'active'
   limit 1;
  if not found then
    raise exception 'member_not_found';
  end if;

  v_count := case v_rule
    when 'daily' then 30
    when 'weekly' then 12
    when 'monthly' then 12
    else 1
  end;
  v_group_id := case when v_rule = 'none' then null else gen_random_uuid() end;
  v_duration := case when p_ends_at is null then null else p_ends_at - p_starts_at end;
  v_reminder_offset := case when p_remind_at is null then null else p_starts_at - p_remind_at end;

  for v_index in 0..(v_count - 1) loop
    v_starts_at := case v_rule
      when 'daily' then p_starts_at + (v_index * interval '1 day')
      when 'weekly' then p_starts_at + (v_index * interval '1 week')
      when 'monthly' then p_starts_at + (v_index * interval '1 month')
      else p_starts_at
    end;
    v_ends_at := case when v_duration is null then null else v_starts_at + v_duration end;
    v_remind_at := case when v_reminder_offset is null then null else v_starts_at - v_reminder_offset end;

    insert into family_schedule_items (
      family_id, creator_member_id, assignee_member_id, title, note, item_type,
      visibility, starts_at, ends_at, remind_at,
      recurrence_group_id, recurrence_rule, recurrence_index
    )
    values (
      v_member.family_id, v_member.id, v_assignee.id, v_title, v_note,
      p_item_type, p_visibility, v_starts_at, v_ends_at, v_remind_at,
      v_group_id, v_rule, case when v_rule = 'none' then null else v_index end
    )
    returning id into v_id;

    if v_index = 0 then
      v_first_id := v_id;
    end if;
  end loop;

  return v_first_id;
end;
$$;

create or replace function create_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_assignee_member_id uuid
)
returns uuid
language sql
security definer
set search_path = public, extensions
as $$
  select create_schedule_item(
    p_member_id, p_member_token, p_title, p_note, p_item_type, p_visibility,
    p_starts_at, p_ends_at, p_remind_at, p_assignee_member_id, 'none'
  );
$$;

grant execute on function list_schedule_items_for_member(uuid, text, timestamptz, timestamptz)
  to anon, authenticated;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid)
  to anon, authenticated;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, text)
  to anon, authenticated;

-- 20260522_family_schedule_events
-- Family schedule realtime events: lightweight per-member sync signals.

create table if not exists family_schedule_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_item_id uuid not null references family_schedule_items(id) on delete cascade,
  recipient_member_id uuid not null references family_members(id) on delete cascade,
  event_type text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_events_event_type_check'
       and conrelid = 'family_schedule_events'::regclass
  ) then
    alter table family_schedule_events
      add constraint family_schedule_events_event_type_check
      check (event_type in (
        'created',
        'updated',
        'status_changed',
        'deleted',
        'reminder_updated'
      ));
  end if;
end;
$$;

create index if not exists family_schedule_events_recipient_created_idx
  on family_schedule_events (recipient_member_id, created_at desc);

create index if not exists family_schedule_events_item_idx
  on family_schedule_events (schedule_item_id, created_at desc);

create index if not exists family_schedule_events_cleanup_idx
  on family_schedule_events (created_at);

alter table family_schedule_events enable row level security;
revoke all on family_schedule_events from anon, authenticated;
grant select on family_schedule_events to anon, authenticated;

drop policy if exists "family schedule events are realtime signals" on family_schedule_events;
create policy "family schedule events are realtime signals"
  on family_schedule_events for select
  to anon, authenticated
  using (true);

create or replace function enqueue_schedule_realtime_events()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'created';

    insert into family_schedule_events (
      family_id, schedule_item_id, recipient_member_id, event_type
    )
    select new.family_id, new.id, recipients.member_id, v_event_type
      from (
        select distinct fm.id as member_id
          from family_members fm
         where fm.family_id = new.family_id
           and fm.status = 'active'
           and (
             new.visibility = 'family'
             or fm.id in (new.creator_member_id, new.assignee_member_id)
           )
      ) recipients;

    delete from family_schedule_events
     where created_at < now() - interval '1 day';

    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    v_event_type := 'deleted';
  elsif old.status is distinct from new.status and new.status = 'cancelled' then
    v_event_type := 'deleted';
  elsif old.status is distinct from new.status then
    v_event_type := 'status_changed';
  elsif old.remind_at is distinct from new.remind_at then
    v_event_type := 'reminder_updated';
  elsif old.title is distinct from new.title
     or old.note is distinct from new.note
     or old.item_type is distinct from new.item_type
     or old.visibility is distinct from new.visibility
     or old.starts_at is distinct from new.starts_at
     or old.ends_at is distinct from new.ends_at
     or old.assignee_member_id is distinct from new.assignee_member_id then
    v_event_type := 'updated';
  else
    return new;
  end if;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select new.family_id, new.id, recipients.member_id, v_event_type
    from (
      select distinct fm.id as member_id
        from family_members fm
       where fm.family_id = new.family_id
         and fm.status = 'active'
         and (
           (
             new.visibility = 'family'
             or fm.id in (new.creator_member_id, new.assignee_member_id)
           )
           or (
             old.visibility = 'family'
             or fm.id in (old.creator_member_id, old.assignee_member_id)
           )
         )
    ) recipients;

  delete from family_schedule_events
   where created_at < now() - interval '1 day';

  return new;
end;
$$;

drop trigger if exists trg_family_schedule_realtime_events on family_schedule_items;

create trigger trg_family_schedule_realtime_events
after insert or update on family_schedule_items
for each row
execute function enqueue_schedule_realtime_events();

create or replace function delete_old_schedule_events()
returns int
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_deleted int;
begin
  delete from family_schedule_events
   where created_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function delete_old_schedule_events() from public;
grant execute on function delete_old_schedule_events() to service_role;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'family_schedule_events'
  ) then
    execute 'alter publication supabase_realtime add table family_schedule_events';
  end if;
end $$;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid)
  to anon, authenticated;
grant execute on function set_schedule_item_status(uuid, text, uuid, text)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid)
  to anon, authenticated;

-- 20260522_schedule_reminders
-- Family schedule reminders: due-scan fields for server-side Push reminders.

alter table family_schedule_items
  add column if not exists reminded_at timestamptz,
  add column if not exists reminder_push_attempted_at timestamptz,
  add column if not exists reminder_push_error text;

create index if not exists family_schedule_items_due_reminders_idx
  on family_schedule_items (remind_at)
  where remind_at is not null
    and reminded_at is null
    and deleted_at is null
    and status = 'active';

drop function if exists list_schedule_items_for_member(uuid, text, timestamptz, timestamptz);

create or replace function list_schedule_items_for_member(
  p_member_id uuid,
  p_member_token text,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns table (
  id uuid,
  family_id uuid,
  creator_member_id uuid,
  assignee_member_id uuid,
  title text,
  note text,
  item_type text,
  visibility text,
  starts_at timestamptz,
  ends_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  reminder_push_attempted_at timestamptz,
  status text,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_nickname text,
  assignee_nickname text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'invalid_schedule_range';
  end if;

  return query
  select s.id, s.family_id, s.creator_member_id, s.assignee_member_id,
         s.title, s.note, s.item_type, s.visibility, s.starts_at, s.ends_at,
         s.remind_at, s.reminded_at, s.reminder_push_attempted_at,
         s.status, s.completed_at, s.completed_by_member_id,
         s.created_at, s.updated_at,
         creator.nickname as creator_nickname,
         assignee.nickname as assignee_nickname
    from family_schedule_items s
    join family_members creator on creator.id = s.creator_member_id
    join family_members assignee on assignee.id = s.assignee_member_id
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.starts_at >= p_range_start
     and s.starts_at < p_range_end
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   order by s.starts_at asc, s.created_at asc, s.id asc;
end;
$$;

grant execute on function list_schedule_items_for_member(uuid, text, timestamptz, timestamptz)
  to anon, authenticated;

-- Final schedule list shape after reminders + recurrence.
drop function if exists list_schedule_items_for_member(uuid, text, timestamptz, timestamptz);

create or replace function list_schedule_items_for_member(
  p_member_id uuid,
  p_member_token text,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns table (
  id uuid,
  family_id uuid,
  creator_member_id uuid,
  assignee_member_id uuid,
  title text,
  note text,
  item_type text,
  visibility text,
  starts_at timestamptz,
  ends_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  reminder_push_attempted_at timestamptz,
  recurrence_group_id uuid,
  recurrence_rule text,
  recurrence_index int,
  status text,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_nickname text,
  assignee_nickname text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'invalid_schedule_range';
  end if;

  return query
  select s.id, s.family_id, s.creator_member_id, s.assignee_member_id,
         s.title, s.note, s.item_type, s.visibility, s.starts_at, s.ends_at,
         s.remind_at, s.reminded_at, s.reminder_push_attempted_at,
         s.recurrence_group_id, s.recurrence_rule, s.recurrence_index,
         s.status, s.completed_at, s.completed_by_member_id,
         s.created_at, s.updated_at,
         creator.nickname as creator_nickname,
         assignee.nickname as assignee_nickname
    from family_schedule_items s
    join family_members creator on creator.id = s.creator_member_id
    join family_members assignee on assignee.id = s.assignee_member_id
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.starts_at >= p_range_start
     and s.starts_at < p_range_end
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   order by s.starts_at asc, s.created_at asc, s.id asc;
end;
$$;

grant execute on function list_schedule_items_for_member(uuid, text, timestamptz, timestamptz)
  to anon, authenticated;

-- 20260523_schedule_collaboration
-- Family schedule stage 9: collaboration comments, assignment response, and activity logs.

alter table family_schedule_items
  add column if not exists assignee_response text not null default 'pending',
  add column if not exists assignee_responded_at timestamptz,
  add column if not exists assignee_response_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_assignee_response_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_assignee_response_check
      check (assignee_response in ('pending', 'accepted', 'declined'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_response_note_length_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_response_note_length_check
      check (assignee_response_note is null or length(assignee_response_note) <= 300);
  end if;
end;
$$;

update family_schedule_items
   set assignee_response = case
         when creator_member_id = assignee_member_id then 'accepted'
         else coalesce(nullif(assignee_response, ''), 'pending')
       end,
       assignee_responded_at = case
         when creator_member_id = assignee_member_id and assignee_responded_at is null then created_at
         else assignee_responded_at
       end
 where assignee_response is null
    or assignee_response = 'pending';

create table if not exists family_schedule_comments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_item_id uuid not null references family_schedule_items(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  content text not null,
  deleted_at timestamptz,
  deleted_by_member_id uuid references family_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_comments_content_length_check'
       and conrelid = 'family_schedule_comments'::regclass
  ) then
    alter table family_schedule_comments
      add constraint family_schedule_comments_content_length_check
      check (length(trim(content)) between 1 and 300);
  end if;
end;
$$;

create index if not exists family_schedule_comments_item_created_idx
  on family_schedule_comments (schedule_item_id, created_at asc);
create index if not exists family_schedule_comments_member_created_idx
  on family_schedule_comments (member_id, created_at desc);
create index if not exists family_schedule_comments_family_created_idx
  on family_schedule_comments (family_id, created_at desc);

alter table family_schedule_comments enable row level security;
revoke all on family_schedule_comments from anon, authenticated;

drop policy if exists "family schedule comments are rpc only" on family_schedule_comments;

create table if not exists family_schedule_activity_logs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_item_id uuid not null references family_schedule_items(id) on delete cascade,
  actor_member_id uuid not null references family_members(id) on delete cascade,
  activity_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_activity_logs_type_check'
       and conrelid = 'family_schedule_activity_logs'::regclass
  ) then
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
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_activity_logs_summary_length_check'
       and conrelid = 'family_schedule_activity_logs'::regclass
  ) then
    alter table family_schedule_activity_logs
      add constraint family_schedule_activity_logs_summary_length_check
      check (length(summary) <= 200);
  end if;
end;
$$;

create index if not exists family_schedule_activity_logs_item_created_idx
  on family_schedule_activity_logs (schedule_item_id, created_at desc);
create index if not exists family_schedule_activity_logs_family_created_idx
  on family_schedule_activity_logs (family_id, created_at desc);

alter table family_schedule_activity_logs enable row level security;
revoke all on family_schedule_activity_logs from anon, authenticated;

drop policy if exists "family schedule activity logs are rpc only" on family_schedule_activity_logs;

alter table family_schedule_events
  drop constraint if exists family_schedule_events_event_type_check;

alter table family_schedule_events
  add constraint family_schedule_events_event_type_check
  check (event_type in (
    'created',
    'updated',
    'status_changed',
    'deleted',
    'reminder_updated',
    'commented',
    'comment_deleted',
    'assignment_responded',
    'activity_added'
  ));

create or replace function schedule_item_is_visible_to_member(
  p_item family_schedule_items,
  p_member_id uuid
)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select p_item.visibility = 'family'
      or p_item.creator_member_id = p_member_id
      or p_item.assignee_member_id = p_member_id;
$$;

create or replace function enqueue_schedule_event_for_visible_members(
  p_schedule_item_id uuid,
  p_event_type text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item family_schedule_items%rowtype;
begin
  select * into v_item
    from family_schedule_items
   where id = p_schedule_item_id;

  if not found then
    return;
  end if;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select v_item.family_id, v_item.id, fm.id, p_event_type
    from family_members fm
   where fm.family_id = v_item.family_id
     and fm.status = 'active'
     and (
       v_item.visibility = 'family'
       or fm.id in (v_item.creator_member_id, v_item.assignee_member_id)
     );

  delete from family_schedule_events
   where created_at < now() - interval '1 day';
end;
$$;

create or replace function add_schedule_activity_log(
  p_schedule_item_id uuid,
  p_actor_member_id uuid,
  p_activity_type text,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item family_schedule_items%rowtype;
  v_id uuid;
begin
  select * into v_item
    from family_schedule_items
   where id = p_schedule_item_id;

  if not found then
    raise exception 'schedule_item_not_found';
  end if;

  insert into family_schedule_activity_logs (
    family_id,
    schedule_item_id,
    actor_member_id,
    activity_type,
    summary,
    metadata
  )
  values (
    v_item.family_id,
    v_item.id,
    p_actor_member_id,
    p_activity_type,
    left(p_summary, 200),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function get_schedule_collaboration_for_member(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_result jsonb;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null;

  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;

  select jsonb_build_object(
    'comments',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'schedule_item_id', c.schedule_item_id,
          'member_id', c.member_id,
          'nickname', fm.nickname,
          'content', c.content,
          'created_at', c.created_at,
          'updated_at', c.updated_at
        )
        order by c.created_at asc, c.id asc
      )
      from (
        select *
          from family_schedule_comments c
         where c.schedule_item_id = v_item.id
           and c.deleted_at is null
         order by c.created_at asc, c.id asc
         limit 100
      ) c
      join family_members fm on fm.id = c.member_id
    ), '[]'::jsonb),
    'activity_logs',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'actor_member_id', a.actor_member_id,
          'actor_nickname', fm.nickname,
          'activity_type', a.activity_type,
          'summary', a.summary,
          'created_at', a.created_at
        )
        order by a.created_at desc, a.id desc
      )
      from (
        select *
          from family_schedule_activity_logs a
         where a.schedule_item_id = v_item.id
         order by a.created_at desc, a.id desc
         limit 50
      ) a
      join family_members fm on fm.id = a.actor_member_id
    ), '[]'::jsonb),
    'assignee_response',
    jsonb_build_object(
      'status', v_item.assignee_response,
      'responded_at', v_item.assignee_responded_at,
      'note', v_item.assignee_response_note
    )
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function add_schedule_comment(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_content text;
  v_comment_id uuid;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_content := trim(coalesce(p_content, ''));
  if length(v_content) = 0 then
    raise exception 'schedule_comment_required';
  end if;
  if length(v_content) > 300 then
    raise exception 'schedule_comment_too_long';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.status <> 'cancelled';

  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;

  insert into family_schedule_comments (
    family_id, schedule_item_id, member_id, content
  )
  values (v_member.family_id, v_item.id, v_member.id, v_content)
  returning id into v_comment_id;

  perform add_schedule_activity_log(
    v_item.id,
    v_member.id,
    'commented',
    v_member.nickname || ' commented on the schedule',
    '{}'::jsonb
  );
  perform enqueue_schedule_event_for_visible_members(v_item.id, 'commented');

  return v_comment_id;
end;
$$;

create or replace function delete_schedule_comment(
  p_member_id uuid,
  p_member_token text,
  p_comment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_comment family_schedule_comments%rowtype;
  v_item family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_comment
    from family_schedule_comments c
   where c.id = p_comment_id
     and c.deleted_at is null
   for update;
  if not found then
    raise exception 'schedule_comment_not_found';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = v_comment.schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null;
  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_comment_not_found';
  end if;

  if not (
    v_comment.member_id = v_member.id
    or v_item.creator_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  update family_schedule_comments
     set deleted_at = now(),
         deleted_by_member_id = v_member.id,
         updated_at = now()
   where id = v_comment.id;

  perform enqueue_schedule_event_for_visible_members(v_item.id, 'comment_deleted');
end;
$$;

create or replace function respond_schedule_assignment(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_response text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_response text;
  v_note text;
  v_activity text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_response := trim(coalesce(p_response, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if v_response not in ('accepted', 'declined') then
    raise exception 'invalid_schedule_response';
  end if;
  if v_note is not null and length(v_note) > 300 then
    raise exception 'schedule_response_note_too_long';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.status = 'active'
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if v_item.assignee_member_id <> v_member.id then
    raise exception 'not_allowed';
  end if;

  update family_schedule_items
     set assignee_response = v_response,
         assignee_responded_at = now(),
         assignee_response_note = case when v_response = 'declined' then v_note else null end,
         updated_at = now()
   where id = v_item.id;

  v_activity := case
    when v_response = 'accepted' then 'accepted'
    else 'declined'
  end;
  perform add_schedule_activity_log(
    v_item.id,
    v_member.id,
    v_activity,
    case
      when v_response = 'accepted' then v_member.nickname || ' accepted the assignment'
      else v_member.nickname || ' declined the assignment'
    end,
    case
      when v_response = 'declined' and v_note is not null then jsonb_build_object('has_note', true)
      else '{}'::jsonb
    end
  );
  perform enqueue_schedule_event_for_visible_members(v_item.id, 'assignment_responded');
end;
$$;

drop function if exists create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid);
drop function if exists create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, text);

create or replace function create_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_assignee_member_id uuid,
  p_recurrence_rule text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_assignee family_members%rowtype;
  v_title text;
  v_note text;
  v_rule text;
  v_count int;
  v_group_id uuid;
  v_first_id uuid;
  v_id uuid;
  v_index int;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remind_at timestamptz;
  v_duration interval;
  v_reminder_offset interval;
  v_response text;
  v_responded_at timestamptz;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_rule := coalesce(nullif(trim(coalesce(p_recurrence_rule, '')), ''), 'none');

  if length(v_title) = 0 then
    raise exception 'schedule_title_required';
  end if;
  if length(v_title) > 60 then
    raise exception 'schedule_title_too_long';
  end if;
  if coalesce(p_item_type, '') not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_schedule_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;
  if v_rule not in ('none', 'daily', 'weekly', 'monthly') then
    raise exception 'invalid_schedule_recurrence';
  end if;
  if p_starts_at is null then
    raise exception 'invalid_schedule_time';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'invalid_schedule_time';
  end if;

  select * into v_assignee
    from family_members fm
   where fm.id = p_assignee_member_id
     and fm.family_id = v_member.family_id
     and fm.status = 'active'
   limit 1;
  if not found then
    raise exception 'member_not_found';
  end if;

  v_response := case when v_assignee.id = v_member.id then 'accepted' else 'pending' end;
  v_responded_at := case when v_assignee.id = v_member.id then now() else null end;
  v_count := case v_rule
    when 'daily' then 30
    when 'weekly' then 12
    when 'monthly' then 12
    else 1
  end;
  v_group_id := case when v_rule = 'none' then null else gen_random_uuid() end;
  v_duration := case when p_ends_at is null then null else p_ends_at - p_starts_at end;
  v_reminder_offset := case when p_remind_at is null then null else p_starts_at - p_remind_at end;

  for v_index in 0..(v_count - 1) loop
    v_starts_at := case v_rule
      when 'daily' then p_starts_at + (v_index * interval '1 day')
      when 'weekly' then p_starts_at + (v_index * interval '1 week')
      when 'monthly' then p_starts_at + (v_index * interval '1 month')
      else p_starts_at
    end;
    v_ends_at := case when v_duration is null then null else v_starts_at + v_duration end;
    v_remind_at := case when v_reminder_offset is null then null else v_starts_at - v_reminder_offset end;

    insert into family_schedule_items (
      family_id, creator_member_id, assignee_member_id, title, note, item_type,
      visibility, starts_at, ends_at, remind_at,
      recurrence_group_id, recurrence_rule, recurrence_index,
      assignee_response, assignee_responded_at
    )
    values (
      v_member.family_id, v_member.id, v_assignee.id, v_title, v_note,
      p_item_type, p_visibility, v_starts_at, v_ends_at, v_remind_at,
      v_group_id, v_rule, case when v_rule = 'none' then null else v_index end,
      v_response, v_responded_at
    )
    returning id into v_id;

    perform add_schedule_activity_log(
      v_id,
      v_member.id,
      'created',
      v_member.nickname || ' created the schedule',
      '{}'::jsonb
    );
    if v_assignee.id <> v_member.id then
      perform add_schedule_activity_log(
        v_id,
        v_member.id,
        'assigned',
        'Assigned to ' || v_assignee.nickname,
        '{}'::jsonb
      );
    end if;

    if v_index = 0 then
      v_first_id := v_id;
    end if;
  end loop;

  return v_first_id;
end;
$$;

create or replace function create_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_assignee_member_id uuid
)
returns uuid
language sql
security definer
set search_path = public, extensions
as $$
  select create_schedule_item(
    p_member_id, p_member_token, p_title, p_note, p_item_type, p_visibility,
    p_starts_at, p_ends_at, p_remind_at, p_assignee_member_id, 'none'
  );
$$;

create or replace function update_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_item_id uuid,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_assignee_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_recurrence_scope text default 'single'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_assignee family_members%rowtype;
  v_title text;
  v_note text;
  v_scope text;
  v_start_delta interval;
  v_duration interval;
  v_reminder_offset interval;
  v_updated int;
  v_activity text;
  v_summary text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_scope := coalesce(nullif(trim(coalesce(p_recurrence_scope, '')), ''), 'single');

  if length(v_title) = 0 then
    raise exception 'schedule_title_required';
  end if;
  if length(v_title) > 60 then
    raise exception 'schedule_title_too_long';
  end if;
  if coalesce(p_item_type, '') not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_schedule_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;
  if v_scope not in ('single', 'future', 'all') then
    raise exception 'invalid_schedule_scope';
  end if;
  if p_starts_at is null then
    raise exception 'invalid_schedule_time';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'invalid_schedule_time';
  end if;

  select * into v_assignee
    from family_members fm
   where fm.id = p_assignee_member_id
     and fm.family_id = v_member.family_id
     and fm.status = 'active'
   limit 1;
  if not found then
    raise exception 'member_not_found';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if v_item.status = 'cancelled' then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  if v_item.recurrence_group_id is null then
    v_scope := 'single';
  end if;
  v_start_delta := p_starts_at - v_item.starts_at;
  v_duration := case when p_ends_at is null then null else p_ends_at - p_starts_at end;
  v_reminder_offset := case when p_remind_at is null then null else p_starts_at - p_remind_at end;

  update family_schedule_items s
     set title = v_title,
         note = v_note,
         item_type = p_item_type,
         visibility = p_visibility,
         assignee_member_id = v_assignee.id,
         assignee_response = case
           when s.assignee_member_id is distinct from v_assignee.id then
             case when v_assignee.id = s.creator_member_id then 'accepted' else 'pending' end
           else s.assignee_response
         end,
         assignee_responded_at = case
           when s.assignee_member_id is distinct from v_assignee.id then
             case when v_assignee.id = s.creator_member_id then now() else null end
           else s.assignee_responded_at
         end,
         assignee_response_note = case
           when s.assignee_member_id is distinct from v_assignee.id then null
           else s.assignee_response_note
         end,
         starts_at = case when v_scope = 'single' then p_starts_at else s.starts_at + v_start_delta end,
         ends_at = case
           when p_ends_at is null then null
           when v_scope = 'single' then p_ends_at
           else (s.starts_at + v_start_delta) + v_duration
         end,
         remind_at = case
           when p_remind_at is null then null
           when v_scope = 'single' then p_remind_at
           else (s.starts_at + v_start_delta) - v_reminder_offset
         end,
         reminded_at = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminded_at
         end,
         reminder_push_attempted_at = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminder_push_attempted_at
         end,
         reminder_push_error = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminder_push_error
         end,
         updated_at = now()
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       (v_scope = 'single' and s.id = v_item.id)
       or (
         v_scope = 'future'
         and s.recurrence_group_id = v_item.recurrence_group_id
         and s.starts_at >= v_item.starts_at
       )
       or (
         v_scope = 'all'
         and s.recurrence_group_id = v_item.recurrence_group_id
       )
     )
     and (
       s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
       or (s.visibility = 'family' and v_member.is_admin)
     );

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'not_allowed';
  end if;

  if v_item.assignee_member_id is distinct from v_assignee.id then
    v_activity := 'assigned';
    v_summary := 'Assigned to ' || v_assignee.nickname;
  elsif v_item.visibility is distinct from p_visibility then
    v_activity := 'visibility_changed';
    v_summary := v_member.nickname || ' changed visibility';
  elsif v_item.remind_at is distinct from p_remind_at then
    v_activity := 'reminder_changed';
    v_summary := v_member.nickname || ' changed the reminder';
  else
    v_activity := 'updated';
    v_summary := v_member.nickname || ' updated the schedule';
  end if;

  perform add_schedule_activity_log(v_item.id, v_member.id, v_activity, v_summary, '{}'::jsonb);
end;
$$;

create or replace function set_schedule_item_status(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_activity text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_status not in ('active', 'done') then
    raise exception 'invalid_schedule_status';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   for update;
  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
  ) then
    raise exception 'not_allowed';
  end if;

  update family_schedule_items
     set status = p_status,
         completed_at = case when p_status = 'done' then now() else null end,
         completed_by_member_id = case when p_status = 'done' then v_member.id else null end,
         updated_at = now()
   where id = v_item.id;

  v_activity := case when p_status = 'done' then 'completed' else 'restored' end;
  perform add_schedule_activity_log(
    v_item.id,
    v_member.id,
    v_activity,
    case
      when p_status = 'done' then v_member.nickname || ' completed the schedule'
      else v_member.nickname || ' restored the schedule'
    end,
    '{}'::jsonb
  );
end;
$$;

create or replace function delete_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_recurrence_scope text default 'single'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_scope text;
  v_deleted int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_scope := coalesce(nullif(trim(coalesce(p_recurrence_scope, '')), ''), 'single');
  if v_scope not in ('single', 'future', 'all') then
    raise exception 'invalid_schedule_scope';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  if v_item.recurrence_group_id is null then
    v_scope := 'single';
  end if;

  update family_schedule_items s
     set status = 'cancelled',
         deleted_at = now(),
         deleted_by_member_id = v_member.id,
         updated_at = now()
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       (v_scope = 'single' and s.id = v_item.id)
       or (
         v_scope = 'future'
         and s.recurrence_group_id = v_item.recurrence_group_id
         and s.starts_at >= v_item.starts_at
       )
       or (
         v_scope = 'all'
         and s.recurrence_group_id = v_item.recurrence_group_id
       )
     )
     and (
       s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
       or (s.visibility = 'family' and v_member.is_admin)
     );

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'not_allowed';
  end if;

  perform add_schedule_activity_log(
    v_item.id,
    v_member.id,
    'deleted',
    v_member.nickname || ' deleted the schedule',
    '{}'::jsonb
  );
end;
$$;

create or replace function delete_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  select delete_schedule_item(
    p_member_id, p_member_token, p_schedule_item_id, 'single'
  );
$$;

grant execute on function get_schedule_collaboration_for_member(uuid, text, uuid)
  to anon, authenticated;
grant execute on function add_schedule_comment(uuid, text, uuid, text)
  to anon, authenticated;
grant execute on function delete_schedule_comment(uuid, text, uuid)
  to anon, authenticated;
grant execute on function respond_schedule_assignment(uuid, text, uuid, text, text)
  to anon, authenticated;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid)
  to anon, authenticated;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, text)
  to anon, authenticated;
grant execute on function update_schedule_item(uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz, timestamptz, text)
  to anon, authenticated;
grant execute on function set_schedule_item_status(uuid, text, uuid, text)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid, text)
  to anon, authenticated;

-- 20260524_schedule_context_timeline
-- Schedule detail conversation timeline with recipient-filtered system events.

alter table family_context_events
  drop constraint if exists family_context_events_event_type_check;

alter table family_context_events
  add constraint family_context_events_event_type_check
  check (event_type in (
    'text',
    'audio',
    'location',
    'system',
    'created',
    'updated',
    'assigned',
    'accepted',
    'declined',
    'completed',
    'restored',
    'deleted',
    'reminder_updated'
  ));

create or replace function insert_schedule_context_event(
  p_schedule_item_id uuid,
  p_sender_type text,
  p_sender_member_id uuid,
  p_event_type text,
  p_text_content text default null,
  p_visibility text default null,
  p_recipient_member_id uuid default null,
  p_audio_url text default null,
  p_audio_duration_ms integer default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_location_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_item family_schedule_items%rowtype;
  v_sender family_members%rowtype;
  v_recipient family_members%rowtype;
  v_event_id uuid;
  v_visibility text;
  v_text text;
  v_signal_type text;
begin
  if coalesce(p_sender_type, '') not in ('member', 'keeper', 'system') then
    raise exception 'invalid_schedule_context_sender_type';
  end if;
  if coalesce(p_event_type, '') not in (
    'text',
    'audio',
    'location',
    'system',
    'created',
    'updated',
    'assigned',
    'accepted',
    'declined',
    'completed',
    'restored',
    'deleted',
    'reminder_updated'
  ) then
    raise exception 'invalid_schedule_context_event_type';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.deleted_at is null;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;

  if p_sender_member_id is not null then
    select * into v_sender
      from family_members fm
     where fm.id = p_sender_member_id
       and fm.family_id = v_item.family_id
       and fm.status = 'active'
     limit 1;
    if not found then
      raise exception 'unauthorized';
    end if;
  end if;

  v_visibility := coalesce(
    nullif(trim(coalesce(p_visibility, '')), ''),
    case when v_item.visibility = 'private' then 'private' else 'family' end
  );
  if v_visibility not in ('family', 'private') then
    raise exception 'invalid_schedule_context_visibility';
  end if;

  v_text := nullif(trim(coalesce(p_text_content, '')), '');
  if v_text is not null and length(v_text) > 300 then
    raise exception 'schedule_context_text_too_long';
  end if;
  if p_event_type = 'text' then
    if v_text is null then
      raise exception 'schedule_context_text_required';
    end if;
  elsif p_event_type = 'audio' then
    if nullif(trim(coalesce(p_audio_url, '')), '') is null then
      raise exception 'schedule_context_audio_required';
    end if;
  elsif p_event_type = 'location' then
    if p_latitude is null or p_longitude is null then
      raise exception 'schedule_context_location_required';
    end if;
  end if;

  if p_recipient_member_id is not null then
    select * into v_recipient
      from family_members fm
     where fm.id = p_recipient_member_id
       and fm.family_id = v_item.family_id
       and fm.status = 'active'
     limit 1;
    if not found or not schedule_item_is_visible_to_member(v_item, v_recipient.id) then
      raise exception 'member_not_found';
    end if;
  end if;

  insert into family_context_events (
    family_id,
    target_type,
    target_id,
    schedule_item_id,
    sender_type,
    sender_member_id,
    recipient_member_id,
    event_type,
    visibility,
    text_content,
    audio_url,
    audio_duration_ms,
    latitude,
    longitude,
    location_label
  )
  values (
    v_item.family_id,
    'schedule_item',
    v_item.id,
    v_item.id,
    p_sender_type,
    p_sender_member_id,
    case when v_visibility = 'private' then p_recipient_member_id else null end,
    p_event_type,
    v_visibility,
    v_text,
    nullif(trim(coalesce(p_audio_url, '')), ''),
    p_audio_duration_ms,
    p_latitude,
    p_longitude,
    nullif(trim(coalesce(p_location_label, '')), '')
  )
  returning id into v_event_id;

  if v_visibility = 'private' and p_recipient_member_id is not null then
    if p_sender_member_id is not null then
      insert into family_context_event_recipients (family_id, event_id, member_id)
      values (v_item.family_id, v_event_id, p_sender_member_id)
      on conflict (event_id, member_id) do nothing;
    end if;

    insert into family_context_event_recipients (family_id, event_id, member_id)
    values (v_item.family_id, v_event_id, p_recipient_member_id)
    on conflict (event_id, member_id) do nothing;
  else
    insert into family_context_event_recipients (family_id, event_id, member_id)
    select v_item.family_id, v_event_id, fm.id
      from family_members fm
     where fm.family_id = v_item.family_id
       and fm.status = 'active'
       and schedule_item_is_visible_to_member(v_item, fm.id)
    on conflict (event_id, member_id) do nothing;
  end if;

  v_signal_type := case
    when p_event_type in ('text', 'audio', 'location') then 'commented'
    when p_event_type = 'deleted' then 'deleted'
    when p_event_type = 'reminder_updated' then 'reminder_updated'
    else 'activity_added'
  end;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select v_item.family_id, v_item.id, r.member_id, v_signal_type
    from family_context_event_recipients r
   where r.event_id = v_event_id;

  delete from family_schedule_events
   where created_at < now() - interval '1 day';

  return v_event_id;
end;
$$;

revoke all on function insert_schedule_context_event(
  uuid, text, uuid, text, text, text, uuid, text, integer, double precision, double precision, text
) from public, anon, authenticated;

create or replace function create_schedule_context_event(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_event_type text,
  p_text_content text default null,
  p_visibility text default 'family',
  p_recipient_member_id uuid default null,
  p_audio_url text default null,
  p_audio_duration_ms integer default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_location_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if coalesce(p_event_type, '') not in ('text', 'audio', 'location') then
    raise exception 'invalid_schedule_context_event_type';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.status <> 'cancelled';
  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;

  if p_visibility = 'private' then
    if p_recipient_member_id is null then
      raise exception 'schedule_context_recipient_required';
    end if;
    if p_recipient_member_id = v_member.id then
      raise exception 'cannot_whisper_self';
    end if;
  end if;

  return insert_schedule_context_event(
    v_item.id,
    'member',
    v_member.id,
    p_event_type,
    p_text_content,
    p_visibility,
    p_recipient_member_id,
    p_audio_url,
    p_audio_duration_ms,
    p_latitude,
    p_longitude,
    p_location_label
  );
end;
$$;

grant execute on function create_schedule_context_event(
  uuid, text, uuid, text, text, text, uuid, text, integer, double precision, double precision, text
) to anon, authenticated;

create or replace function list_schedule_context_events_for_member(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns table (
  id uuid,
  family_id uuid,
  schedule_item_id uuid,
  sender_type text,
  sender_member_id uuid,
  sender_nickname text,
  recipient_member_id uuid,
  recipient_nickname text,
  event_type text,
  visibility text,
  text_content text,
  audio_url text,
  audio_duration_ms integer,
  latitude double precision,
  longitude double precision,
  location_label text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null;

  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;

  return query
  select *
    from (
      select e.id,
             e.family_id,
             e.schedule_item_id,
             e.sender_type,
             e.sender_member_id,
             sender.nickname as sender_nickname,
             e.recipient_member_id,
             recipient.nickname as recipient_nickname,
             e.event_type,
             e.visibility,
             e.text_content,
             e.audio_url,
             e.audio_duration_ms,
             e.latitude,
             e.longitude,
             e.location_label,
             e.created_at
        from family_context_events e
        join family_context_event_recipients r
          on r.event_id = e.id
         and r.member_id = v_member.id
        left join family_members sender on sender.id = e.sender_member_id
        left join family_members recipient on recipient.id = e.recipient_member_id
       where e.schedule_item_id = v_item.id
         and e.deleted_at is null
      union all
      select c.id,
             c.family_id,
             c.schedule_item_id,
             'member'::text as sender_type,
             c.member_id as sender_member_id,
             fm.nickname as sender_nickname,
             null::uuid as recipient_member_id,
             null::text as recipient_nickname,
             'text'::text as event_type,
             'family'::text as visibility,
             c.content as text_content,
             null::text as audio_url,
             null::integer as audio_duration_ms,
             null::double precision as latitude,
             null::double precision as longitude,
             null::text as location_label,
             c.created_at
        from family_schedule_comments c
        join family_members fm on fm.id = c.member_id
       where c.schedule_item_id = v_item.id
         and c.deleted_at is null
         and schedule_item_is_visible_to_member(v_item, v_member.id)
    ) timeline
   order by timeline.created_at asc, timeline.id asc
   limit 200;
end;
$$;

grant execute on function list_schedule_context_events_for_member(uuid, text, uuid)
  to anon, authenticated;

create or replace function respond_schedule_assignment(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_response text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_response text;
  v_note text;
  v_activity text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_response := trim(coalesce(p_response, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if v_response not in ('accepted', 'declined') then
    raise exception 'invalid_schedule_response';
  end if;
  if v_note is not null and length(v_note) > 300 then
    raise exception 'schedule_response_note_too_long';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.status = 'active'
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if v_item.assignee_member_id <> v_member.id then
    raise exception 'not_allowed';
  end if;

  update family_schedule_items
     set assignee_response = v_response,
         assignee_responded_at = now(),
         assignee_response_note = case when v_response = 'declined' then v_note else null end,
         updated_at = now()
   where id = v_item.id;

  v_activity := case when v_response = 'accepted' then 'accepted' else 'declined' end;
  perform add_schedule_activity_log(
    v_item.id,
    v_member.id,
    v_activity,
    case
      when v_response = 'accepted' then v_member.nickname || ' accepted the assignment'
      else v_member.nickname || ' declined the assignment'
    end,
    case
      when v_response = 'declined' and v_note is not null then jsonb_build_object('has_note', true)
      else '{}'::jsonb
    end
  );
  perform insert_schedule_context_event(
    v_item.id,
    'member',
    v_member.id,
    v_activity,
    case
      when v_response = 'accepted' then v_member.nickname || ' accepted the assignment'
      when v_note is not null then v_member.nickname || ' declined the assignment: ' || v_note
      else v_member.nickname || ' declined the assignment'
    end,
    null,
    null
  );
end;
$$;

create or replace function create_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_assignee_member_id uuid,
  p_recurrence_rule text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_assignee family_members%rowtype;
  v_title text;
  v_note text;
  v_rule text;
  v_count int;
  v_group_id uuid;
  v_first_id uuid;
  v_id uuid;
  v_index int;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remind_at timestamptz;
  v_duration interval;
  v_reminder_offset interval;
  v_response text;
  v_responded_at timestamptz;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_rule := coalesce(nullif(trim(coalesce(p_recurrence_rule, '')), ''), 'none');

  if length(v_title) = 0 then
    raise exception 'schedule_title_required';
  end if;
  if length(v_title) > 60 then
    raise exception 'schedule_title_too_long';
  end if;
  if coalesce(p_item_type, '') not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_schedule_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;
  if v_rule not in ('none', 'daily', 'weekly', 'monthly') then
    raise exception 'invalid_schedule_recurrence';
  end if;
  if p_starts_at is null then
    raise exception 'invalid_schedule_time';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'invalid_schedule_time';
  end if;

  select * into v_assignee
    from family_members fm
   where fm.id = p_assignee_member_id
     and fm.family_id = v_member.family_id
     and fm.status = 'active'
   limit 1;
  if not found then
    raise exception 'member_not_found';
  end if;

  v_response := case when v_assignee.id = v_member.id then 'accepted' else 'pending' end;
  v_responded_at := case when v_assignee.id = v_member.id then now() else null end;
  v_count := case v_rule
    when 'daily' then 30
    when 'weekly' then 12
    when 'monthly' then 12
    else 1
  end;
  v_group_id := case when v_rule = 'none' then null else gen_random_uuid() end;
  v_duration := case when p_ends_at is null then null else p_ends_at - p_starts_at end;
  v_reminder_offset := case when p_remind_at is null then null else p_starts_at - p_remind_at end;

  for v_index in 0..(v_count - 1) loop
    v_starts_at := case v_rule
      when 'daily' then p_starts_at + (v_index * interval '1 day')
      when 'weekly' then p_starts_at + (v_index * interval '1 week')
      when 'monthly' then p_starts_at + (v_index * interval '1 month')
      else p_starts_at
    end;
    v_ends_at := case when v_duration is null then null else v_starts_at + v_duration end;
    v_remind_at := case when v_reminder_offset is null then null else v_starts_at - v_reminder_offset end;

    insert into family_schedule_items (
      family_id, creator_member_id, assignee_member_id, title, note, item_type,
      visibility, starts_at, ends_at, remind_at,
      recurrence_group_id, recurrence_rule, recurrence_index,
      assignee_response, assignee_responded_at
    )
    values (
      v_member.family_id, v_member.id, v_assignee.id, v_title, v_note,
      p_item_type, p_visibility, v_starts_at, v_ends_at, v_remind_at,
      v_group_id, v_rule, case when v_rule = 'none' then null else v_index end,
      v_response, v_responded_at
    )
    returning id into v_id;

    perform add_schedule_activity_log(
      v_id,
      v_member.id,
      'created',
      v_member.nickname || ' created the schedule',
      '{}'::jsonb
    );
    perform insert_schedule_context_event(
      v_id,
      'keeper',
      null,
      'created',
      'Schedule created by ' || v_member.nickname || ' for ' || v_assignee.nickname,
      null,
      null
    );
    if v_assignee.id <> v_member.id then
      perform add_schedule_activity_log(
        v_id,
        v_member.id,
        'assigned',
        'Assigned to ' || v_assignee.nickname,
        '{}'::jsonb
      );
      perform insert_schedule_context_event(
        v_id,
        'keeper',
        null,
        'assigned',
        'Assigned to ' || v_assignee.nickname,
        null,
        null
      );
    end if;

    if v_index = 0 then
      v_first_id := v_id;
    end if;
  end loop;

  return v_first_id;
end;
$$;

create or replace function create_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_assignee_member_id uuid
)
returns uuid
language sql
security definer
set search_path = public, extensions
as $$
  select create_schedule_item(
    p_member_id, p_member_token, p_title, p_note, p_item_type, p_visibility,
    p_starts_at, p_ends_at, p_remind_at, p_assignee_member_id, 'none'
  );
$$;

create or replace function update_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_item_id uuid,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_assignee_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_recurrence_scope text default 'single'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_assignee family_members%rowtype;
  v_title text;
  v_note text;
  v_scope text;
  v_start_delta interval;
  v_duration interval;
  v_reminder_offset interval;
  v_updated int;
  v_activity text;
  v_summary text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_scope := coalesce(nullif(trim(coalesce(p_recurrence_scope, '')), ''), 'single');

  if length(v_title) = 0 then
    raise exception 'schedule_title_required';
  end if;
  if length(v_title) > 60 then
    raise exception 'schedule_title_too_long';
  end if;
  if coalesce(p_item_type, '') not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_schedule_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;
  if v_scope not in ('single', 'future', 'all') then
    raise exception 'invalid_schedule_scope';
  end if;
  if p_starts_at is null then
    raise exception 'invalid_schedule_time';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'invalid_schedule_time';
  end if;

  select * into v_assignee
    from family_members fm
   where fm.id = p_assignee_member_id
     and fm.family_id = v_member.family_id
     and fm.status = 'active'
   limit 1;
  if not found then
    raise exception 'member_not_found';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if v_item.status = 'cancelled' then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  if v_item.recurrence_group_id is null then
    v_scope := 'single';
  end if;
  v_start_delta := p_starts_at - v_item.starts_at;
  v_duration := case when p_ends_at is null then null else p_ends_at - p_starts_at end;
  v_reminder_offset := case when p_remind_at is null then null else p_starts_at - p_remind_at end;

  update family_schedule_items s
     set title = v_title,
         note = v_note,
         item_type = p_item_type,
         visibility = p_visibility,
         assignee_member_id = v_assignee.id,
         assignee_response = case
           when s.assignee_member_id is distinct from v_assignee.id then
             case when v_assignee.id = s.creator_member_id then 'accepted' else 'pending' end
           else s.assignee_response
         end,
         assignee_responded_at = case
           when s.assignee_member_id is distinct from v_assignee.id then
             case when v_assignee.id = s.creator_member_id then now() else null end
           else s.assignee_responded_at
         end,
         assignee_response_note = case
           when s.assignee_member_id is distinct from v_assignee.id then null
           else s.assignee_response_note
         end,
         starts_at = case when v_scope = 'single' then p_starts_at else s.starts_at + v_start_delta end,
         ends_at = case
           when p_ends_at is null then null
           when v_scope = 'single' then p_ends_at
           else (s.starts_at + v_start_delta) + v_duration
         end,
         remind_at = case
           when p_remind_at is null then null
           when v_scope = 'single' then p_remind_at
           else (s.starts_at + v_start_delta) - v_reminder_offset
         end,
         reminded_at = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminded_at
         end,
         reminder_push_attempted_at = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminder_push_attempted_at
         end,
         reminder_push_error = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminder_push_error
         end,
         updated_at = now()
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       (v_scope = 'single' and s.id = v_item.id)
       or (
         v_scope = 'future'
         and s.recurrence_group_id = v_item.recurrence_group_id
         and s.starts_at >= v_item.starts_at
       )
       or (
         v_scope = 'all'
         and s.recurrence_group_id = v_item.recurrence_group_id
       )
     )
     and (
       s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
       or (s.visibility = 'family' and v_member.is_admin)
     );

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'not_allowed';
  end if;

  if v_item.assignee_member_id is distinct from v_assignee.id then
    v_activity := 'assigned';
    v_summary := 'Assigned to ' || v_assignee.nickname;
  elsif v_item.visibility is distinct from p_visibility then
    v_activity := 'updated';
    v_summary := v_member.nickname || ' changed visibility';
  elsif v_item.remind_at is distinct from p_remind_at then
    v_activity := 'reminder_updated';
    v_summary := v_member.nickname || ' changed the reminder';
  else
    v_activity := 'updated';
    v_summary := v_member.nickname || ' updated the schedule';
  end if;

  perform add_schedule_activity_log(v_item.id, v_member.id, v_activity, v_summary, '{}'::jsonb);
  perform insert_schedule_context_event(v_item.id, 'member', v_member.id, v_activity, v_summary, null, null);
end;
$$;

create or replace function set_schedule_item_status(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_activity text;
  v_summary text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_status not in ('active', 'done') then
    raise exception 'invalid_schedule_status';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   for update;
  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
  ) then
    raise exception 'not_allowed';
  end if;

  update family_schedule_items
     set status = p_status,
         completed_at = case when p_status = 'done' then now() else null end,
         completed_by_member_id = case when p_status = 'done' then v_member.id else null end,
         updated_at = now()
   where id = v_item.id;

  v_activity := case when p_status = 'done' then 'completed' else 'restored' end;
  v_summary := case
    when p_status = 'done' then v_member.nickname || ' completed the schedule'
    else v_member.nickname || ' restored the schedule'
  end;
  perform add_schedule_activity_log(v_item.id, v_member.id, v_activity, v_summary, '{}'::jsonb);
  perform insert_schedule_context_event(v_item.id, 'member', v_member.id, v_activity, v_summary, null, null);
end;
$$;

create or replace function delete_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_recurrence_scope text default 'single'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_scope text;
  v_deleted int;
  v_summary text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_scope := coalesce(nullif(trim(coalesce(p_recurrence_scope, '')), ''), 'single');
  if v_scope not in ('single', 'future', 'all') then
    raise exception 'invalid_schedule_scope';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  if v_item.recurrence_group_id is null then
    v_scope := 'single';
  end if;

  update family_schedule_items s
     set status = 'cancelled',
         deleted_at = now(),
         deleted_by_member_id = v_member.id,
         updated_at = now()
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       (v_scope = 'single' and s.id = v_item.id)
       or (
         v_scope = 'future'
         and s.recurrence_group_id = v_item.recurrence_group_id
         and s.starts_at >= v_item.starts_at
       )
       or (
         v_scope = 'all'
         and s.recurrence_group_id = v_item.recurrence_group_id
       )
     )
     and (
       s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
       or (s.visibility = 'family' and v_member.is_admin)
     );

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'not_allowed';
  end if;
end;
$$;

create or replace function delete_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  select delete_schedule_item(
    p_member_id, p_member_token, p_schedule_item_id, 'single'
  );
$$;

grant execute on function respond_schedule_assignment(uuid, text, uuid, text, text)
  to anon, authenticated;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid)
  to anon, authenticated;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, text)
  to anon, authenticated;
grant execute on function update_schedule_item(uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz, timestamptz, text)
  to anon, authenticated;
grant execute on function set_schedule_item_status(uuid, text, uuid, text)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid, text)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_schedule_context_timeline',
  'schedule_context_timeline',
  'Turns schedule detail collaboration into a recipient-filtered conversation timeline.'
)
on conflict (version) do nothing;

-- 20260523_schedule_reminder_deliveries
-- Per-member delivery state for schedule reminders.

-- Stage 10: per-member schedule reminder deliveries.

create table if not exists family_schedule_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_item_id uuid not null references family_schedule_items(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'pending',
  attempt_count int not null default 0,
  delivered_at timestamptz,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  skipped_reason text,
  error_status int,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_item_id, member_id, scheduled_for)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_reminder_deliveries_status_check'
       and conrelid = 'family_schedule_reminder_deliveries'::regclass
  ) then
    alter table family_schedule_reminder_deliveries
      add constraint family_schedule_reminder_deliveries_status_check
      check (status in ('pending', 'sent', 'skipped', 'failed', 'gone'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_reminder_deliveries_attempt_count_check'
       and conrelid = 'family_schedule_reminder_deliveries'::regclass
  ) then
    alter table family_schedule_reminder_deliveries
      add constraint family_schedule_reminder_deliveries_attempt_count_check
      check (attempt_count >= 0);
  end if;
end;
$$;

create index if not exists family_schedule_reminder_deliveries_due_idx
  on family_schedule_reminder_deliveries (status, scheduled_for)
  where status = 'pending';

create index if not exists family_schedule_reminder_deliveries_retry_idx
  on family_schedule_reminder_deliveries (status, next_retry_at)
  where status = 'failed';

create index if not exists family_schedule_reminder_deliveries_item_idx
  on family_schedule_reminder_deliveries (schedule_item_id, scheduled_for desc);

create index if not exists family_schedule_reminder_deliveries_member_idx
  on family_schedule_reminder_deliveries (member_id, scheduled_for desc);

alter table family_schedule_reminder_deliveries enable row level security;
revoke all on family_schedule_reminder_deliveries from anon, authenticated;

drop policy if exists "family schedule reminder deliveries are rpc only"
  on family_schedule_reminder_deliveries;

create policy "family schedule reminder deliveries are rpc only"
  on family_schedule_reminder_deliveries for select
  to anon, authenticated
  using (false);

create or replace function ensure_schedule_reminder_deliveries(
  p_schedule_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_item family_schedule_items%rowtype;
  v_now timestamptz := now();
  v_seed_status text;
begin
  select * into v_item
    from family_schedule_items
   where id = p_schedule_item_id;

  if not found then
    return;
  end if;

  if v_item.remind_at is null
     or v_item.deleted_at is not null
     or v_item.status <> 'active' then
    update family_schedule_reminder_deliveries d
       set status = 'skipped',
           skipped_reason = case
             when v_item.remind_at is null then 'reminder_not_configured'
             else 'schedule_not_active'
           end,
           updated_at = v_now
     where d.schedule_item_id = v_item.id
       and d.status in ('pending', 'failed');
    return;
  end if;

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = 'reminder_changed',
         updated_at = v_now
   where d.schedule_item_id = v_item.id
     and d.status in ('pending', 'failed')
     and d.scheduled_for is distinct from v_item.remind_at;

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = 'not_visible',
         updated_at = v_now
   where d.schedule_item_id = v_item.id
     and d.status in ('pending', 'failed')
     and d.scheduled_for = v_item.remind_at
     and not exists (
       select 1
         from family_members fm
        where fm.id = d.member_id
          and fm.family_id = v_item.family_id
          and fm.status = 'active'
          and (
            v_item.visibility = 'family'
            or fm.id in (v_item.creator_member_id, v_item.assignee_member_id)
          )
     );

  v_seed_status := case when v_item.reminded_at is null then 'pending' else 'sent' end;

  insert into family_schedule_reminder_deliveries (
    family_id,
    schedule_item_id,
    member_id,
    scheduled_for,
    status,
    delivered_at,
    last_attempt_at,
    attempt_count,
    updated_at
  )
  select v_item.family_id,
         v_item.id,
         fm.id,
         v_item.remind_at,
         v_seed_status,
         case when v_seed_status = 'sent' then v_item.reminded_at else null end,
         case when v_seed_status = 'sent' then v_item.reminded_at else null end,
         case when v_seed_status = 'sent' then 1 else 0 end,
         v_now
    from family_members fm
   where fm.family_id = v_item.family_id
     and fm.status = 'active'
     and (
       v_item.visibility = 'family'
       or fm.id in (v_item.creator_member_id, v_item.assignee_member_id)
     )
  on conflict (schedule_item_id, member_id, scheduled_for) do nothing;
end;
$$;

create or replace function sync_schedule_reminder_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform ensure_schedule_reminder_deliveries(new.id);
  return new;
end;
$$;

drop trigger if exists trg_sync_schedule_reminder_deliveries
  on family_schedule_items;

create trigger trg_sync_schedule_reminder_deliveries
after insert or update of remind_at, reminded_at, status, deleted_at, visibility, assignee_member_id
on family_schedule_items
for each row
execute function sync_schedule_reminder_deliveries();

do $$
declare
  v_item_id uuid;
begin
  for v_item_id in
    select id from family_schedule_items
     where remind_at is not null
  loop
    perform ensure_schedule_reminder_deliveries(v_item_id);
  end loop;
end;
$$;

create or replace function get_schedule_reminder_status_for_member(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_can_view_members boolean;
  v_result jsonb;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null;

  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_reminder_not_allowed';
  end if;

  perform ensure_schedule_reminder_deliveries(v_item.id);

  v_can_view_members := v_item.creator_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin);

  select jsonb_build_object(
    'configured', v_item.remind_at is not null,
    'remind_at', v_item.remind_at,
    'current_member_delivery',
    (
      select jsonb_build_object(
        'id', d.id,
        'member_id', d.member_id,
        'nickname', fm.nickname,
        'scheduled_for', d.scheduled_for,
        'status', d.status,
        'attempt_count', d.attempt_count,
        'delivered_at', d.delivered_at,
        'last_attempt_at', d.last_attempt_at,
        'next_retry_at', d.next_retry_at,
        'skipped_reason', d.skipped_reason,
        'error_status', d.error_status,
        'error_message', case when d.error_message is null then null else 'schedule_reminder_failed' end,
        'updated_at', d.updated_at
      )
        from family_schedule_reminder_deliveries d
        join family_members fm on fm.id = d.member_id
       where d.schedule_item_id = v_item.id
         and d.member_id = v_member.id
       order by d.scheduled_for desc, d.created_at desc
       limit 1
    ),
    'deliveries',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'member_id', x.member_id,
          'nickname', x.nickname,
          'scheduled_for', x.scheduled_for,
          'status', x.status,
          'attempt_count', x.attempt_count,
          'delivered_at', x.delivered_at,
          'last_attempt_at', x.last_attempt_at,
          'next_retry_at', x.next_retry_at,
          'skipped_reason', x.skipped_reason,
          'error_status', x.error_status,
          'error_message', case when x.error_message is null then null else 'schedule_reminder_failed' end,
          'updated_at', x.updated_at
        )
        order by x.scheduled_for desc, x.nickname asc, x.member_id asc
      )
        from (
          select d.*, fm.nickname
            from family_schedule_reminder_deliveries d
            join family_members fm on fm.id = d.member_id
           where d.schedule_item_id = v_item.id
             and (
               v_can_view_members
               or d.member_id = v_member.id
             )
           order by d.scheduled_for desc, fm.nickname asc, d.member_id asc
           limit 100
        ) x
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function ensure_schedule_reminder_deliveries(uuid)
  to anon, authenticated;
grant execute on function get_schedule_reminder_status_for_member(uuid, text, uuid)
  to anon, authenticated;

-- 20260523_schedule_reminder_experience_closure
-- Stage 11: multi reminders, snooze, overdue reminders, and reminder health.

create table if not exists family_schedule_reminder_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_item_id uuid not null references family_schedule_items(id) on delete cascade,
  offset_minutes int not null,
  created_at timestamptz not null default now(),
  unique (schedule_item_id, offset_minutes)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_reminder_rules_offset_check'
       and conrelid = 'family_schedule_reminder_rules'::regclass
  ) then
    alter table family_schedule_reminder_rules
      add constraint family_schedule_reminder_rules_offset_check
      check (offset_minutes in (0, 10, 30, 60, 1440));
  end if;
end;
$$;

create index if not exists family_schedule_reminder_rules_item_idx
  on family_schedule_reminder_rules (schedule_item_id, offset_minutes);

alter table family_schedule_reminder_rules enable row level security;
revoke all on family_schedule_reminder_rules from anon, authenticated;

drop policy if exists "family schedule reminder rules are rpc only"
  on family_schedule_reminder_rules;

create policy "family schedule reminder rules are rpc only"
  on family_schedule_reminder_rules for select
  to anon, authenticated
  using (false);

alter table family_schedule_reminder_deliveries
  add column if not exists reminder_kind text not null default 'before_start',
  add column if not exists snoozed_from_delivery_id uuid references family_schedule_reminder_deliveries(id) on delete set null,
  add column if not exists snoozed_by_member_id uuid references family_members(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_reminder_deliveries_kind_check'
       and conrelid = 'family_schedule_reminder_deliveries'::regclass
  ) then
    alter table family_schedule_reminder_deliveries
      add constraint family_schedule_reminder_deliveries_kind_check
      check (reminder_kind in ('before_start', 'snooze', 'overdue'));
  end if;
end;
$$;

create index if not exists family_schedule_reminder_deliveries_kind_idx
  on family_schedule_reminder_deliveries (family_id, reminder_kind, status, scheduled_for);

create or replace function ensure_schedule_reminder_deliveries(
  p_schedule_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_item family_schedule_items%rowtype;
  v_now timestamptz := now();
begin
  select * into v_item
    from family_schedule_items
   where id = p_schedule_item_id;

  if not found then
    return;
  end if;

  if v_item.deleted_at is not null or v_item.status <> 'active' then
    update family_schedule_reminder_deliveries d
       set status = 'skipped',
           skipped_reason = 'schedule_not_active',
           updated_at = v_now
     where d.schedule_item_id = v_item.id
       and d.status in ('pending', 'failed');
    return;
  end if;

  if not exists (
    select 1 from family_schedule_reminder_rules r
     where r.schedule_item_id = v_item.id
  ) and v_item.remind_at is null then
    update family_schedule_reminder_deliveries d
       set status = 'skipped',
           skipped_reason = 'reminder_not_configured',
           updated_at = v_now
     where d.schedule_item_id = v_item.id
       and d.status in ('pending', 'failed')
       and d.reminder_kind = 'before_start';
    return;
  end if;

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = 'reminder_changed',
         updated_at = v_now
   where d.schedule_item_id = v_item.id
     and d.status in ('pending', 'failed')
     and d.reminder_kind = 'before_start'
     and not exists (
       with offsets as (
         select r.offset_minutes
           from family_schedule_reminder_rules r
          where r.schedule_item_id = v_item.id
         union
         select greatest(0, round(extract(epoch from (v_item.starts_at - v_item.remind_at)) / 60)::int)
          where v_item.remind_at is not null
            and not exists (
              select 1 from family_schedule_reminder_rules rr
               where rr.schedule_item_id = v_item.id
            )
       )
       select 1 from offsets o
        where d.scheduled_for = v_item.starts_at - (o.offset_minutes * interval '1 minute')
     );

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = 'not_visible',
         updated_at = v_now
   where d.schedule_item_id = v_item.id
     and d.status in ('pending', 'failed')
     and not exists (
       select 1
         from family_members fm
        where fm.id = d.member_id
          and fm.family_id = v_item.family_id
          and fm.status = 'active'
          and (
            v_item.visibility = 'family'
            or fm.id in (v_item.creator_member_id, v_item.assignee_member_id)
          )
     );

  insert into family_schedule_reminder_deliveries (
    family_id,
    schedule_item_id,
    member_id,
    scheduled_for,
    reminder_kind,
    status,
    updated_at
  )
  with offsets as (
    select r.offset_minutes
      from family_schedule_reminder_rules r
     where r.schedule_item_id = v_item.id
    union
    select greatest(0, round(extract(epoch from (v_item.starts_at - v_item.remind_at)) / 60)::int)
     where v_item.remind_at is not null
       and not exists (
         select 1 from family_schedule_reminder_rules rr
          where rr.schedule_item_id = v_item.id
       )
  )
  select v_item.family_id,
         v_item.id,
         fm.id,
         v_item.starts_at - (o.offset_minutes * interval '1 minute'),
         'before_start',
         'pending',
         v_now
    from offsets o
    join family_members fm on fm.family_id = v_item.family_id
   where fm.status = 'active'
     and (
       v_item.visibility = 'family'
       or fm.id in (v_item.creator_member_id, v_item.assignee_member_id)
     )
  on conflict (schedule_item_id, member_id, scheduled_for) do nothing;
end;
$$;

create or replace function set_schedule_reminder_rules(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_offsets int[],
  p_recurrence_scope text default 'single'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_scope text;
  v_offsets int[];
  v_target record;
  v_remind_at timestamptz;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_scope := coalesce(nullif(trim(coalesce(p_recurrence_scope, '')), ''), 'single');
  if v_scope not in ('single', 'future', 'all') then
    raise exception 'invalid_schedule_scope';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  if v_item.recurrence_group_id is null then
    v_scope := 'single';
  end if;

  select coalesce(array_agg(distinct offset_minutes order by offset_minutes), '{}'::int[])
    into v_offsets
    from unnest(coalesce(p_offsets, '{}'::int[])) as offset_minutes
   where offset_minutes in (0, 10, 30, 60, 1440);

  if coalesce(array_length(v_offsets, 1), 0) <> coalesce(array_length(p_offsets, 1), 0) then
    raise exception 'invalid_schedule_reminder_offset';
  end if;

  for v_target in
    select s.*
      from family_schedule_items s
     where s.family_id = v_member.family_id
       and s.deleted_at is null
       and (
         (v_scope = 'single' and s.id = v_item.id)
         or (
           v_scope = 'future'
           and s.recurrence_group_id = v_item.recurrence_group_id
           and s.starts_at >= v_item.starts_at
         )
         or (
           v_scope = 'all'
           and s.recurrence_group_id = v_item.recurrence_group_id
         )
       )
       and (
         s.creator_member_id = v_member.id
         or s.assignee_member_id = v_member.id
         or (s.visibility = 'family' and v_member.is_admin)
       )
  loop
    delete from family_schedule_reminder_rules
     where schedule_item_id = v_target.id;

    insert into family_schedule_reminder_rules (
      family_id, schedule_item_id, offset_minutes
    )
    select v_target.family_id, v_target.id, offset_minutes
      from unnest(v_offsets) as offset_minutes;

    select min(v_target.starts_at - (offset_minutes * interval '1 minute'))
      into v_remind_at
      from unnest(v_offsets) as offset_minutes;

    update family_schedule_items
       set remind_at = v_remind_at,
           reminded_at = null,
           reminder_push_attempted_at = null,
           reminder_push_error = null,
           updated_at = now()
     where id = v_target.id;

    perform ensure_schedule_reminder_deliveries(v_target.id);
  end loop;
end;
$$;

create or replace function snooze_schedule_reminder(
  p_member_id uuid,
  p_member_token text,
  p_delivery_id uuid,
  p_minutes int
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_delivery family_schedule_reminder_deliveries%rowtype;
  v_item family_schedule_items%rowtype;
  v_id uuid;
  v_scheduled_for timestamptz;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_minutes not in (5, 10, 30) then
    raise exception 'invalid_schedule_snooze_minutes';
  end if;

  select * into v_delivery
    from family_schedule_reminder_deliveries d
   where d.id = p_delivery_id
     and d.member_id = v_member.id
   limit 1;
  if not found then
    raise exception 'schedule_reminder_not_found';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = v_delivery.schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.status = 'active';
  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_reminder_not_allowed';
  end if;

  v_scheduled_for := now() + (p_minutes * interval '1 minute');

  insert into family_schedule_reminder_deliveries (
    family_id,
    schedule_item_id,
    member_id,
    scheduled_for,
    reminder_kind,
    status,
    snoozed_from_delivery_id,
    snoozed_by_member_id,
    updated_at
  )
  values (
    v_delivery.family_id,
    v_delivery.schedule_item_id,
    v_member.id,
    v_scheduled_for,
    'snooze',
    'pending',
    v_delivery.id,
    v_member.id,
    now()
  )
  on conflict (schedule_item_id, member_id, scheduled_for)
  do update set
    status = 'pending',
    reminder_kind = 'snooze',
    skipped_reason = null,
    next_retry_at = null,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

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
     and s.starts_at <= now() - interval '10 minutes'
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

create or replace function get_schedule_reminder_health_for_member(
  p_member_id uuid,
  p_member_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_result jsonb;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if not v_member.is_admin then
    raise exception 'not_admin';
  end if;

  select jsonb_build_object(
    'pending', count(*) filter (where d.status = 'pending'),
    'sent', count(*) filter (where d.status = 'sent'),
    'failed', count(*) filter (where d.status = 'failed'),
    'gone', count(*) filter (where d.status = 'gone'),
    'skipped', count(*) filter (where d.status = 'skipped'),
    'private_failed', count(*) filter (where d.status = 'failed' and s.visibility = 'private'),
    'recentFailures',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'deliveryId', x.id,
          'status', x.status,
          'reminderKind', x.reminder_kind,
          'errorStatus', x.error_status,
          'attemptCount', x.attempt_count,
          'nextRetryAt', x.next_retry_at,
          'updatedAt', x.updated_at
        )
        order by x.updated_at desc
      )
        from (
          select d.*
            from family_schedule_reminder_deliveries d
            join family_schedule_items s on s.id = d.schedule_item_id
           where d.family_id = v_member.family_id
             and d.status in ('failed', 'gone')
             and s.visibility = 'family'
           order by d.updated_at desc
           limit 5
        ) x
    ), '[]'::jsonb)
  )
  into v_result
  from family_schedule_reminder_deliveries d
  join family_schedule_items s on s.id = d.schedule_item_id
  where d.family_id = v_member.family_id;

  return coalesce(v_result, jsonb_build_object(
    'pending', 0,
    'sent', 0,
    'failed', 0,
    'gone', 0,
    'skipped', 0,
    'private_failed', 0,
    'recentFailures', '[]'::jsonb
  ));
end;
$$;

grant execute on function set_schedule_reminder_rules(uuid, text, uuid, int[], text)
  to anon, authenticated;
grant execute on function snooze_schedule_reminder(uuid, text, uuid, int)
  to anon, authenticated;
grant execute on function ensure_overdue_schedule_reminders()
  to service_role;
grant execute on function get_schedule_reminder_health_for_member(uuid, text)
  to anon, authenticated;

-- 20260523_harden_delete_message_private_visibility
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

  if v_msg.recipient_member_id is not null
     and v_msg.sender_member_id is distinct from p_member_id
     and v_msg.recipient_member_id is distinct from p_member_id then
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

grant execute on function delete_message(uuid, text, uuid) to anon, authenticated;

-- 20260526_assistant_card_creator_visibility
-- Keep assistant confirmation cards visible only to the member who created them.
-- Confirmed actions still create a separate result message for the intended recipients.

create or replace function create_assistant_action_card(
  p_member_id uuid,
  p_member_token text,
  p_card_type text,
  p_title text,
  p_summary text,
  p_payload jsonb default '{}'::jsonb,
  p_source_message_id uuid default null,
  p_target_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_title text;
  v_summary text;
  v_payload jsonb;
  v_card_id uuid;
  v_message_id uuid;
  v_visibility text;
  v_assignee_id uuid;
  v_source_visible boolean;
  v_target messages%rowtype;
  v_schedule_id uuid;
  v_schedule family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if coalesce(p_card_type, '') not in (
    'reminder', 'schedule', 'important', 'todo', 'schedule_update', 'schedule_cancel'
  ) then
    raise exception 'invalid_assistant_card_type';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_summary := nullif(trim(coalesce(p_summary, '')), '');
  v_payload := coalesce(p_payload, '{}'::jsonb);
  v_visibility := coalesce(nullif(v_payload->>'visibility', ''), 'family');

  if length(v_title) = 0 then
    raise exception 'assistant_card_title_required';
  end if;
  if length(v_title) > 80 then
    raise exception 'assistant_card_title_too_long';
  end if;
  if v_summary is not null and length(v_summary) > 300 then
    raise exception 'assistant_card_summary_too_long';
  end if;
  if v_visibility not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;

  if p_source_message_id is not null then
    select exists (
      select 1
        from message_recipients mr
       where mr.family_id = v_member.family_id
         and mr.member_id = v_member.id
         and mr.message_id = p_source_message_id
    ) into v_source_visible;
    if not v_source_visible then
      raise exception 'message_not_found';
    end if;
  end if;

  if p_card_type = 'important' then
    if p_target_message_id is null then
      raise exception 'assistant_target_required';
    end if;

    select m.* into v_target
      from message_recipients mr
      join messages m on m.id = mr.message_id and m.family_id = mr.family_id
     where mr.family_id = v_member.family_id
       and mr.member_id = v_member.id
       and mr.message_id = p_target_message_id
     limit 1;
    if not found then
      raise exception 'message_not_found';
    end if;
    if v_target.recipient_member_id is not null or v_target.message_type = 'system' or v_target.deleted_at is not null then
      raise exception 'assistant_target_not_allowed';
    end if;
  end if;

  if p_card_type in ('schedule_update', 'schedule_cancel') then
    v_schedule_id := nullif(v_payload->>'schedule_item_id', '')::uuid;
    if v_schedule_id is null then
      raise exception 'schedule_item_not_found';
    end if;

    select * into v_schedule
      from family_schedule_items s
     where s.id = v_schedule_id
       and s.family_id = v_member.family_id
       and s.deleted_at is null
       and s.status = 'active'
     limit 1;
    if not found or not schedule_item_is_visible_to_member(v_schedule, v_member.id) then
      raise exception 'schedule_item_not_found';
    end if;
  end if;

  v_assignee_id := nullif(v_payload->>'assignee_member_id', '')::uuid;
  if v_assignee_id is not null then
    if not exists (
      select 1 from family_members fm
       where fm.id = v_assignee_id
         and fm.family_id = v_member.family_id
         and fm.status = 'active'
    ) then
      raise exception 'member_not_found';
    end if;
  end if;

  insert into assistant_action_cards (
    family_id, created_by_member_id, source_message_id, target_message_id,
    card_type, status, title, summary, payload
  )
  values (
    v_member.family_id, v_member.id, p_source_message_id, p_target_message_id,
    p_card_type, 'pending', v_title, v_summary, v_payload
  )
  returning id into v_card_id;

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, system_event_type, system_event_payload
  )
  values (
    v_member.family_id,
    v_member.id,
    v_member.id,
    'system',
    'Home Assistant confirmation card',
    'assistant_card_created',
    jsonb_build_object(
      'actor_type', 'assistant',
      'card_id', v_card_id,
      'card_type', p_card_type,
      'status', 'pending'
    )
  )
  returning id into v_message_id;

  update assistant_action_cards
     set card_message_id = v_message_id
   where id = v_card_id;

  update family_members
     set last_active_at = now()
   where id = v_member.id;

  return jsonb_build_object('card_id', v_card_id, 'message_id', v_message_id);
end;
$$;

grant execute on function create_assistant_action_card(uuid, text, text, text, text, jsonb, uuid, uuid)
  to anon, authenticated;

create or replace function list_assistant_action_cards_for_member(
  p_member_id uuid,
  p_member_token text
)
returns table (
  id uuid,
  family_id uuid,
  created_by_member_id uuid,
  card_message_id uuid,
  source_message_id uuid,
  target_message_id uuid,
  card_type text,
  status text,
  title text,
  summary text,
  payload jsonb,
  result_schedule_item_id uuid,
  result_important_notification_id uuid,
  result_message_id uuid,
  confirmed_at timestamptz,
  confirmed_by_member_id uuid,
  cancelled_at timestamptz,
  cancelled_by_member_id uuid,
  expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
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
  select c.id, c.family_id, c.created_by_member_id, c.card_message_id,
         c.source_message_id, c.target_message_id, c.card_type, c.status,
         c.title, c.summary, c.payload, c.result_schedule_item_id,
         c.result_important_notification_id, c.result_message_id,
         c.confirmed_at, c.confirmed_by_member_id,
         c.cancelled_at, c.cancelled_by_member_id,
         c.expires_at, c.created_at, c.updated_at
    from assistant_action_cards c
   where c.family_id = v_member.family_id
     and c.created_by_member_id = v_member.id
   order by c.created_at desc, c.id desc
   limit 200;
end;
$$;

grant execute on function list_assistant_action_cards_for_member(uuid, text)
  to anon, authenticated;

update messages m
   set recipient_member_id = c.created_by_member_id
  from assistant_action_cards c
 where c.card_message_id = m.id
   and m.system_event_type in (
     'assistant_card_created',
     'assistant_card_confirmed',
     'assistant_card_cancelled'
   );

delete from message_recipients mr
using assistant_action_cards c
where c.card_message_id = mr.message_id
  and mr.member_id <> c.created_by_member_id;

insert into message_recipients (family_id, message_id, member_id, created_at)
select c.family_id, c.card_message_id, c.created_by_member_id, m.created_at
  from assistant_action_cards c
  join messages m on m.id = c.card_message_id
 where c.card_message_id is not null
on conflict (message_id, member_id) do nothing;

insert into app_schema_migrations (version, name, description)
values (
  '20260526_assistant_card_creator_visibility',
  'assistant_card_creator_visibility',
  'Keeps assistant confirmation cards visible only to the creator; confirmed actions still notify intended recipients.'
)
on conflict (version) do nothing;

-- 20260526_assistant_action_done_participant_visibility
-- Send assistant schedule result messages only to the members participating in
-- the schedule action: the creator and the assignee.

create or replace function confirm_assistant_action_card(
  p_member_id uuid,
  p_member_token text,
  p_card_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_card assistant_action_cards%rowtype;
  v_assignee_id uuid;
  v_visibility text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remind_at timestamptz;
  v_item_type text;
  v_schedule_item_id uuid;
  v_notification_id uuid;
  v_done_message_id uuid;
  v_done_recipient_member_id uuid;
  v_existing_item family_schedule_items%rowtype;
  v_note text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_card
    from assistant_action_cards c
   where c.id = p_card_id
     and c.family_id = v_member.family_id
   for update;
  if not found then
    raise exception 'assistant_card_not_found';
  end if;
  if v_card.created_by_member_id <> v_member.id then
    raise exception 'assistant_card_not_allowed';
  end if;
  if v_card.status <> 'pending' then
    raise exception 'assistant_card_not_pending';
  end if;
  if v_card.expires_at <= now() then
    update assistant_action_cards
       set status = 'expired'
     where id = v_card.id;
    raise exception 'assistant_card_expired';
  end if;

  if v_card.card_type in ('reminder', 'schedule', 'todo') then
    v_visibility := coalesce(nullif(v_card.payload->>'visibility', ''), 'family');
    v_item_type := case
      when v_card.card_type = 'todo' then 'todo'
      else coalesce(nullif(v_card.payload->>'item_type', ''), v_card.card_type)
    end;
    v_assignee_id := coalesce(nullif(v_card.payload->>'assignee_member_id', '')::uuid, v_member.id);
    v_starts_at := nullif(v_card.payload->>'starts_at', '')::timestamptz;
    v_ends_at := nullif(v_card.payload->>'ends_at', '')::timestamptz;
    v_remind_at := nullif(v_card.payload->>'remind_at', '')::timestamptz;

    if v_starts_at is null then
      raise exception 'invalid_schedule_time';
    end if;

    v_schedule_item_id := create_schedule_item(
      p_member_id,
      p_member_token,
      v_card.title,
      v_card.summary,
      v_item_type,
      v_visibility,
      v_starts_at,
      v_ends_at,
      coalesce(v_remind_at, case when v_card.card_type = 'reminder' then v_starts_at else null end),
      v_assignee_id,
      'none'
    );

    if v_card.card_type = 'reminder' or v_remind_at is not null then
      perform set_schedule_reminder_rules(
        p_member_id,
        p_member_token,
        v_schedule_item_id,
        array[0]::int[],
        'single'
      );
    end if;
  elsif v_card.card_type = 'schedule_update' then
    v_schedule_item_id := nullif(v_card.payload->>'schedule_item_id', '')::uuid;
    if v_schedule_item_id is null then
      raise exception 'schedule_item_not_found';
    end if;

    select * into v_existing_item
      from family_schedule_items s
     where s.id = v_schedule_item_id
       and s.family_id = v_member.family_id
       and s.deleted_at is null
     for update;
    if not found or not schedule_item_is_visible_to_member(v_existing_item, v_member.id) then
      raise exception 'schedule_item_not_found';
    end if;

    v_starts_at := coalesce(
      nullif(v_card.payload->>'starts_at', '')::timestamptz,
      v_existing_item.starts_at
    );
    v_ends_at := case
      when v_card.payload ? 'ends_at' then nullif(v_card.payload->>'ends_at', '')::timestamptz
      else v_existing_item.ends_at
    end;
    v_remind_at := case
      when v_card.payload ? 'remind_at' then nullif(v_card.payload->>'remind_at', '')::timestamptz
      else v_existing_item.remind_at
    end;
    v_assignee_id := coalesce(
      nullif(v_card.payload->>'assignee_member_id', '')::uuid,
      v_existing_item.assignee_member_id
    );
    v_visibility := coalesce(
      nullif(v_card.payload->>'visibility', ''),
      v_existing_item.visibility
    );
    v_item_type := coalesce(
      nullif(v_card.payload->>'item_type', ''),
      v_existing_item.item_type
    );
    v_note := case
      when v_card.payload ? 'note' then nullif(v_card.payload->>'note', '')
      else v_existing_item.note
    end;

    perform update_schedule_item(
      p_member_id,
      p_member_token,
      v_schedule_item_id,
      coalesce(nullif(v_card.payload->>'title', ''), v_existing_item.title),
      v_note,
      v_item_type,
      v_visibility,
      v_assignee_id,
      v_starts_at,
      v_ends_at,
      v_remind_at,
      'single'
    );
  elsif v_card.card_type = 'schedule_cancel' then
    v_schedule_item_id := nullif(v_card.payload->>'schedule_item_id', '')::uuid;
    if v_schedule_item_id is null then
      raise exception 'schedule_item_not_found';
    end if;

    select * into v_existing_item
      from family_schedule_items s
     where s.id = v_schedule_item_id
       and s.family_id = v_member.family_id
       and s.deleted_at is null
     for update;
    if not found or not schedule_item_is_visible_to_member(v_existing_item, v_member.id) then
      raise exception 'schedule_item_not_found';
    end if;
    v_assignee_id := v_existing_item.assignee_member_id;

    perform delete_schedule_item(
      p_member_id,
      p_member_token,
      v_schedule_item_id,
      'single'
    );
  elsif v_card.card_type = 'important' then
    v_notification_id := add_important_notification(
      p_member_id,
      p_member_token,
      v_card.target_message_id
    );
  end if;

  update assistant_action_cards
     set status = 'confirmed',
         confirmed_at = now(),
         confirmed_by_member_id = v_member.id,
         result_schedule_item_id = v_schedule_item_id,
         result_important_notification_id = v_notification_id
   where id = v_card.id;

  update messages
     set system_event_payload =
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 coalesce(system_event_payload, '{}'::jsonb),
                 '{status}',
                 to_jsonb('confirmed'::text),
                 true
               ),
               '{result_schedule_item_id}',
               coalesce(to_jsonb(v_schedule_item_id), 'null'::jsonb),
               true
             ),
             '{result_important_notification_id}',
             coalesce(to_jsonb(v_notification_id), 'null'::jsonb),
             true
           ),
         system_event_type = 'assistant_card_confirmed'
   where id = v_card.card_message_id;

  if v_schedule_item_id is not null then
    v_done_recipient_member_id := coalesce(v_assignee_id, v_member.id);
  elsif coalesce(v_card.payload->>'visibility', 'family') = 'private' then
    v_done_recipient_member_id := coalesce(
      nullif(v_card.payload->>'assignee_member_id', '')::uuid,
      v_member.id
    );
  end if;

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, system_event_type, system_event_payload
  )
  values (
    v_member.family_id,
    v_member.id,
    v_done_recipient_member_id,
    'system',
    'Home Assistant action done',
    'assistant_action_done',
    jsonb_build_object(
      'actor_type', 'assistant',
      'card_id', v_card.id,
      'card_type', v_card.card_type,
      'schedule_item_id', v_schedule_item_id,
      'important_notification_id', v_notification_id
    )
  )
  returning id into v_done_message_id;

  update assistant_action_cards
     set result_message_id = v_done_message_id
   where id = v_card.id;

  return jsonb_build_object(
    'card_id', v_card.id,
    'message_id', v_card.card_message_id,
    'result_message_id', v_done_message_id,
    'schedule_item_id', v_schedule_item_id,
    'important_notification_id', v_notification_id,
    'status', 'confirmed'
  );
end;
$$;

grant execute on function confirm_assistant_action_card(uuid, text, uuid)
  to anon, authenticated;

update messages m
   set recipient_member_id = coalesce(s.assignee_member_id, c.created_by_member_id)
  from assistant_action_cards c
  left join family_schedule_items s
    on s.id = c.result_schedule_item_id
   and s.family_id = c.family_id
 where m.id = c.result_message_id
   and c.result_schedule_item_id is not null
   and m.system_event_type = 'assistant_action_done';

delete from message_recipients mr
using assistant_action_cards c
left join family_schedule_items s
  on s.id = c.result_schedule_item_id
 and s.family_id = c.family_id
where mr.message_id = c.result_message_id
  and c.result_schedule_item_id is not null
  and mr.member_id not in (
    c.created_by_member_id,
    coalesce(s.assignee_member_id, c.created_by_member_id)
  );

insert into message_recipients (family_id, message_id, member_id, created_at)
select distinct c.family_id,
       c.result_message_id,
       participant.member_id,
       m.created_at
  from assistant_action_cards c
  join messages m on m.id = c.result_message_id
  left join family_schedule_items s
    on s.id = c.result_schedule_item_id
   and s.family_id = c.family_id
  cross join lateral (
    values
      (c.created_by_member_id),
      (coalesce(s.assignee_member_id, c.created_by_member_id))
  ) as participant(member_id)
 where c.result_schedule_item_id is not null
   and c.result_message_id is not null
   and participant.member_id is not null
on conflict (message_id, member_id) do nothing;

insert into app_schema_migrations (version, name, description)
values (
  '20260526_assistant_action_done_participant_visibility',
  'assistant_action_done_participant_visibility',
  'Scopes assistant schedule result messages to the creator and assignee participants.'
)
on conflict (version) do nothing;

-- =====================================================================
-- Supabase security lint hardening
-- =====================================================================

alter function public.schedule_item_is_visible_to_member(public.family_schedule_items, uuid)
  set search_path = public, extensions;

drop policy if exists "chat-images public read" on storage.objects;
drop policy if exists "chat-audios public read" on storage.objects;
drop policy if exists "chat-images anon upload" on storage.objects;
drop policy if exists "chat-audios anon upload" on storage.objects;

update storage.buckets
   set public = false
 where id in ('chat-images', 'chat-audios');

insert into app_schema_migrations (version, name, description)
values (
  '20260614_private_chat_media_storage',
  'private_chat_media_storage',
  'Makes chat media buckets private and accepts storage refs for chat media and avatars.'
)
on conflict (version) do nothing;

do $$
declare
  v_signature text;
  v_func regprocedure;
  v_signatures text[] := array[
    'public.add_schedule_activity_log(uuid, uuid, text, text, jsonb)',
    'public.assert_join_rate_limit()',
    'public.assign_message_family_seq()',
    'public.cleanup_push_delivery_logs()',
    'public.current_member_from_token(uuid, text)',
    'public.delete_old_schedule_events()',
    'public.enqueue_important_notification_realtime_event()',
    'public.enqueue_message_realtime_event()',
    'public.enqueue_schedule_event_for_visible_members(uuid, text)',
    'public.enqueue_schedule_realtime_events()',
    'public.enqueue_schedule_reminder_delivery_realtime_event()',
    'public.ensure_overdue_schedule_reminders()',
    'public.ensure_schedule_reminder_deliveries(uuid)',
    'public.populate_message_recipients_for_message()',
    'public.record_join_attempt(text, text, boolean)',
    'public.record_sticker_usage(uuid, text)',
    'public.request_ip_hash()',
    'public.sync_schedule_reminder_deliveries()'
  ];
begin
  foreach v_signature in array v_signatures loop
    v_func := to_regprocedure(v_signature);
    if v_func is not null then
      execute format('revoke all on function %s from public, anon, authenticated', v_func);
      execute format('grant execute on function %s to service_role', v_func);
    end if;
  end loop;
end $$;
