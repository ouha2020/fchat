-- Let the creator edit a pending assistant action card (title + time) in place,
-- so the card's "修改 / Edit" button works instead of forcing cancel + resend.

create or replace function update_assistant_action_card(
  p_member_id uuid,
  p_member_token text,
  p_card_id uuid,
  p_title text,
  p_starts_at timestamptz
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
  v_title text;
  v_payload jsonb;
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
  if v_card.status <> 'pending' then
    raise exception 'assistant_card_not_pending';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then
    raise exception 'assistant_card_title_required';
  end if;
  if char_length(v_title) > 80 then
    raise exception 'assistant_card_title_too_long';
  end if;

  v_payload := coalesce(v_card.payload, '{}'::jsonb);
  if p_starts_at is not null then
    v_payload := jsonb_set(v_payload, '{starts_at}', to_jsonb(p_starts_at), true);
    if v_card.card_type = 'reminder' then
      v_payload := jsonb_set(v_payload, '{remind_at}', to_jsonb(p_starts_at), true);
    end if;
  end if;

  update assistant_action_cards
     set title = v_title,
         payload = v_payload,
         updated_at = now()
   where id = v_card.id;

  return jsonb_build_object(
    'card_id', v_card.id,
    'message_id', v_card.card_message_id,
    'status', v_card.status
  );
end;
$$;

grant execute on function update_assistant_action_card(uuid, text, uuid, text, timestamptz)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260709_assistant_card_edit',
  'assistant_card_edit',
  'Edit a pending assistant action card (title + time) in place.'
)
on conflict (version) do nothing;
