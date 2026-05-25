-- Schedule detail conversation timeline.
-- Keeps context event visibility recipient-based and lets schedule RPCs
-- write system/member actions into the same timeline.

alter table family_context_events
  drop constraint if exists family_context_events_event_type_check;

alter table family_context_events
  add constraint family_context_events_event_type_check
  check (event_type in (
    'text',
    'audio',
    'location',
    'system',
    'created',
    'updated',
    'assigned',
    'accepted',
    'declined',
    'completed',
    'restored',
    'deleted',
    'reminder_updated'
  ));

create or replace function insert_schedule_context_event(
  p_schedule_item_id uuid,
  p_sender_type text,
  p_sender_member_id uuid,
  p_event_type text,
  p_text_content text default null,
  p_visibility text default null,
  p_recipient_member_id uuid default null,
  p_audio_url text default null,
  p_audio_duration_ms integer default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_location_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_item family_schedule_items%rowtype;
  v_sender family_members%rowtype;
  v_recipient family_members%rowtype;
  v_event_id uuid;
  v_visibility text;
  v_text text;
  v_signal_type text;
begin
  if coalesce(p_sender_type, '') not in ('member', 'keeper', 'system') then
    raise exception 'invalid_schedule_context_sender_type';
  end if;
  if coalesce(p_event_type, '') not in (
    'text',
    'audio',
    'location',
    'system',
    'created',
    'updated',
    'assigned',
    'accepted',
    'declined',
    'completed',
    'restored',
    'deleted',
    'reminder_updated'
  ) then
    raise exception 'invalid_schedule_context_event_type';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.deleted_at is null;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;

  if p_sender_member_id is not null then
    select * into v_sender
      from family_members fm
     where fm.id = p_sender_member_id
       and fm.family_id = v_item.family_id
       and fm.status = 'active'
     limit 1;
    if not found then
      raise exception 'unauthorized';
    end if;
  end if;

  v_visibility := coalesce(
    nullif(trim(coalesce(p_visibility, '')), ''),
    case when v_item.visibility = 'private' then 'private' else 'family' end
  );
  if v_visibility not in ('family', 'private') then
    raise exception 'invalid_schedule_context_visibility';
  end if;

  v_text := nullif(trim(coalesce(p_text_content, '')), '');
  if v_text is not null and length(v_text) > 300 then
    raise exception 'schedule_context_text_too_long';
  end if;
  if p_event_type = 'text' then
    if v_text is null then
      raise exception 'schedule_context_text_required';
    end if;
  elsif p_event_type = 'audio' then
    if nullif(trim(coalesce(p_audio_url, '')), '') is null then
      raise exception 'schedule_context_audio_required';
    end if;
  elsif p_event_type = 'location' then
    if p_latitude is null or p_longitude is null then
      raise exception 'schedule_context_location_required';
    end if;
  end if;

  if p_recipient_member_id is not null then
    select * into v_recipient
      from family_members fm
     where fm.id = p_recipient_member_id
       and fm.family_id = v_item.family_id
       and fm.status = 'active'
     limit 1;
    if not found or not schedule_item_is_visible_to_member(v_item, v_recipient.id) then
      raise exception 'member_not_found';
    end if;
  end if;

  insert into family_context_events (
    family_id,
    target_type,
    target_id,
    schedule_item_id,
    sender_type,
    sender_member_id,
    recipient_member_id,
    event_type,
    visibility,
    text_content,
    audio_url,
    audio_duration_ms,
    latitude,
    longitude,
    location_label
  )
  values (
    v_item.family_id,
    'schedule_item',
    v_item.id,
    v_item.id,
    p_sender_type,
    p_sender_member_id,
    case when v_visibility = 'private' then p_recipient_member_id else null end,
    p_event_type,
    v_visibility,
    v_text,
    nullif(trim(coalesce(p_audio_url, '')), ''),
    p_audio_duration_ms,
    p_latitude,
    p_longitude,
    nullif(trim(coalesce(p_location_label, '')), '')
  )
  returning id into v_event_id;

  if v_visibility = 'private' and p_recipient_member_id is not null then
    if p_sender_member_id is not null then
      insert into family_context_event_recipients (family_id, event_id, member_id)
      values (v_item.family_id, v_event_id, p_sender_member_id)
      on conflict (event_id, member_id) do nothing;
    end if;

    insert into family_context_event_recipients (family_id, event_id, member_id)
    values (v_item.family_id, v_event_id, p_recipient_member_id)
    on conflict (event_id, member_id) do nothing;
  else
    insert into family_context_event_recipients (family_id, event_id, member_id)
    select v_item.family_id, v_event_id, fm.id
      from family_members fm
     where fm.family_id = v_item.family_id
       and fm.status = 'active'
       and schedule_item_is_visible_to_member(v_item, fm.id)
    on conflict (event_id, member_id) do nothing;
  end if;

  v_signal_type := case
    when p_event_type in ('text', 'audio', 'location') then 'commented'
    when p_event_type = 'deleted' then 'deleted'
    when p_event_type = 'reminder_updated' then 'reminder_updated'
    else 'activity_added'
  end;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select v_item.family_id, v_item.id, r.member_id, v_signal_type
    from family_context_event_recipients r
   where r.event_id = v_event_id;

  delete from family_schedule_events
   where created_at < now() - interval '1 day';

  return v_event_id;
end;
$$;

revoke all on function insert_schedule_context_event(
  uuid, text, uuid, text, text, text, uuid, text, integer, double precision, double precision, text
) from public, anon, authenticated;

create or replace function create_schedule_context_event(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_event_type text,
  p_text_content text default null,
  p_visibility text default 'family',
  p_recipient_member_id uuid default null,
  p_audio_url text default null,
  p_audio_duration_ms integer default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_location_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if coalesce(p_event_type, '') not in ('text', 'audio', 'location') then
    raise exception 'invalid_schedule_context_event_type';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.status <> 'cancelled';
  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;

  if p_visibility = 'private' then
    if p_recipient_member_id is null then
      raise exception 'schedule_context_recipient_required';
    end if;
    if p_recipient_member_id = v_member.id then
      raise exception 'cannot_whisper_self';
    end if;
  end if;

  return insert_schedule_context_event(
    v_item.id,
    'member',
    v_member.id,
    p_event_type,
    p_text_content,
    p_visibility,
    p_recipient_member_id,
    p_audio_url,
    p_audio_duration_ms,
    p_latitude,
    p_longitude,
    p_location_label
  );
end;
$$;

grant execute on function create_schedule_context_event(
  uuid, text, uuid, text, text, text, uuid, text, integer, double precision, double precision, text
) to anon, authenticated;

create or replace function list_schedule_context_events_for_member(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns table (
  id uuid,
  family_id uuid,
  schedule_item_id uuid,
  sender_type text,
  sender_member_id uuid,
  sender_nickname text,
  recipient_member_id uuid,
  recipient_nickname text,
  event_type text,
  visibility text,
  text_content text,
  audio_url text,
  audio_duration_ms integer,
  latitude double precision,
  longitude double precision,
  location_label text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null;

  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;

  return query
  select *
    from (
      select e.id,
             e.family_id,
             e.schedule_item_id,
             e.sender_type,
             e.sender_member_id,
             sender.nickname as sender_nickname,
             e.recipient_member_id,
             recipient.nickname as recipient_nickname,
             e.event_type,
             e.visibility,
             e.text_content,
             e.audio_url,
             e.audio_duration_ms,
             e.latitude,
             e.longitude,
             e.location_label,
             e.created_at
        from family_context_events e
        join family_context_event_recipients r
          on r.event_id = e.id
         and r.member_id = v_member.id
        left join family_members sender on sender.id = e.sender_member_id
        left join family_members recipient on recipient.id = e.recipient_member_id
       where e.schedule_item_id = v_item.id
         and e.deleted_at is null
      union all
      select c.id,
             c.family_id,
             c.schedule_item_id,
             'member'::text as sender_type,
             c.member_id as sender_member_id,
             fm.nickname as sender_nickname,
             null::uuid as recipient_member_id,
             null::text as recipient_nickname,
             'text'::text as event_type,
             'family'::text as visibility,
             c.content as text_content,
             null::text as audio_url,
             null::integer as audio_duration_ms,
             null::double precision as latitude,
             null::double precision as longitude,
             null::text as location_label,
             c.created_at
        from family_schedule_comments c
        join family_members fm on fm.id = c.member_id
       where c.schedule_item_id = v_item.id
         and c.deleted_at is null
         and schedule_item_is_visible_to_member(v_item, v_member.id)
    ) timeline
   order by timeline.created_at asc, timeline.id asc
   limit 200;
end;
$$;

grant execute on function list_schedule_context_events_for_member(uuid, text, uuid)
  to anon, authenticated;

create or replace function respond_schedule_assignment(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_response text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_response text;
  v_note text;
  v_activity text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_response := trim(coalesce(p_response, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if v_response not in ('accepted', 'declined') then
    raise exception 'invalid_schedule_response';
  end if;
  if v_note is not null and length(v_note) > 300 then
    raise exception 'schedule_response_note_too_long';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.status = 'active'
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if v_item.assignee_member_id <> v_member.id then
    raise exception 'not_allowed';
  end if;

  update family_schedule_items
     set assignee_response = v_response,
         assignee_responded_at = now(),
         assignee_response_note = case when v_response = 'declined' then v_note else null end,
         updated_at = now()
   where id = v_item.id;

  v_activity := case when v_response = 'accepted' then 'accepted' else 'declined' end;
  perform add_schedule_activity_log(
    v_item.id,
    v_member.id,
    v_activity,
    case
      when v_response = 'accepted' then v_member.nickname || ' accepted the assignment'
      else v_member.nickname || ' declined the assignment'
    end,
    case
      when v_response = 'declined' and v_note is not null then jsonb_build_object('has_note', true)
      else '{}'::jsonb
    end
  );
  perform insert_schedule_context_event(
    v_item.id,
    'member',
    v_member.id,
    v_activity,
    case
      when v_response = 'accepted' then v_member.nickname || ' accepted the assignment'
      when v_note is not null then v_member.nickname || ' declined the assignment: ' || v_note
      else v_member.nickname || ' declined the assignment'
    end,
    null,
    null
  );
end;
$$;

create or replace function create_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_assignee_member_id uuid,
  p_recurrence_rule text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_assignee family_members%rowtype;
  v_title text;
  v_note text;
  v_rule text;
  v_count int;
  v_group_id uuid;
  v_first_id uuid;
  v_id uuid;
  v_index int;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remind_at timestamptz;
  v_duration interval;
  v_reminder_offset interval;
  v_response text;
  v_responded_at timestamptz;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_rule := coalesce(nullif(trim(coalesce(p_recurrence_rule, '')), ''), 'none');

  if length(v_title) = 0 then
    raise exception 'schedule_title_required';
  end if;
  if length(v_title) > 60 then
    raise exception 'schedule_title_too_long';
  end if;
  if coalesce(p_item_type, '') not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_schedule_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;
  if v_rule not in ('none', 'daily', 'weekly', 'monthly') then
    raise exception 'invalid_schedule_recurrence';
  end if;
  if p_starts_at is null then
    raise exception 'invalid_schedule_time';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'invalid_schedule_time';
  end if;

  select * into v_assignee
    from family_members fm
   where fm.id = p_assignee_member_id
     and fm.family_id = v_member.family_id
     and fm.status = 'active'
   limit 1;
  if not found then
    raise exception 'member_not_found';
  end if;

  v_response := case when v_assignee.id = v_member.id then 'accepted' else 'pending' end;
  v_responded_at := case when v_assignee.id = v_member.id then now() else null end;
  v_count := case v_rule
    when 'daily' then 30
    when 'weekly' then 12
    when 'monthly' then 12
    else 1
  end;
  v_group_id := case when v_rule = 'none' then null else gen_random_uuid() end;
  v_duration := case when p_ends_at is null then null else p_ends_at - p_starts_at end;
  v_reminder_offset := case when p_remind_at is null then null else p_starts_at - p_remind_at end;

  for v_index in 0..(v_count - 1) loop
    v_starts_at := case v_rule
      when 'daily' then p_starts_at + (v_index * interval '1 day')
      when 'weekly' then p_starts_at + (v_index * interval '1 week')
      when 'monthly' then p_starts_at + (v_index * interval '1 month')
      else p_starts_at
    end;
    v_ends_at := case when v_duration is null then null else v_starts_at + v_duration end;
    v_remind_at := case when v_reminder_offset is null then null else v_starts_at - v_reminder_offset end;

    insert into family_schedule_items (
      family_id, creator_member_id, assignee_member_id, title, note, item_type,
      visibility, starts_at, ends_at, remind_at,
      recurrence_group_id, recurrence_rule, recurrence_index,
      assignee_response, assignee_responded_at
    )
    values (
      v_member.family_id, v_member.id, v_assignee.id, v_title, v_note,
      p_item_type, p_visibility, v_starts_at, v_ends_at, v_remind_at,
      v_group_id, v_rule, case when v_rule = 'none' then null else v_index end,
      v_response, v_responded_at
    )
    returning id into v_id;

    perform add_schedule_activity_log(
      v_id,
      v_member.id,
      'created',
      v_member.nickname || ' created the schedule',
      '{}'::jsonb
    );
    perform insert_schedule_context_event(
      v_id,
      'keeper',
      null,
      'created',
      'Schedule created by ' || v_member.nickname || ' for ' || v_assignee.nickname,
      null,
      null
    );
    if v_assignee.id <> v_member.id then
      perform add_schedule_activity_log(
        v_id,
        v_member.id,
        'assigned',
        'Assigned to ' || v_assignee.nickname,
        '{}'::jsonb
      );
      perform insert_schedule_context_event(
        v_id,
        'keeper',
        null,
        'assigned',
        'Assigned to ' || v_assignee.nickname,
        null,
        null
      );
    end if;

    if v_index = 0 then
      v_first_id := v_id;
    end if;
  end loop;

  return v_first_id;
end;
$$;

create or replace function create_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_assignee_member_id uuid
)
returns uuid
language sql
security definer
set search_path = public, extensions
as $$
  select create_schedule_item(
    p_member_id, p_member_token, p_title, p_note, p_item_type, p_visibility,
    p_starts_at, p_ends_at, p_remind_at, p_assignee_member_id, 'none'
  );
$$;

create or replace function update_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_item_id uuid,
  p_title text,
  p_note text,
  p_item_type text,
  p_visibility text,
  p_assignee_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_remind_at timestamptz,
  p_recurrence_scope text default 'single'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_assignee family_members%rowtype;
  v_title text;
  v_note text;
  v_scope text;
  v_start_delta interval;
  v_duration interval;
  v_reminder_offset interval;
  v_updated int;
  v_activity text;
  v_summary text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_scope := coalesce(nullif(trim(coalesce(p_recurrence_scope, '')), ''), 'single');

  if length(v_title) = 0 then
    raise exception 'schedule_title_required';
  end if;
  if length(v_title) > 60 then
    raise exception 'schedule_title_too_long';
  end if;
  if coalesce(p_item_type, '') not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_schedule_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_schedule_visibility';
  end if;
  if v_scope not in ('single', 'future', 'all') then
    raise exception 'invalid_schedule_scope';
  end if;
  if p_starts_at is null then
    raise exception 'invalid_schedule_time';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'invalid_schedule_time';
  end if;

  select * into v_assignee
    from family_members fm
   where fm.id = p_assignee_member_id
     and fm.family_id = v_member.family_id
     and fm.status = 'active'
   limit 1;
  if not found then
    raise exception 'member_not_found';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if v_item.status = 'cancelled' then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  if v_item.recurrence_group_id is null then
    v_scope := 'single';
  end if;
  v_start_delta := p_starts_at - v_item.starts_at;
  v_duration := case when p_ends_at is null then null else p_ends_at - p_starts_at end;
  v_reminder_offset := case when p_remind_at is null then null else p_starts_at - p_remind_at end;

  update family_schedule_items s
     set title = v_title,
         note = v_note,
         item_type = p_item_type,
         visibility = p_visibility,
         assignee_member_id = v_assignee.id,
         assignee_response = case
           when s.assignee_member_id is distinct from v_assignee.id then
             case when v_assignee.id = s.creator_member_id then 'accepted' else 'pending' end
           else s.assignee_response
         end,
         assignee_responded_at = case
           when s.assignee_member_id is distinct from v_assignee.id then
             case when v_assignee.id = s.creator_member_id then now() else null end
           else s.assignee_responded_at
         end,
         assignee_response_note = case
           when s.assignee_member_id is distinct from v_assignee.id then null
           else s.assignee_response_note
         end,
         starts_at = case when v_scope = 'single' then p_starts_at else s.starts_at + v_start_delta end,
         ends_at = case
           when p_ends_at is null then null
           when v_scope = 'single' then p_ends_at
           else (s.starts_at + v_start_delta) + v_duration
         end,
         remind_at = case
           when p_remind_at is null then null
           when v_scope = 'single' then p_remind_at
           else (s.starts_at + v_start_delta) - v_reminder_offset
         end,
         reminded_at = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminded_at
         end,
         reminder_push_attempted_at = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminder_push_attempted_at
         end,
         reminder_push_error = case
           when s.remind_at is distinct from (
             case
               when p_remind_at is null then null
               when v_scope = 'single' then p_remind_at
               else (s.starts_at + v_start_delta) - v_reminder_offset
             end
           ) then null
           else s.reminder_push_error
         end,
         updated_at = now()
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       (v_scope = 'single' and s.id = v_item.id)
       or (
         v_scope = 'future'
         and s.recurrence_group_id = v_item.recurrence_group_id
         and s.starts_at >= v_item.starts_at
       )
       or (
         v_scope = 'all'
         and s.recurrence_group_id = v_item.recurrence_group_id
       )
     )
     and (
       s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
       or (s.visibility = 'family' and v_member.is_admin)
     );

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'not_allowed';
  end if;

  if v_item.assignee_member_id is distinct from v_assignee.id then
    v_activity := 'assigned';
    v_summary := 'Assigned to ' || v_assignee.nickname;
  elsif v_item.visibility is distinct from p_visibility then
    v_activity := 'updated';
    v_summary := v_member.nickname || ' changed visibility';
  elsif v_item.remind_at is distinct from p_remind_at then
    v_activity := 'reminder_updated';
    v_summary := v_member.nickname || ' changed the reminder';
  else
    v_activity := 'updated';
    v_summary := v_member.nickname || ' updated the schedule';
  end if;

  perform add_schedule_activity_log(v_item.id, v_member.id, v_activity, v_summary, '{}'::jsonb);
  perform insert_schedule_context_event(v_item.id, 'member', v_member.id, v_activity, v_summary, null, null);
end;
$$;

create or replace function set_schedule_item_status(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_activity text;
  v_summary text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_status not in ('active', 'done') then
    raise exception 'invalid_schedule_status';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   for update;
  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
  ) then
    raise exception 'not_allowed';
  end if;

  update family_schedule_items
     set status = p_status,
         completed_at = case when p_status = 'done' then now() else null end,
         completed_by_member_id = case when p_status = 'done' then v_member.id else null end,
         updated_at = now()
   where id = v_item.id;

  v_activity := case when p_status = 'done' then 'completed' else 'restored' end;
  v_summary := case
    when p_status = 'done' then v_member.nickname || ' completed the schedule'
    else v_member.nickname || ' restored the schedule'
  end;
  perform add_schedule_activity_log(v_item.id, v_member.id, v_activity, v_summary, '{}'::jsonb);
  perform insert_schedule_context_event(v_item.id, 'member', v_member.id, v_activity, v_summary, null, null);
end;
$$;

create or replace function delete_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_recurrence_scope text default 'single'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_scope text;
  v_deleted int;
  v_summary text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_scope := coalesce(nullif(trim(coalesce(p_recurrence_scope, '')), ''), 'single');
  if v_scope not in ('single', 'future', 'all') then
    raise exception 'invalid_schedule_scope';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if not (
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  if v_item.recurrence_group_id is null then
    v_scope := 'single';
  end if;

  update family_schedule_items s
     set status = 'cancelled',
         deleted_at = now(),
         deleted_by_member_id = v_member.id,
         updated_at = now()
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       (v_scope = 'single' and s.id = v_item.id)
       or (
         v_scope = 'future'
         and s.recurrence_group_id = v_item.recurrence_group_id
         and s.starts_at >= v_item.starts_at
       )
       or (
         v_scope = 'all'
         and s.recurrence_group_id = v_item.recurrence_group_id
       )
     )
     and (
       s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
       or (s.visibility = 'family' and v_member.is_admin)
     );

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'not_allowed';
  end if;

  v_summary := v_member.nickname || ' deleted the schedule';
  perform add_schedule_activity_log(v_item.id, v_member.id, 'deleted', v_summary, '{}'::jsonb);
  perform insert_schedule_context_event(v_item.id, 'member', v_member.id, 'deleted', v_summary, null, null);
end;
$$;

create or replace function delete_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  select delete_schedule_item(
    p_member_id, p_member_token, p_schedule_item_id, 'single'
  );
$$;

grant execute on function respond_schedule_assignment(uuid, text, uuid, text, text)
  to anon, authenticated;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid)
  to anon, authenticated;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, text)
  to anon, authenticated;
grant execute on function update_schedule_item(uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz, timestamptz, text)
  to anon, authenticated;
grant execute on function set_schedule_item_status(uuid, text, uuid, text)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid, text)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_schedule_context_timeline',
  'schedule_context_timeline',
  'Turns schedule detail collaboration into a recipient-filtered conversation timeline.'
)
on conflict (version) do nothing;
