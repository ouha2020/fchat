-- Preserve member identity when a device signs out and later rejoins with an
-- existing nickname. Rejoining with the family admin password restores the
-- original row instead of creating a new member.

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

  if not v_family.join_enabled then
    raise exception 'join_disabled';
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

grant execute on function join_family(text, text, text) to anon, authenticated;
grant execute on function rejoin_family_member(text, text, text) to anon, authenticated;
grant execute on function leave_family(uuid, text) to anon, authenticated;

do $$
declare
  v_family_id uuid;
  v_admin_member_id uuid;
  v_duplicate_member_id uuid;
begin
  select id into v_family_id
    from families
   where family_code = 'H2D2K2'
   limit 1;

  if v_family_id is null then
    return;
  end if;

  select id into v_admin_member_id
    from family_members
   where family_id = v_family_id
     and nickname = '爸爸'
     and is_admin = true
   order by case when status = 'removed' then 0 else 1 end, created_at
   limit 1;

  select id into v_duplicate_member_id
    from family_members
   where family_id = v_family_id
     and nickname = '爸爸'
     and id <> v_admin_member_id
     and is_admin = false
   order by case when status = 'active' then 0 else 1 end, created_at desc
   limit 1;

  if v_admin_member_id is null or v_duplicate_member_id is null then
    return;
  end if;

  update messages
     set sender_member_id = v_admin_member_id
   where sender_member_id = v_duplicate_member_id;

  update messages
     set deleted_by_member_id = v_admin_member_id
   where deleted_by_member_id = v_duplicate_member_id;

  update important_notifications
     set created_by_member_id = v_admin_member_id
   where created_by_member_id = v_duplicate_member_id;

  update important_notifications
     set removed_by_member_id = v_admin_member_id
   where removed_by_member_id = v_duplicate_member_id;

  update family_members
     set status = 'removed',
         updated_at = now()
   where id = v_duplicate_member_id;

  update family_members
     set status = 'active',
         updated_at = now()
   where id = v_admin_member_id;
end
$$;

notify pgrst, 'reload schema';
