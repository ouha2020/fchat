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
