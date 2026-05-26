-- Keep assistant confirmation cards visible only to the member who created them.
-- Confirmed actions still create a separate result message for the intended recipients.

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
    v_member.id,
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

grant execute on function create_assistant_action_card(uuid, text, text, text, text, jsonb, uuid, uuid)
  to anon, authenticated;

create or replace function list_assistant_action_cards_for_member(
  p_member_id uuid,
  p_member_token text
)
returns table (
  id uuid,
  family_id uuid,
  created_by_member_id uuid,
  card_message_id uuid,
  source_message_id uuid,
  target_message_id uuid,
  card_type text,
  status text,
  title text,
  summary text,
  payload jsonb,
  result_schedule_item_id uuid,
  result_important_notification_id uuid,
  result_message_id uuid,
  confirmed_at timestamptz,
  confirmed_by_member_id uuid,
  cancelled_at timestamptz,
  cancelled_by_member_id uuid,
  expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
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
  select c.id, c.family_id, c.created_by_member_id, c.card_message_id,
         c.source_message_id, c.target_message_id, c.card_type, c.status,
         c.title, c.summary, c.payload, c.result_schedule_item_id,
         c.result_important_notification_id, c.result_message_id,
         c.confirmed_at, c.confirmed_by_member_id,
         c.cancelled_at, c.cancelled_by_member_id,
         c.expires_at, c.created_at, c.updated_at
    from assistant_action_cards c
   where c.family_id = v_member.family_id
     and c.created_by_member_id = v_member.id
   order by c.created_at desc, c.id desc
   limit 200;
end;
$$;

grant execute on function list_assistant_action_cards_for_member(uuid, text)
  to anon, authenticated;

update messages m
   set recipient_member_id = c.created_by_member_id
  from assistant_action_cards c
 where c.card_message_id = m.id
   and m.system_event_type in (
     'assistant_card_created',
     'assistant_card_confirmed',
     'assistant_card_cancelled'
   );

delete from message_recipients mr
using assistant_action_cards c
where c.card_message_id = mr.message_id
  and mr.member_id <> c.created_by_member_id;

insert into message_recipients (family_id, message_id, member_id, created_at)
select c.family_id, c.card_message_id, c.created_by_member_id, m.created_at
  from assistant_action_cards c
  join messages m on m.id = c.card_message_id
 where c.card_message_id is not null
on conflict (message_id, member_id) do nothing;

insert into app_schema_migrations (version, name, description)
values (
  '20260526_assistant_card_creator_visibility',
  'assistant_card_creator_visibility',
  'Keeps assistant confirmation cards visible only to the creator; confirmed actions still notify intended recipients.'
)
on conflict (version) do nothing;
