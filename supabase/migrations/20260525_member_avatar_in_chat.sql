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
