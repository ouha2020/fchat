-- Allow a family to re-enter an already-used nickname after confirming the
-- family admin password. This is useful when a member opens the chat from a
-- new browser/device and no longer has the local token for that nickname.

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
     and fm.status = 'active'
   limit 1;

  if not found then
    raise exception 'member_not_found';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  update family_members
     set member_token_hash = hash_secret(v_token),
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

grant execute on function rejoin_family_member(text, text, text) to anon, authenticated;
