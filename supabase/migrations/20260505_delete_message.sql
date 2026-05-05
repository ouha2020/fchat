-- 删除消息（软删除）：发送者或管理员可删除自己/任意非系统消息。
-- 1) 给 messages 加 deleted_at / deleted_by_member_id
-- 2) 设置 replica identity full，让 Realtime UPDATE 携带完整 payload
-- 3) 新增 delete_message(p_member_id, p_member_token, p_message_id) RPC

alter table messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_member_id uuid references family_members(id) on delete set null;

create index if not exists messages_family_id_deleted_at_created_at_idx
  on messages (family_id, deleted_at, created_at desc);

alter table messages replica identity full;

create or replace function delete_message(
  p_member_id uuid,
  p_member_token text,
  p_message_id uuid
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_msg messages%rowtype;
  v_member family_members%rowtype;
begin
  select * into v_member
    from family_members
   where id = p_member_id
     and member_token_hash = hash_secret(p_member_token)
     and status = 'active';
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_msg
    from messages
   where id = p_message_id
     and family_id = v_member.family_id;
  if not found then
    raise exception 'message_not_found';
  end if;

  if v_msg.deleted_at is not null then
    return;
  end if;
  if v_msg.message_type = 'system' then
    raise exception 'cannot_delete_system';
  end if;
  if v_msg.sender_member_id <> p_member_id and not v_member.is_admin then
    raise exception 'not_allowed';
  end if;

  update messages
     set deleted_at = now(),
         deleted_by_member_id = p_member_id
   where id = p_message_id;

  update family_members
     set last_active_at = now()
   where id = p_member_id;
end;
$$;

grant execute on function delete_message(uuid, text, uuid) to anon, authenticated;
