-- Backfill schedule collaboration history into the schedule context timeline.

alter table family_context_events
  add column if not exists source_table text,
  add column if not exists source_id uuid;

create unique index if not exists family_context_events_source_uidx
  on family_context_events (source_table, source_id)
  where source_table is not null and source_id is not null;

create index if not exists family_context_events_source_idx
  on family_context_events (source_table, source_id);

with inserted as (
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
    source_table,
    source_id,
    created_at,
    updated_at
  )
  select
    c.family_id,
    'schedule_item',
    c.schedule_item_id,
    c.schedule_item_id,
    'member',
    c.member_id,
    null,
    'text',
    'family',
    c.content,
    'family_schedule_comments',
    c.id,
    c.created_at,
    coalesce(c.updated_at, c.created_at)
  from family_schedule_comments c
  join family_schedule_items s on s.id = c.schedule_item_id
  where c.deleted_at is null
    and s.deleted_at is null
  on conflict do nothing
  returning id, family_id, schedule_item_id
)
insert into family_context_event_recipients (family_id, event_id, member_id)
select inserted.family_id, inserted.id, fm.id
from inserted
join family_schedule_items s on s.id = inserted.schedule_item_id
join family_members fm on fm.family_id = inserted.family_id
where fm.status = 'active'
  and schedule_item_is_visible_to_member(s, fm.id)
on conflict (event_id, member_id) do nothing;

with inserted as (
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
    source_table,
    source_id,
    created_at,
    updated_at
  )
  select
    a.family_id,
    'schedule_item',
    a.schedule_item_id,
    a.schedule_item_id,
    case when a.actor_member_id is null then 'keeper' else 'member' end,
    a.actor_member_id,
    null,
    case
      when a.activity_type in ('created', 'assigned', 'accepted', 'declined', 'completed', 'restored', 'deleted') then a.activity_type
      when a.activity_type in ('reminder_updated', 'reminder_changed') then 'reminder_updated'
      else 'updated'
    end,
    case when s.visibility = 'private' then 'private' else 'family' end,
    nullif(trim(coalesce(a.summary, '')), ''),
    'family_schedule_activity_logs',
    a.id,
    a.created_at,
    a.created_at
  from family_schedule_activity_logs a
  join family_schedule_items s on s.id = a.schedule_item_id
  where s.deleted_at is null
  on conflict do nothing
  returning id, family_id, schedule_item_id
)
insert into family_context_event_recipients (family_id, event_id, member_id)
select inserted.family_id, inserted.id, fm.id
from inserted
join family_schedule_items s on s.id = inserted.schedule_item_id
join family_members fm on fm.family_id = inserted.family_id
where fm.status = 'active'
  and schedule_item_is_visible_to_member(s, fm.id)
on conflict (event_id, member_id) do nothing;

with inserted as (
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
    source_table,
    source_id,
    created_at,
    updated_at
  )
  select
    s.family_id,
    'schedule_item',
    s.id,
    s.id,
    'keeper',
    null,
    null,
    'created',
    case when s.visibility = 'private' then 'private' else 'family' end,
    '日程已安排' ||
      case when assignee.nickname is not null then '给' || assignee.nickname else '' end,
    'family_schedule_items',
    s.id,
    s.created_at,
    s.created_at
  from family_schedule_items s
  left join family_members assignee on assignee.id = s.assignee_member_id
  where s.deleted_at is null
    and not exists (
      select 1
      from family_context_events e
      where e.schedule_item_id = s.id
        and e.deleted_at is null
    )
  on conflict do nothing
  returning id, family_id, schedule_item_id
)
insert into family_context_event_recipients (family_id, event_id, member_id)
select inserted.family_id, inserted.id, fm.id
from inserted
join family_schedule_items s on s.id = inserted.schedule_item_id
join family_members fm on fm.family_id = inserted.family_id
where fm.status = 'active'
  and schedule_item_is_visible_to_member(s, fm.id)
on conflict (event_id, member_id) do nothing;

insert into family_context_event_recipients (family_id, event_id, member_id)
select e.family_id, e.id, fm.id
from family_context_events e
join family_schedule_items s on s.id = e.schedule_item_id
join family_members fm on fm.family_id = e.family_id
where e.deleted_at is null
  and e.source_table in (
    'family_schedule_comments',
    'family_schedule_activity_logs',
    'family_schedule_items'
  )
  and fm.status = 'active'
  and schedule_item_is_visible_to_member(s, fm.id)
on conflict (event_id, member_id) do nothing;

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
         and not exists (
           select 1
             from family_context_events existing
            where existing.source_table = 'family_schedule_comments'
              and existing.source_id = c.id
         )
    ) timeline
   order by timeline.created_at asc, timeline.id asc
   limit 200;
end;
$$;

grant execute on function list_schedule_context_events_for_member(uuid, text, uuid)
  to anon, authenticated;

create or replace function delete_schedule_context_event(
  p_member_id uuid,
  p_member_token text,
  p_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_event family_context_events%rowtype;
  v_item family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_event
    from family_context_events e
   where e.id = p_event_id
     and e.deleted_at is null
   limit 1;
  if not found then
    raise exception 'schedule_context_event_not_found';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = v_event.schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
   limit 1;
  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_context_event_not_found';
  end if;

  if v_event.sender_member_id is distinct from v_member.id then
    raise exception 'unauthorized';
  end if;
  if v_event.event_type not in ('text', 'audio', 'location') then
    raise exception 'schedule_context_event_not_deletable';
  end if;

  update family_context_events
     set deleted_at = now(),
         deleted_by_member_id = v_member.id,
         updated_at = now()
   where id = v_event.id;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select v_event.family_id, v_event.schedule_item_id, r.member_id, 'comment_deleted'
    from family_context_event_recipients r
   where r.event_id = v_event.id;
end;
$$;

grant execute on function delete_schedule_context_event(uuid, text, uuid)
  to anon, authenticated;

insert into app_schema_migrations(version, name)
values (
  '20260524_schedule_context_chat_backfill',
  'schedule_context_chat_backfill'
)
on conflict (version) do nothing;
