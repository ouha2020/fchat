-- Chat assistant confirmation cards.
-- This is an additive layer over messages, schedule items, and important notices.

create or replace function set_messages_business_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if tg_op = 'UPDATE' then
    if row(
      old.family_id,
      old.sender_member_id,
      old.recipient_member_id,
      old.message_type,
      old.content,
      old.image_url,
      old.audio_url,
      old.audio_duration_ms,
      old.latitude,
      old.longitude,
      old.address,
      old.map_url,
      old.effect_id,
      old.effect_caption,
      old.system_event_type,
      old.system_event_payload,
      old.deleted_at,
      old.deleted_by_member_id,
      old.created_at
    ) is not distinct from row(
      new.family_id,
      new.sender_member_id,
      new.recipient_member_id,
      new.message_type,
      new.content,
      new.image_url,
      new.audio_url,
      new.audio_duration_ms,
      new.latitude,
      new.longitude,
      new.address,
      new.map_url,
      new.effect_id,
      new.effect_caption,
      new.system_event_type,
      new.system_event_payload,
      new.deleted_at,
      new.deleted_by_member_id,
      new.created_at
    ) then
      new.updated_at := old.updated_at;
    else
      new.updated_at := now();
    end if;
  end if;

  return new;
end;
$$;

create table if not exists assistant_action_cards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  created_by_member_id uuid not null references family_members(id) on delete cascade,
  card_message_id uuid references messages(id) on delete set null,
  source_message_id uuid references messages(id) on delete set null,
  target_message_id uuid references messages(id) on delete set null,
  card_type text not null,
  status text not null default 'pending',
  title text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  result_schedule_item_id uuid references family_schedule_items(id) on delete set null,
  result_important_notification_id uuid references important_notifications(id) on delete set null,
  result_message_id uuid references messages(id) on delete set null,
  confirmed_at timestamptz,
  confirmed_by_member_id uuid references family_members(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by_member_id uuid references family_members(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '1 day'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_action_cards_type_check
    check (card_type in ('reminder', 'schedule', 'important')),
  constraint assistant_action_cards_status_check
    check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  constraint assistant_action_cards_title_length_check
    check (char_length(trim(title)) between 1 and 80),
  constraint assistant_action_cards_summary_length_check
    check (summary is null or char_length(summary) <= 300)
);

create index if not exists assistant_action_cards_family_created_idx
  on assistant_action_cards (family_id, created_at desc);

create index if not exists assistant_action_cards_family_status_idx
  on assistant_action_cards (family_id, status, created_at desc);

create index if not exists assistant_action_cards_card_message_idx
  on assistant_action_cards (card_message_id)
  where card_message_id is not null;

create index if not exists assistant_action_cards_target_message_idx
  on assistant_action_cards (target_message_id)
  where target_message_id is not null;

alter table assistant_action_cards enable row level security;
revoke all on assistant_action_cards from anon, authenticated;

drop policy if exists "assistant action cards are rpc only" on assistant_action_cards;
create policy "assistant action cards are rpc only"
  on assistant_action_cards for select
  to anon, authenticated
  using (false);

create or replace function touch_assistant_action_card_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_assistant_action_cards on assistant_action_cards;
create trigger trg_touch_assistant_action_cards
before update on assistant_action_cards
for each row
execute function touch_assistant_action_card_updated_at();

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
     and (
       coalesce(c.payload->>'visibility', 'family') = 'family'
       or c.created_by_member_id = v_member.id
       or nullif(c.payload->>'assignee_member_id', '')::uuid = v_member.id
     )
   order by c.created_at desc, c.id desc
   limit 200;
end;
$$;

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
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if coalesce(p_card_type, '') not in ('reminder', 'schedule', 'important') then
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

create or replace function cancel_assistant_action_card(
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
  if v_card.created_by_member_id <> v_member.id then
    raise exception 'assistant_card_not_allowed';
  end if;
  if v_card.status <> 'pending' then
    raise exception 'assistant_card_not_pending';
  end if;

  update assistant_action_cards
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by_member_id = v_member.id
   where id = v_card.id;

  update messages
     set system_event_payload = jsonb_set(
           coalesce(system_event_payload, '{}'::jsonb),
           '{status}',
           to_jsonb('cancelled'::text),
           true
         ),
         system_event_type = 'assistant_card_cancelled'
   where id = v_card.card_message_id;

  return jsonb_build_object(
    'card_id', v_card.id,
    'message_id', v_card.card_message_id,
    'status', 'cancelled'
  );
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

  if v_card.card_type in ('reminder', 'schedule') then
    v_visibility := coalesce(nullif(v_card.payload->>'visibility', ''), 'family');
    v_item_type := coalesce(nullif(v_card.payload->>'item_type', ''), v_card.card_type);
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

grant execute on function list_assistant_action_cards_for_member(uuid, text)
  to anon, authenticated;
grant execute on function create_assistant_action_card(uuid, text, text, text, text, jsonb, uuid, uuid)
  to anon, authenticated;
grant execute on function confirm_assistant_action_card(uuid, text, uuid)
  to anon, authenticated;
grant execute on function cancel_assistant_action_card(uuid, text, uuid)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_assistant_action_cards',
  'assistant_action_cards',
  'Adds Home Assistant confirmation cards over chat messages, schedules, and important notices.'
)
on conflict (version) do nothing;
