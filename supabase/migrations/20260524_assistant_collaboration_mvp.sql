-- Assistant collaboration MVP: task cards, schedule edits, and important read state.

alter table assistant_action_cards
  drop constraint if exists assistant_action_cards_type_check;

alter table assistant_action_cards
  add constraint assistant_action_cards_type_check
  check (card_type in (
    'reminder',
    'schedule',
    'important',
    'todo',
    'schedule_update',
    'schedule_cancel'
  ));

create or replace function create_assistant_action_card(
  p_member_id uuid,
  p_member_token text,
  p_card_type text,
  p_title text,
  p_summary text,
  p_payload jsonb default '{}'::jsonb,
  p_source_message_id uuid default null,
  p_target_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_title text;
  v_summary text;
  v_payload jsonb;
  v_card_id uuid;
  v_message_id uuid;
  v_recipient_member_id uuid;
  v_visibility text;
  v_assignee_id uuid;
  v_source_visible boolean;
  v_target messages%rowtype;
  v_schedule_id uuid;
  v_schedule family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if coalesce(p_card_type, '') not in (
    'reminder', 'schedule', 'important', 'todo', 'schedule_update', 'schedule_cancel'
  ) then
    raise exception 'invalid_assistant_card_type';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_summary := nullif(trim(coalesce(p_summary, '')), '');
  v_payload := coalesce(p_payload, '{}'::jsonb);
  v_visibility := coalesce(nullif(v_payload->>'visibility', ''), 'family');

  if length(v_title) = 0 then
    raise exception 'assistant_card_title_required';
  end if;
  if length(v_title) > 80 then
    raise exception 'assistant_card_title_too_long';
  end if;
  if v_summary is not null and length(v_summary) > 300 then
    raise exception 'assistant_card_summary_too_long';
  end if;
  if v_visibility not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;

  if p_source_message_id is not null then
    select exists (
      select 1
        from message_recipients mr
       where mr.family_id = v_member.family_id
         and mr.member_id = v_member.id
         and mr.message_id = p_source_message_id
    ) into v_source_visible;
    if not v_source_visible then
      raise exception 'message_not_found';
    end if;
  end if;

  if p_card_type = 'important' then
    if p_target_message_id is null then
      raise exception 'assistant_target_required';
    end if;

    select m.* into v_target
      from message_recipients mr
      join messages m on m.id = mr.message_id and m.family_id = mr.family_id
     where mr.family_id = v_member.family_id
       and mr.member_id = v_member.id
       and mr.message_id = p_target_message_id
     limit 1;
    if not found then
      raise exception 'message_not_found';
    end if;
    if v_target.recipient_member_id is not null or v_target.message_type = 'system' or v_target.deleted_at is not null then
      raise exception 'assistant_target_not_allowed';
    end if;
  end if;

  if p_card_type in ('schedule_update', 'schedule_cancel') then
    v_schedule_id := nullif(v_payload->>'schedule_item_id', '')::uuid;
    if v_schedule_id is null then
      raise exception 'schedule_item_not_found';
    end if;

    select * into v_schedule
      from family_schedule_items s
     where s.id = v_schedule_id
       and s.family_id = v_member.family_id
       and s.deleted_at is null
       and s.status = 'active'
     limit 1;
    if not found or not schedule_item_is_visible_to_member(v_schedule, v_member.id) then
      raise exception 'schedule_item_not_found';
    end if;
  end if;

  v_assignee_id := nullif(v_payload->>'assignee_member_id', '')::uuid;
  if v_assignee_id is not null then
    if not exists (
      select 1 from family_members fm
       where fm.id = v_assignee_id
         and fm.family_id = v_member.family_id
         and fm.status = 'active'
    ) then
      raise exception 'member_not_found';
    end if;
  end if;

  if v_visibility = 'private' then
    v_recipient_member_id := coalesce(v_assignee_id, v_member.id);
  end if;

  insert into assistant_action_cards (
    family_id, created_by_member_id, source_message_id, target_message_id,
    card_type, status, title, summary, payload
  )
  values (
    v_member.family_id, v_member.id, p_source_message_id, p_target_message_id,
    p_card_type, 'pending', v_title, v_summary, v_payload
  )
  returning id into v_card_id;

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, system_event_type, system_event_payload
  )
  values (
    v_member.family_id,
    v_member.id,
    v_recipient_member_id,
    'system',
    'Home Assistant confirmation card',
    'assistant_card_created',
    jsonb_build_object(
      'actor_type', 'assistant',
      'card_id', v_card_id,
      'card_type', p_card_type,
      'status', 'pending'
    )
  )
  returning id into v_message_id;

  update assistant_action_cards
     set card_message_id = v_message_id
   where id = v_card_id;

  update family_members
     set last_active_at = now()
   where id = v_member.id;

  return jsonb_build_object('card_id', v_card_id, 'message_id', v_message_id);
end;
$$;

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

  if coalesce(v_card.payload->>'visibility', 'family') = 'private' then
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

create or replace function get_important_notification_read_state(
  p_member_id uuid,
  p_member_token text,
  p_notification_id uuid
)
returns table (
  notification_id uuid,
  member_id uuid,
  nickname text,
  role text,
  delivered_at timestamptz,
  read_at timestamptz,
  is_read boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_notification important_notifications%rowtype;
  v_message messages%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_notification
    from important_notifications n
   where n.id = p_notification_id
     and n.family_id = v_member.family_id
     and n.removed_at is null
   limit 1;
  if not found then
    raise exception 'important_notification_not_found';
  end if;

  select * into v_message
    from messages m
   where m.id = v_notification.message_id
     and m.family_id = v_member.family_id
   limit 1;
  if not found then
    raise exception 'message_not_found';
  end if;
  if v_message.recipient_member_id is not null then
    raise exception 'private_message_not_allowed';
  end if;

  if not exists (
    select 1
      from message_recipients mr
     where mr.family_id = v_member.family_id
       and mr.message_id = v_message.id
       and mr.member_id = v_member.id
  ) then
    raise exception 'message_not_found';
  end if;

  return query
  select v_notification.id,
         fm.id,
         fm.nickname,
         fm.role,
         mr.delivered_at,
         mr.read_at,
         (mr.read_at is not null)
    from message_recipients mr
    join family_members fm
      on fm.id = mr.member_id
     and fm.family_id = mr.family_id
   where mr.family_id = v_member.family_id
     and mr.message_id = v_message.id
     and fm.status = 'active'
   order by
     case when mr.read_at is null then 1 else 0 end,
     coalesce(mr.read_at, mr.delivered_at, mr.created_at) asc,
     fm.nickname asc,
     fm.id asc;
end;
$$;

grant execute on function create_assistant_action_card(uuid, text, text, text, text, jsonb, uuid, uuid)
  to anon, authenticated;
grant execute on function confirm_assistant_action_card(uuid, text, uuid)
  to anon, authenticated;
grant execute on function get_important_notification_read_state(uuid, text, uuid)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_assistant_collaboration_mvp',
  'assistant_collaboration_mvp',
  'Extends assistant cards for lightweight family collaboration and important read state.'
)
on conflict (version) do nothing;
