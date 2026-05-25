-- Schedule context conversation events with recipient-level visibility.

create table if not exists family_context_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  target_type text not null default 'schedule_item',
  target_id uuid not null,
  schedule_item_id uuid references family_schedule_items(id) on delete cascade,
  sender_type text not null default 'member',
  sender_member_id uuid references family_members(id) on delete set null,
  recipient_member_id uuid references family_members(id) on delete set null,
  event_type text not null,
  visibility text not null,
  text_content text,
  audio_url text,
  audio_duration_ms integer,
  latitude double precision,
  longitude double precision,
  location_label text,
  deleted_at timestamptz,
  deleted_by_member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_context_events_target_type_check
    check (target_type in ('schedule_item', 'keeper_request')),
  constraint family_context_events_sender_type_check
    check (sender_type in ('member', 'keeper', 'system')),
  constraint family_context_events_event_type_check
    check (event_type in ('text', 'audio', 'location', 'system')),
  constraint family_context_events_visibility_check
    check (visibility in ('family', 'private')),
  constraint family_context_events_text_length_check
    check (text_content is null or char_length(trim(text_content)) between 1 and 300),
  constraint family_context_events_audio_duration_check
    check (audio_duration_ms is null or audio_duration_ms >= 0),
  constraint family_context_events_latitude_check
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint family_context_events_longitude_check
    check (longitude is null or (longitude >= -180 and longitude <= 180))
);

create table if not exists family_context_event_recipients (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  event_id uuid not null references family_context_events(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, member_id)
);

create index if not exists family_context_events_schedule_created_idx
  on family_context_events (schedule_item_id, created_at asc)
  where schedule_item_id is not null and deleted_at is null;

create index if not exists family_context_events_family_created_idx
  on family_context_events (family_id, created_at desc);

create index if not exists family_context_event_recipients_member_created_idx
  on family_context_event_recipients (member_id, created_at desc);

create index if not exists family_context_event_recipients_event_member_idx
  on family_context_event_recipients (event_id, member_id);

alter table family_context_events enable row level security;
alter table family_context_event_recipients enable row level security;
revoke all on family_context_events from anon, authenticated;
revoke all on family_context_event_recipients from anon, authenticated;

drop policy if exists "family context events are rpc only" on family_context_events;
create policy "family context events are rpc only"
  on family_context_events for select
  to anon, authenticated
  using (false);

drop policy if exists "family context event recipients are rpc only" on family_context_event_recipients;
create policy "family context event recipients are rpc only"
  on family_context_event_recipients for select
  to anon, authenticated
  using (false);

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
  v_recipient family_members%rowtype;
  v_text text;
  v_event_id uuid;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if coalesce(p_event_type, '') not in ('text', 'audio', 'location') then
    raise exception 'invalid_schedule_context_event_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_schedule_context_visibility';
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

  v_text := nullif(trim(coalesce(p_text_content, '')), '');
  if p_event_type = 'text' then
    if v_text is null then
      raise exception 'schedule_context_text_required';
    end if;
    if length(v_text) > 300 then
      raise exception 'schedule_context_text_too_long';
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

  if p_visibility = 'private' then
    if p_recipient_member_id is null then
      raise exception 'schedule_context_recipient_required';
    end if;
    if p_recipient_member_id = v_member.id then
      raise exception 'cannot_whisper_self';
    end if;

    select * into v_recipient
      from family_members fm
     where fm.id = p_recipient_member_id
       and fm.family_id = v_member.family_id
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
    v_member.family_id,
    'schedule_item',
    v_item.id,
    v_item.id,
    'member',
    v_member.id,
    case when p_visibility = 'private' then p_recipient_member_id else null end,
    p_event_type,
    p_visibility,
    v_text,
    nullif(trim(coalesce(p_audio_url, '')), ''),
    p_audio_duration_ms,
    p_latitude,
    p_longitude,
    nullif(trim(coalesce(p_location_label, '')), '')
  )
  returning id into v_event_id;

  if p_visibility = 'private' then
    insert into family_context_event_recipients (family_id, event_id, member_id)
    values
      (v_member.family_id, v_event_id, v_member.id),
      (v_member.family_id, v_event_id, p_recipient_member_id)
    on conflict (event_id, member_id) do nothing;
  else
    insert into family_context_event_recipients (family_id, event_id, member_id)
    select v_member.family_id, v_event_id, fm.id
      from family_members fm
     where fm.family_id = v_member.family_id
       and fm.status = 'active'
       and schedule_item_is_visible_to_member(v_item, fm.id)
    on conflict (event_id, member_id) do nothing;
  end if;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select v_member.family_id, v_item.id, r.member_id, 'commented'
    from family_context_event_recipients r
   where r.event_id = v_event_id;

  delete from family_schedule_events
   where created_at < now() - interval '1 day';

  return v_event_id;
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
   order by e.created_at asc, e.id asc
   limit 200;
end;
$$;

grant execute on function list_schedule_context_events_for_member(uuid, text, uuid)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_schedule_context_events',
  'schedule_context_events',
  'Adds schedule context conversation events with recipient visibility.'
)
on conflict (version) do nothing;
