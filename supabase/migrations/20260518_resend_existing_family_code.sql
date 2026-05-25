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
