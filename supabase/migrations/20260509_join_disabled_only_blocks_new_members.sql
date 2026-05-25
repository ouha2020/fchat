-- Make "allow new members to join" only block brand-new nicknames.
-- Existing active/removed nicknames should still surface nickname_taken so the
-- client can show the admin-password rejoin flow and preserve member history.

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

grant execute on function join_family(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
