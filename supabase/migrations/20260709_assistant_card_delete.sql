-- Delete an assistant action card: soft-delete its chat message and the
-- schedule item it created (if any). Creator or a family admin may delete.

create or replace function delete_assistant_action_card(
  p_member_id uuid,
  p_member_token text,
  p_card_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_card assistant_action_cards%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_card
    from assistant_action_cards c
   where c.id = p_card_id
     and c.family_id = v_member.family_id
   for update;
  if not found then
    raise exception 'assistant_card_not_found';
  end if;
  if v_card.created_by_member_id <> v_member.id and not v_member.is_admin then
    raise exception 'assistant_card_not_allowed';
  end if;

  -- Remove the schedule item this card created (soft delete, same as the
  -- schedule page's own delete).
  if v_card.result_schedule_item_id is not null then
    update family_schedule_items
       set status = 'cancelled',
           deleted_at = now(),
           deleted_by_member_id = v_member.id,
           updated_at = now()
     where id = v_card.result_schedule_item_id
       and family_id = v_member.family_id
       and deleted_at is null;
  end if;

  -- Soft-delete the chat message that shows the card.
  if v_card.card_message_id is not null then
    update messages
       set deleted_at = now(),
           deleted_by_member_id = v_member.id
     where id = v_card.card_message_id
       and family_id = v_member.family_id
       and deleted_at is null;
  end if;

  delete from assistant_action_cards where id = v_card.id;

  return jsonb_build_object(
    'card_id', p_card_id,
    'message_id', v_card.card_message_id,
    'schedule_item_id', v_card.result_schedule_item_id
  );
end;
$$;

grant execute on function delete_assistant_action_card(uuid, text, uuid)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260709_assistant_card_delete',
  'assistant_card_delete',
  'Delete an assistant action card plus its message and schedule item.'
)
on conflict (version) do nothing;
