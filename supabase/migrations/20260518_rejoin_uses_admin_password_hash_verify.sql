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
