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
#variable_conflict use_column
declare
  v_msg messages%rowtype;
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
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

  if v_msg.recipient_member_id is not null
     and v_msg.sender_member_id is distinct from p_member_id
     and v_msg.recipient_member_id is distinct from p_member_id then
    raise exception 'message_not_found';
  end if;

  if v_msg.deleted_at is not null then
    return;
  end if;
  if v_msg.message_type = 'system' then
    raise exception 'cannot_delete_system';
  end if;
  if v_msg.recipient_member_id is not null then
    if v_msg.sender_member_id is distinct from p_member_id then
      raise exception 'not_allowed';
    end if;
  elsif v_msg.sender_member_id is distinct from p_member_id and not v_member.is_admin then
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
