-- 「移除成员」修复：
-- 1) 把 (family_id, nickname) UNIQUE 改成只对 active 生效，让被移除的人能用同名重新加入
-- 2) family_members 改 replica identity full，Realtime UPDATE 才能携带 status
-- 3) drop 旧 4 参数 remove_member（带 admin_password），换成 3 参数版本：
--    依赖会话 token + is_admin 即可，免去经常被忘记的管理员密码

alter table family_members
  drop constraint if exists family_members_family_id_nickname_key;

create unique index if not exists family_members_active_nickname_idx
  on family_members (family_id, nickname)
  where status = 'active';

alter table family_members replica identity full;

drop function if exists public.remove_member(uuid, text, text, uuid);

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

grant execute on function remove_member(uuid, text, uuid) to anon, authenticated;
