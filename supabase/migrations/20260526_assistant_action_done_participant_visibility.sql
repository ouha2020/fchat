-- Send assistant schedule result messages only to the members participating in
-- the schedule action: the creator and the assignee.

create or replace function confirm_assistant_action_card(
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
  v_assignee_id uuid;
  v_visibility text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remind_at timestamptz;
  v_item_type text;
  v_schedule_item_id uuid;
  v_notification_id uuid;
  v_done_message_id uuid;
  v_done_recipient_member_id uuid;
  v_existing_item family_schedule_items%rowtype;
  v_note text;
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
  if v_card.expires_at <= now() then
    update assistant_action_cards
       set status = 'expired'
     where id = v_card.id;
    raise exception 'assistant_card_expired';
  end if;

  if v_card.card_type in ('reminder', 'schedule', 'todo') then
    v_visibility := coalesce(nullif(v_card.payload->>'visibility', ''), 'family');
    v_item_type := case
      when v_card.card_type = 'todo' then 'todo'
      else coalesce(nullif(v_card.payload->>'item_type', ''), v_card.card_type)
    end;
    v_assignee_id := coalesce(nullif(v_card.payload->>'assignee_member_id', '')::uuid, v_member.id);
    v_starts_at := nullif(v_card.payload->>'starts_at', '')::timestamptz;
    v_ends_at := nullif(v_card.payload->>'ends_at', '')::timestamptz;
    v_remind_at := nullif(v_card.payload->>'remind_at', '')::timestamptz;

    if v_starts_at is null then
      raise exception 'invalid_schedule_time';
    end if;

    v_schedule_item_id := create_schedule_item(
      p_member_id,
      p_member_token,
      v_card.title,
      v_card.summary,
      v_item_type,
      v_visibility,
      v_starts_at,
      v_ends_at,
      coalesce(v_remind_at, case when v_card.card_type = 'reminder' then v_starts_at else null end),
      v_assignee_id,
      'none'
    );

    if v_card.card_type = 'reminder' or v_remind_at is not null then
      perform set_schedule_reminder_rules(
        p_member_id,
        p_member_token,
        v_schedule_item_id,
        array[0]::int[],
        'single'
      );
    end if;
  elsif v_card.card_type = 'schedule_update' then
    v_schedule_item_id := nullif(v_card.payload->>'schedule_item_id', '')::uuid;
    if v_schedule_item_id is null then
      raise exception 'schedule_item_not_found';
    end if;

    select * into v_existing_item
      from family_schedule_items s
     where s.id = v_schedule_item_id
       and s.family_id = v_member.family_id
       and s.deleted_at is null
     for update;
    if not found or not schedule_item_is_visible_to_member(v_existing_item, v_member.id) then
      raise exception 'schedule_item_not_found';
    end if;

    v_starts_at := coalesce(
      nullif(v_card.payload->>'starts_at', '')::timestamptz,
      v_existing_item.starts_at
    );
    v_ends_at := case
      when v_card.payload ? 'ends_at' then nullif(v_card.payload->>'ends_at', '')::timestamptz
      else v_existing_item.ends_at
    end;
    v_remind_at := case
      when v_card.payload ? 'remind_at' then nullif(v_card.payload->>'remind_at', '')::timestamptz
      else v_existing_item.remind_at
    end;
    v_assignee_id := coalesce(
      nullif(v_card.payload->>'assignee_member_id', '')::uuid,
      v_existing_item.assignee_member_id
    );
    v_visibility := coalesce(
      nullif(v_card.payload->>'visibility', ''),
      v_existing_item.visibility
    );
    v_item_type := coalesce(
      nullif(v_card.payload->>'item_type', ''),
      v_existing_item.item_type
    );
    v_note := case
      when v_card.payload ? 'note' then nullif(v_card.payload->>'note', '')
      else v_existing_item.note
    end;

    perform update_schedule_item(
      p_member_id,
      p_member_token,
      v_schedule_item_id,
      coalesce(nullif(v_card.payload->>'title', ''), v_existing_item.title),
      v_note,
      v_item_type,
      v_visibility,
      v_assignee_id,
      v_starts_at,
      v_ends_at,
      v_remind_at,
      'single'
    );
  elsif v_card.card_type = 'schedule_cancel' then
    v_schedule_item_id := nullif(v_card.payload->>'schedule_item_id', '')::uuid;
    if v_schedule_item_id is null then
      raise exception 'schedule_item_not_found';
    end if;

    select * into v_existing_item
      from family_schedule_items s
     where s.id = v_schedule_item_id
       and s.family_id = v_member.family_id
       and s.deleted_at is null
     for update;
    if not found or not schedule_item_is_visible_to_member(v_existing_item, v_member.id) then
      raise exception 'schedule_item_not_found';
    end if;
    v_assignee_id := v_existing_item.assignee_member_id;

    perform delete_schedule_item(
      p_member_id,
      p_member_token,
      v_schedule_item_id,
      'single'
    );
  elsif v_card.card_type = 'important' then
    v_notification_id := add_important_notification(
      p_member_id,
      p_member_token,
      v_card.target_message_id
    );
  end if;

  update assistant_action_cards
     set status = 'confirmed',
         confirmed_at = now(),
         confirmed_by_member_id = v_member.id,
         result_schedule_item_id = v_schedule_item_id,
         result_important_notification_id = v_notification_id
   where id = v_card.id;

  update messages
     set system_event_payload =
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 coalesce(system_event_payload, '{}'::jsonb),
                 '{status}',
                 to_jsonb('confirmed'::text),
                 true
               ),
               '{result_schedule_item_id}',
               coalesce(to_jsonb(v_schedule_item_id), 'null'::jsonb),
               true
             ),
             '{result_important_notification_id}',
             coalesce(to_jsonb(v_notification_id), 'null'::jsonb),
             true
           ),
         system_event_type = 'assistant_card_confirmed'
   where id = v_card.card_message_id;

  if v_schedule_item_id is not null then
    v_done_recipient_member_id := coalesce(v_assignee_id, v_member.id);
  elsif coalesce(v_card.payload->>'visibility', 'family') = 'private' then
    v_done_recipient_member_id := coalesce(
      nullif(v_card.payload->>'assignee_member_id', '')::uuid,
      v_member.id
    );
  end if;

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, system_event_type, system_event_payload
  )
  values (
    v_member.family_id,
    v_member.id,
    v_done_recipient_member_id,
    'system',
    'Home Assistant action done',
    'assistant_action_done',
    jsonb_build_object(
      'actor_type', 'assistant',
      'card_id', v_card.id,
      'card_type', v_card.card_type,
      'schedule_item_id', v_schedule_item_id,
      'important_notification_id', v_notification_id
    )
  )
  returning id into v_done_message_id;

  update assistant_action_cards
     set result_message_id = v_done_message_id
   where id = v_card.id;

  return jsonb_build_object(
    'card_id', v_card.id,
    'message_id', v_card.card_message_id,
    'result_message_id', v_done_message_id,
    'schedule_item_id', v_schedule_item_id,
    'important_notification_id', v_notification_id,
    'status', 'confirmed'
  );
end;
$$;

grant execute on function confirm_assistant_action_card(uuid, text, uuid)
  to anon, authenticated;

update messages m
   set recipient_member_id = coalesce(s.assignee_member_id, c.created_by_member_id)
  from assistant_action_cards c
  left join family_schedule_items s
    on s.id = c.result_schedule_item_id
   and s.family_id = c.family_id
 where m.id = c.result_message_id
   and c.result_schedule_item_id is not null
   and m.system_event_type = 'assistant_action_done';

delete from message_recipients mr
using assistant_action_cards c
left join family_schedule_items s
  on s.id = c.result_schedule_item_id
 and s.family_id = c.family_id
where mr.message_id = c.result_message_id
  and c.result_schedule_item_id is not null
  and mr.member_id not in (
    c.created_by_member_id,
    coalesce(s.assignee_member_id, c.created_by_member_id)
  );

insert into message_recipients (family_id, message_id, member_id, created_at)
select distinct c.family_id,
       c.result_message_id,
       participant.member_id,
       m.created_at
  from assistant_action_cards c
  join messages m on m.id = c.result_message_id
  left join family_schedule_items s
    on s.id = c.result_schedule_item_id
   and s.family_id = c.family_id
  cross join lateral (
    values
      (c.created_by_member_id),
      (coalesce(s.assignee_member_id, c.created_by_member_id))
  ) as participant(member_id)
 where c.result_schedule_item_id is not null
   and c.result_message_id is not null
   and participant.member_id is not null
on conflict (message_id, member_id) do nothing;

insert into app_schema_migrations (version, name, description)
values (
  '20260526_assistant_action_done_participant_visibility',
  'assistant_action_done_participant_visibility',
  'Scopes assistant schedule result messages to the creator and assignee participants.'
)
on conflict (version) do nothing;
