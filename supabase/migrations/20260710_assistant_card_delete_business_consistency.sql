-- Keep assistant-card deletion aligned with schedule permissions and lifecycle.
-- Only a card creator can delete their private confirmation card. Deleting a
-- create-type card also deletes the schedule it created through the canonical
-- schedule RPC; update/cancel cards must never delete the pre-existing item.

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
  v_schedule family_schedule_items%rowtype;
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
  if v_card.created_by_member_id <> v_member.id then
    raise exception 'assistant_card_not_allowed';
  end if;

  if v_card.result_schedule_item_id is not null
     and v_card.card_type in ('reminder', 'schedule', 'todo') then
    select * into v_schedule
      from family_schedule_items s
     where s.id = v_card.result_schedule_item_id
       and s.family_id = v_member.family_id
     for update;

    if found and v_schedule.deleted_at is null then
      perform delete_schedule_item(
        p_member_id,
        p_member_token,
        v_schedule.id,
        'single'
      );
    end if;
  end if;

  update messages
     set deleted_at = now(),
         deleted_by_member_id = v_member.id
   where id in (v_card.card_message_id, v_card.result_message_id)
     and family_id = v_member.family_id
     and deleted_at is null;

  delete from assistant_action_cards where id = v_card.id;

  return jsonb_build_object(
    'card_id', p_card_id,
    'message_id', v_card.card_message_id,
    'result_message_id', v_card.result_message_id,
    'schedule_item_id', v_card.result_schedule_item_id
  );
end;
$$;

grant execute on function delete_assistant_action_card(uuid, text, uuid)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260710_assistant_card_delete_business_consistency',
  'assistant_card_delete_business_consistency',
  'Restricts card deletion to its creator and avoids deleting schedules referenced by update/cancel cards.'
)
on conflict (version) do nothing;
