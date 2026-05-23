-- Family schedule stage 9: collaboration comments, assignment response, and activity logs.

alter table family_schedule_items
  add column if not exists assignee_response text not null default 'pending',
  add column if not exists assignee_responded_at timestamptz,
  add column if not exists assignee_response_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_assignee_response_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_assignee_response_check
      check (assignee_response in ('pending', 'accepted', 'declined'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_response_note_length_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_response_note_length_check
      check (assignee_response_note is null or length(assignee_response_note) <= 300);
  end if;
end;
$$;

update family_schedule_items
   set assignee_response = case
         when creator_member_id = assignee_member_id then 'accepted'
         else coalesce(nullif(assignee_response, ''), 'pending')
       end,
       assignee_responded_at = case
         when creator_member_id = assignee_member_id and assignee_responded_at is null then created_at
         else assignee_responded_at
       end
 where assignee_response is null
    or assignee_response = 'pending';

create table if not exists family_schedule_comments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_item_id uuid not null references family_schedule_items(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  content text not null,
  deleted_at timestamptz,
  deleted_by_member_id uuid references family_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_comments_content_length_check'
       and conrelid = 'family_schedule_comments'::regclass
  ) then
    alter table family_schedule_comments
      add constraint family_schedule_comments_content_length_check
      check (length(trim(content)) between 1 and 300);
  end if;
end;
$$;

create index if not exists family_schedule_comments_item_created_idx
  on family_schedule_comments (schedule_item_id, created_at asc);
create index if not exists family_schedule_comments_member_created_idx
  on family_schedule_comments (member_id, created_at desc);
create index if not exists family_schedule_comments_family_created_idx
  on family_schedule_comments (family_id, created_at desc);

alter table family_schedule_comments enable row level security;
revoke all on family_schedule_comments from anon, authenticated;

drop policy if exists "family schedule comments are rpc only" on family_schedule_comments;

create table if not exists family_schedule_activity_logs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_item_id uuid not null references family_schedule_items(id) on delete cascade,
  actor_member_id uuid not null references family_members(id) on delete cascade,
  activity_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_activity_logs_type_check'
       and conrelid = 'family_schedule_activity_logs'::regclass
  ) then
    alter table family_schedule_activity_logs
      add constraint family_schedule_activity_logs_type_check
      check (activity_type in (
        'created',
        'updated',
        'assigned',
        'accepted',
        'declined',
        'commented',
        'completed',
        'restored',
        'deleted',
        'reminder_changed',
        'visibility_changed'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_activity_logs_summary_length_check'
       and conrelid = 'family_schedule_activity_logs'::regclass
  ) then
    alter table family_schedule_activity_logs
      add constraint family_schedule_activity_logs_summary_length_check
      check (length(summary) <= 200);
  end if;
end;
$$;

create index if not exists family_schedule_activity_logs_item_created_idx
  on family_schedule_activity_logs (schedule_item_id, created_at desc);
create index if not exists family_schedule_activity_logs_family_created_idx
  on family_schedule_activity_logs (family_id, created_at desc);

alter table family_schedule_activity_logs enable row level security;
revoke all on family_schedule_activity_logs from anon, authenticated;

drop policy if exists "family schedule activity logs are rpc only" on family_schedule_activity_logs;

alter table family_schedule_events
  drop constraint if exists family_schedule_events_event_type_check;

alter table family_schedule_events
  add constraint family_schedule_events_event_type_check
  check (event_type in (
    'created',
    'updated',
    'status_changed',
    'deleted',
    'reminder_updated',
    'commented',
    'comment_deleted',
    'assignment_responded',
    'activity_added'
  ));

create or replace function schedule_item_is_visible_to_member(
  p_item family_schedule_items,
  p_member_id uuid
)
returns boolean
language sql
stable
as $$
  select p_item.visibility = 'family'
      or p_item.creator_member_id = p_member_id
      or p_item.assignee_member_id = p_member_id;
$$;

create or replace function enqueue_schedule_event_for_visible_members(
  p_schedule_item_id uuid,
  p_event_type text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item family_schedule_items%rowtype;
begin
  select * into v_item
    from family_schedule_items
   where id = p_schedule_item_id;

  if not found then
    return;
  end if;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select v_item.family_id, v_item.id, fm.id, p_event_type
    from family_members fm
   where fm.family_id = v_item.family_id
     and fm.status = 'active'
     and (
       v_item.visibility = 'family'
       or fm.id in (v_item.creator_member_id, v_item.assignee_member_id)
     );

  delete from family_schedule_events
   where created_at < now() - interval '1 day';
end;
$$;

create or replace function add_schedule_activity_log(
  p_schedule_item_id uuid,
  p_actor_member_id uuid,
  p_activity_type text,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item family_schedule_items%rowtype;
  v_id uuid;
begin
  select * into v_item
    from family_schedule_items
   where id = p_schedule_item_id;

  if not found then
    raise exception 'schedule_item_not_found';
  end if;

  insert into family_schedule_activity_logs (
    family_id,
    schedule_item_id,
    actor_member_id,
    activity_type,
    summary,
    metadata
  )
  values (
    v_item.family_id,
    v_item.id,
    p_actor_member_id,
    p_activity_type,
    left(p_summary, 200),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function get_schedule_collaboration_for_member(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_result jsonb;
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

  select jsonb_build_object(
    'comments',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'schedule_item_id', c.schedule_item_id,
          'member_id', c.member_id,
          'nickname', fm.nickname,
          'content', c.content,
          'created_at', c.created_at,
          'updated_at', c.updated_at
        )
        order by c.created_at asc, c.id asc
      )
      from (
        select *
          from family_schedule_comments c
         where c.schedule_item_id = v_item.id
           and c.deleted_at is null
         order by c.created_at asc, c.id asc
         limit 100
      ) c
      join family_members fm on fm.id = c.member_id
    ), '[]'::jsonb),
    'activity_logs',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'actor_member_id', a.actor_member_id,
          'actor_nickname', fm.nickname,
          'activity_type', a.activity_type,
          'summary', a.summary,
          'created_at', a.created_at
        )
        order by a.created_at desc, a.id desc
      )
      from (
        select *
          from family_schedule_activity_logs a
         where a.schedule_item_id = v_item.id
         order by a.created_at desc, a.id desc
         limit 50
      ) a
      join family_members fm on fm.id = a.actor_member_id
    ), '[]'::jsonb),
    'assignee_response',
    jsonb_build_object(
      'status', v_item.assignee_response,
      'responded_at', v_item.assignee_responded_at,
      'note', v_item.assignee_response_note
    )
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function add_schedule_comment(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_content text
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
  v_content text;
  v_comment_id uuid;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_content := trim(coalesce(p_content, ''));
  if length(v_content) = 0 then
    raise exception 'schedule_comment_required';
  end if;
  if length(v_content) > 300 then
    raise exception 'schedule_comment_too_long';
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

  insert into family_schedule_comments (
    family_id, schedule_item_id, member_id, content
  )
  values (v_member.family_id, v_item.id, v_member.id, v_content)
  returning id into v_comment_id;

  perform add_schedule_activity_log(
    v_item.id,
    v_member.id,
    'commented',
    v_member.nickname || ' commented on the schedule',
    '{}'::jsonb
  );
  perform enqueue_schedule_event_for_visible_members(v_item.id, 'commented');

  return v_comment_id;
end;
$$;

create or replace function delete_schedule_comment(
  p_member_id uuid,
  p_member_token text,
  p_comment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_comment family_schedule_comments%rowtype;
  v_item family_schedule_items%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_comment
    from family_schedule_comments c
   where c.id = p_comment_id
     and c.deleted_at is null
   for update;
  if not found then
    raise exception 'schedule_comment_not_found';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = v_comment.schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null;
  if not found or not schedule_item_is_visible_to_member(v_item, v_member.id) then
    raise exception 'schedule_comment_not_found';
  end if;

  if not (
    v_comment.member_id = v_member.id
    or v_item.creator_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin)
  ) then
    raise exception 'not_allowed';
  end if;

  update family_schedule_comments
     set deleted_at = now(),
         deleted_by_member_id = v_member.id,
         updated_at = now()
   where id = v_comment.id;

  perform enqueue_schedule_event_for_visible_members(v_item.id, 'comment_deleted');
end;
$$;

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

  v_activity := case
    when v_response = 'accepted' then 'accepted'
    else 'declined'
  end;
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
  perform enqueue_schedule_event_for_visible_members(v_item.id, 'assignment_responded');
end;
$$;

drop function if exists create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid);
drop function if exists create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, text);

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
    if v_assignee.id <> v_member.id then
      perform add_schedule_activity_log(
        v_id,
        v_member.id,
        'assigned',
        'Assigned to ' || v_assignee.nickname,
        '{}'::jsonb
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
    v_activity := 'visibility_changed';
    v_summary := v_member.nickname || ' changed visibility';
  elsif v_item.remind_at is distinct from p_remind_at then
    v_activity := 'reminder_changed';
    v_summary := v_member.nickname || ' changed the reminder';
  else
    v_activity := 'updated';
    v_summary := v_member.nickname || ' updated the schedule';
  end if;

  perform add_schedule_activity_log(v_item.id, v_member.id, v_activity, v_summary, '{}'::jsonb);
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
  perform add_schedule_activity_log(
    v_item.id,
    v_member.id,
    v_activity,
    case
      when p_status = 'done' then v_member.nickname || ' completed the schedule'
      else v_member.nickname || ' restored the schedule'
    end,
    '{}'::jsonb
  );
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

  perform add_schedule_activity_log(
    v_item.id,
    v_member.id,
    'deleted',
    v_member.nickname || ' deleted the schedule',
    '{}'::jsonb
  );
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

grant execute on function get_schedule_collaboration_for_member(uuid, text, uuid)
  to anon, authenticated;
grant execute on function add_schedule_comment(uuid, text, uuid, text)
  to anon, authenticated;
grant execute on function delete_schedule_comment(uuid, text, uuid)
  to anon, authenticated;
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
