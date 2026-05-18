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
