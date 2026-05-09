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
  deleted_at timestamptz,
  deleted_by_member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Realtime UPDATE events need full row payloads (e.g. for delete_message).
alter table messages replica identity full;

create index if not exists messages_family_id_created_at_idx
  on messages (family_id, created_at desc);

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
    '家庭已创建，欢迎来到「' || trim(p_family_name) || '」'
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
    v_clean_nickname || ' 加入了家庭'
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
  values (v_family_id, 'system', '家庭名称已更新为「' || trim(p_new_name) || '」');
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
  values (v_family_id, 'system', '家庭代码已重置');

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
    case when p_join_enabled then '管理员开启了新成员加入'
         else '管理员关闭了新成员加入' end
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
    v_target.nickname || ' 已被移出家庭'
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
    v_member.nickname || ' 离开了家庭'
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
