-- Auth owner + pending family code flow.
-- Keeps anonymous member_token chat sessions while requiring Supabase Auth
-- for the member who creates a family.

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
