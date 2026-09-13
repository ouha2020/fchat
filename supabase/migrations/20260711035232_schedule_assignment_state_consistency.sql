-- Keep assignment acceptance, management permissions, dashboards, and
-- reminder delivery aligned around one responsibility state.

drop function if exists list_schedule_items_for_member(uuid, text, timestamptz, timestamptz);

create function list_schedule_items_for_member(
  p_member_id uuid,
  p_member_token text,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns table (
  id uuid,
  family_id uuid,
  creator_member_id uuid,
  assignee_member_id uuid,
  title text,
  note text,
  item_type text,
  visibility text,
  starts_at timestamptz,
  ends_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  reminder_push_attempted_at timestamptz,
  recurrence_group_id uuid,
  recurrence_rule text,
  recurrence_index int,
  status text,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_nickname text,
  assignee_nickname text,
  assignee_response text
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
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'invalid_schedule_range';
  end if;

  return query
  select s.id, s.family_id, s.creator_member_id, s.assignee_member_id,
         s.title, s.note, s.item_type, s.visibility, s.starts_at, s.ends_at,
         s.remind_at, s.reminded_at, s.reminder_push_attempted_at,
         s.recurrence_group_id, s.recurrence_rule, s.recurrence_index,
         s.status, s.completed_at, s.completed_by_member_id,
         s.created_at, s.updated_at,
         creator.nickname as creator_nickname,
         assignee.nickname as assignee_nickname,
         s.assignee_response
    from family_schedule_items s
    join family_members creator on creator.id = s.creator_member_id
    join family_members assignee on assignee.id = s.assignee_member_id
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.starts_at >= p_range_start
     and s.starts_at < p_range_end
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   order by s.starts_at asc, s.created_at asc, s.id asc;
end;
$$;

revoke all on function list_schedule_items_for_member(uuid, text, timestamptz, timestamptz)
  from public;
grant execute on function list_schedule_items_for_member(uuid, text, timestamptz, timestamptz)
  to anon, authenticated;

drop function if exists search_schedule_items_for_member(
  uuid, text, timestamptz, timestamptz, text, uuid, text, text, int
);

create function search_schedule_items_for_member(
  p_member_id uuid,
  p_member_token text,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_query text default null,
  p_assignee_member_id uuid default null,
  p_item_type text default null,
  p_visibility text default null,
  p_limit int default 300
)
returns table (
  id uuid,
  family_id uuid,
  creator_member_id uuid,
  assignee_member_id uuid,
  title text,
  note text,
  item_type text,
  visibility text,
  starts_at timestamptz,
  ends_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  reminder_push_attempted_at timestamptz,
  recurrence_group_id uuid,
  recurrence_rule text,
  recurrence_index int,
  status text,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_nickname text,
  assignee_nickname text,
  assignee_response text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_query text;
  v_limit int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'invalid_schedule_range';
  end if;

  v_query := nullif(trim(coalesce(p_query, '')), '');
  if v_query is not null and length(v_query) > 40 then
    raise exception 'invalid_schedule_search';
  end if;
  if p_item_type is not null and p_item_type not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_schedule_filter';
  end if;
  if p_visibility is not null and p_visibility not in ('family', 'private') then
    raise exception 'invalid_schedule_filter';
  end if;
  if p_assignee_member_id is not null and not exists (
    select 1
      from family_members fm
     where fm.id = p_assignee_member_id
       and fm.family_id = v_member.family_id
       and fm.status = 'active'
  ) then
    raise exception 'invalid_schedule_filter';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 300), 1), 300);

  return query
  select s.id, s.family_id, s.creator_member_id, s.assignee_member_id,
         s.title, s.note, s.item_type, s.visibility, s.starts_at, s.ends_at,
         s.remind_at, s.reminded_at, s.reminder_push_attempted_at,
         s.recurrence_group_id, s.recurrence_rule, s.recurrence_index,
         s.status, s.completed_at, s.completed_by_member_id,
         s.created_at, s.updated_at,
         creator.nickname as creator_nickname,
         assignee.nickname as assignee_nickname,
         s.assignee_response
    from family_schedule_items s
    join family_members creator on creator.id = s.creator_member_id
    join family_members assignee on assignee.id = s.assignee_member_id
   where s.family_id = v_member.family_id
     and s.deleted_at is null
     and s.starts_at >= p_range_start
     and s.starts_at < p_range_end
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
     and (v_query is null or s.title ilike '%' || v_query || '%' or coalesce(s.note, '') ilike '%' || v_query || '%')
     and (p_assignee_member_id is null or s.assignee_member_id = p_assignee_member_id)
     and (p_item_type is null or s.item_type = p_item_type)
     and (p_visibility is null or s.visibility = p_visibility)
   order by s.starts_at asc, s.created_at asc, s.id asc
   limit v_limit;
end;
$$;

revoke all on function search_schedule_items_for_member(
  uuid, text, timestamptz, timestamptz, text, uuid, text, text, int
) from public;
grant execute on function search_schedule_items_for_member(
  uuid, text, timestamptz, timestamptz, text, uuid, text, text, int
) to anon, authenticated;

drop function if exists get_schedule_item_for_member(uuid, text, uuid);

create function get_schedule_item_for_member(
  p_member_id uuid,
  p_member_token text,
  p_item_id uuid
)
returns table (
  id uuid,
  family_id uuid,
  creator_member_id uuid,
  assignee_member_id uuid,
  title text,
  note text,
  item_type text,
  visibility text,
  starts_at timestamptz,
  ends_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  reminder_push_attempted_at timestamptz,
  recurrence_group_id uuid,
  recurrence_rule text,
  recurrence_index int,
  status text,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_nickname text,
  assignee_nickname text,
  assignee_response text
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
  select s.id, s.family_id, s.creator_member_id, s.assignee_member_id,
         s.title, s.note, s.item_type, s.visibility, s.starts_at, s.ends_at,
         s.remind_at, s.reminded_at, s.reminder_push_attempted_at,
         s.recurrence_group_id, s.recurrence_rule, s.recurrence_index,
         s.status, s.completed_at, s.completed_by_member_id,
         s.created_at, s.updated_at,
         creator.nickname as creator_nickname,
         assignee.nickname as assignee_nickname,
         s.assignee_response
    from family_schedule_items s
    join family_members creator on creator.id = s.creator_member_id
    join family_members assignee on assignee.id = s.assignee_member_id
   where s.id = p_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   limit 1;
end;
$$;

revoke all on function get_schedule_item_for_member(uuid, text, uuid) from public;
grant execute on function get_schedule_item_for_member(uuid, text, uuid)
  to anon, authenticated;

create or replace function schedule_item_json(p_item jsonb)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', p_item ->> 'id',
    'title', p_item ->> 'title',
    'item_type', p_item ->> 'item_type',
    'visibility', p_item ->> 'visibility',
    'starts_at', p_item ->> 'starts_at',
    'ends_at', p_item ->> 'ends_at',
    'remind_at', p_item ->> 'remind_at',
    'status', p_item ->> 'status',
    'assignee_member_id', p_item ->> 'assignee_member_id',
    'assignee_nickname', p_item ->> 'assignee_nickname',
    'assignee_response', p_item ->> 'assignee_response',
    'creator_member_id', p_item ->> 'creator_member_id',
    'creator_nickname', p_item ->> 'creator_nickname',
    'recurrence_group_id', p_item ->> 'recurrence_group_id',
    'recurrence_rule', p_item ->> 'recurrence_rule'
  );
$$;

create or replace function get_personal_dashboard_for_member(
  p_member_id uuid,
  p_member_token text,
  p_today_start timestamptz,
  p_today_end timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_result jsonb;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_today_start is null or p_today_end is null or p_today_end <= p_today_start then
    raise exception 'invalid_schedule_range';
  end if;
  if p_now is null then
    raise exception 'invalid_schedule_time';
  end if;

  with visible_items as (
    select s.*,
           creator.nickname as creator_nickname,
           assignee.nickname as assignee_nickname
      from family_schedule_items s
      join family_members creator on creator.id = s.creator_member_id
      join family_members assignee on assignee.id = s.assignee_member_id
     where s.family_id = v_member.family_id
       and s.deleted_at is null
       and (
         s.visibility = 'family'
         or s.creator_member_id = v_member.id
         or s.assignee_member_id = v_member.id
       )
  ),
  today_assigned as (
    select *
      from visible_items
     where assignee_member_id = v_member.id
       and assignee_response = 'accepted'
       and status = 'active'
       and starts_at >= p_today_start
       and starts_at < p_today_end
     order by starts_at asc, id asc
     limit 5
  ),
  upcoming as (
    select *
      from visible_items
     where status = 'active'
       and starts_at >= p_now
       and starts_at < p_now + interval '7 days'
       and not (
         assignee_member_id = v_member.id
         and assignee_response = 'accepted'
         and starts_at >= p_today_start
         and starts_at < p_today_end
       )
       and not (
         visibility = 'private'
         and creator_member_id <> v_member.id
         and assignee_member_id = v_member.id
         and assignee_response = 'declined'
       )
     order by starts_at asc, id asc
     limit 8
  ),
  created_by_me as (
    select *
      from visible_items
     where creator_member_id = v_member.id
       and status = 'active'
       and starts_at >= p_now
     order by starts_at asc, id asc
     limit 5
  ),
  recent_done as (
    select *
      from visible_items
     where status = 'done'
       and (
         assignee_member_id = v_member.id
         or creator_member_id = v_member.id
         or completed_by_member_id = v_member.id
       )
     order by completed_at desc nulls last, updated_at desc, id desc
     limit 5
  )
  select jsonb_build_object(
    'profile',
      jsonb_build_object(
        'member_id', v_member.id,
        'nickname', v_member.nickname,
        'role', v_member.role,
        'is_admin', v_member.is_admin,
        'family_id', v_member.family_id,
        'family_name', f.name,
        'avatar_url', fm.avatar_url
      ),
    'today_assigned',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(today_assigned)::jsonb)) from today_assigned), '[]'::jsonb),
    'upcoming',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(upcoming)::jsonb)) from upcoming), '[]'::jsonb),
    'created_by_me',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(created_by_me)::jsonb)) from created_by_me), '[]'::jsonb),
    'recent_done',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(recent_done)::jsonb)) from recent_done), '[]'::jsonb)
  )
  into v_result
  from families f
  join family_members fm on fm.id = v_member.id
  where f.id = v_member.family_id;

  return v_result;
end;
$$;

create or replace function ensure_schedule_reminder_deliveries(
  p_schedule_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_item family_schedule_items%rowtype;
  v_now timestamptz := now();
  v_seed_status text;
begin
  select * into v_item
    from family_schedule_items
   where id = p_schedule_item_id;

  if not found then
    return;
  end if;

  if v_item.remind_at is null
     or v_item.deleted_at is not null
     or v_item.status <> 'active' then
    update family_schedule_reminder_deliveries d
       set status = 'skipped',
           skipped_reason = case
             when v_item.remind_at is null then 'reminder_not_configured'
             else 'schedule_not_active'
           end,
           updated_at = v_now
     where d.schedule_item_id = v_item.id
       and d.status in ('pending', 'failed');
    return;
  end if;

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = 'reminder_changed',
         updated_at = v_now
   where d.schedule_item_id = v_item.id
     and d.status in ('pending', 'failed')
     and d.scheduled_for is distinct from v_item.remind_at;

  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = case
           when v_item.visibility = 'private'
             and d.member_id = v_item.assignee_member_id
             and d.member_id <> v_item.creator_member_id
             and v_item.assignee_response <> 'accepted'
           then 'assignment_not_accepted'
           else 'not_visible'
         end,
         updated_at = v_now
   where d.schedule_item_id = v_item.id
     and d.status in ('pending', 'failed')
     and d.scheduled_for = v_item.remind_at
     and not exists (
       select 1
         from family_members fm
        where fm.id = d.member_id
          and fm.family_id = v_item.family_id
          and fm.status = 'active'
          and (
            v_item.visibility = 'family'
            or fm.id = v_item.creator_member_id
            or (
              fm.id = v_item.assignee_member_id
              and v_item.assignee_response = 'accepted'
            )
          )
     );

  v_seed_status := case when v_item.reminded_at is null then 'pending' else 'sent' end;

  insert into family_schedule_reminder_deliveries (
    family_id,
    schedule_item_id,
    member_id,
    scheduled_for,
    status,
    delivered_at,
    last_attempt_at,
    attempt_count,
    updated_at
  )
  select v_item.family_id,
         v_item.id,
         fm.id,
         v_item.remind_at,
         v_seed_status,
         case when v_seed_status = 'sent' then v_item.reminded_at else null end,
         case when v_seed_status = 'sent' then v_item.reminded_at else null end,
         case when v_seed_status = 'sent' then 1 else 0 end,
         v_now
    from family_members fm
   where fm.family_id = v_item.family_id
     and fm.status = 'active'
     and (
       v_item.visibility = 'family'
       or fm.id = v_item.creator_member_id
       or (
         fm.id = v_item.assignee_member_id
         and v_item.assignee_response = 'accepted'
       )
     )
  on conflict (schedule_item_id, member_id, scheduled_for)
  do update set
    status = excluded.status,
    delivered_at = excluded.delivered_at,
    last_attempt_at = excluded.last_attempt_at,
    attempt_count = excluded.attempt_count,
    next_retry_at = null,
    skipped_reason = null,
    error_status = null,
    error_message = null,
    updated_at = excluded.updated_at
  where family_schedule_reminder_deliveries.status = 'skipped'
    and family_schedule_reminder_deliveries.skipped_reason in (
      'assignment_not_accepted',
      'not_visible',
      'schedule_not_active',
      'reminder_not_configured',
      'reminder_changed'
    );
end;
$$;

drop trigger if exists trg_sync_schedule_reminder_deliveries
  on family_schedule_items;

create trigger trg_sync_schedule_reminder_deliveries
after insert or update of remind_at, reminded_at, status, deleted_at, visibility,
  assignee_member_id, assignee_response
on family_schedule_items
for each row
execute function sync_schedule_reminder_deliveries();

create or replace function ensure_overdue_schedule_reminders()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inserted int;
begin
  insert into family_schedule_reminder_deliveries (
    family_id,
    schedule_item_id,
    member_id,
    scheduled_for,
    reminder_kind,
    status,
    updated_at
  )
  select s.family_id,
         s.id,
         s.assignee_member_id,
         s.starts_at + interval '10 minutes',
         'overdue',
         'pending',
         now()
    from family_schedule_items s
    join family_members fm on fm.id = s.assignee_member_id
   where s.status = 'active'
     and s.deleted_at is null
     and s.assignee_response = 'accepted'
     and s.starts_at <= now() - interval '10 minutes'
     and fm.status = 'active'
     and not exists (
       select 1 from family_schedule_reminder_deliveries d
        where d.schedule_item_id = s.id
          and d.member_id = s.assignee_member_id
          and d.reminder_kind = 'overdue'
     )
   order by s.starts_at asc
   limit 100
  on conflict (schedule_item_id, member_id, scheduled_for) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
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

  update family_schedule_items s
     set assignee_response = v_response,
         assignee_responded_at = now(),
         assignee_response_note = case when v_response = 'declined' then v_note else null end,
         updated_at = now()
   where s.family_id = v_item.family_id
     and s.deleted_at is null
     and s.status = 'active'
     and s.assignee_member_id = v_member.id
     and (
       s.id = v_item.id
       or (
         v_item.recurrence_group_id is not null
         and s.recurrence_group_id = v_item.recurrence_group_id
       )
     );

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

update family_schedule_reminder_deliveries d
   set status = 'skipped',
       skipped_reason = 'assignment_not_accepted',
       updated_at = now()
  from family_schedule_items s
 where s.id = d.schedule_item_id
   and s.visibility = 'private'
   and s.assignee_member_id <> s.creator_member_id
   and s.assignee_response <> 'accepted'
   and d.member_id = s.assignee_member_id
   and d.status in ('pending', 'failed');

create or replace function assert_schedule_item_management_allowed(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_allow_family_admin boolean
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
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
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
    or (
      v_item.assignee_member_id = v_member.id
      and v_item.assignee_response = 'accepted'
    )
    or (
      coalesce(p_allow_family_admin, false)
      and v_item.visibility = 'family'
      and v_member.is_admin
    )
  ) then
    raise exception 'not_allowed';
  end if;
end;
$$;

revoke all on function assert_schedule_item_management_allowed(uuid, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function assert_schedule_item_management_allowed(uuid, text, uuid, boolean)
  to service_role;

alter function update_schedule_item(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz,
  timestamptz, text
) rename to update_schedule_item_unchecked_20260711;

alter function set_schedule_item_status(uuid, text, uuid, text)
  rename to set_schedule_item_status_unchecked_20260711;

alter function delete_schedule_item(uuid, text, uuid, text)
  rename to delete_schedule_item_unchecked_20260711;

alter function set_schedule_reminder_rules(uuid, text, uuid, int[], text)
  rename to set_schedule_reminder_rules_unchecked_20260711;

alter function replace_schedule_item_recurrence(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz,
  timestamptz, text, text
) rename to replace_schedule_item_recurrence_unchecked_20260711;

revoke all on function update_schedule_item_unchecked_20260711(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz,
  timestamptz, text
) from public, anon, authenticated;
revoke all on function set_schedule_item_status_unchecked_20260711(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function delete_schedule_item_unchecked_20260711(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function set_schedule_reminder_rules_unchecked_20260711(uuid, text, uuid, int[], text)
  from public, anon, authenticated;
revoke all on function replace_schedule_item_recurrence_unchecked_20260711(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz,
  timestamptz, text, text
) from public, anon, authenticated;

grant execute on function update_schedule_item_unchecked_20260711(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz,
  timestamptz, text
) to service_role;
grant execute on function set_schedule_item_status_unchecked_20260711(uuid, text, uuid, text)
  to service_role;
grant execute on function delete_schedule_item_unchecked_20260711(uuid, text, uuid, text)
  to service_role;
grant execute on function set_schedule_reminder_rules_unchecked_20260711(uuid, text, uuid, int[], text)
  to service_role;
grant execute on function replace_schedule_item_recurrence_unchecked_20260711(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz,
  timestamptz, text, text
) to service_role;

create function update_schedule_item(
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
begin
  perform assert_schedule_item_management_allowed(
    p_member_id, p_member_token, p_item_id, true
  );
  perform update_schedule_item_unchecked_20260711(
    p_member_id, p_member_token, p_item_id, p_title, p_note, p_item_type,
    p_visibility, p_assignee_member_id, p_starts_at, p_ends_at, p_remind_at,
    p_recurrence_scope
  );
end;
$$;

create function set_schedule_item_status(
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
begin
  perform assert_schedule_item_management_allowed(
    p_member_id, p_member_token, p_schedule_item_id, false
  );
  perform set_schedule_item_status_unchecked_20260711(
    p_member_id, p_member_token, p_schedule_item_id, p_status
  );
end;
$$;

create function delete_schedule_item(
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
begin
  perform assert_schedule_item_management_allowed(
    p_member_id, p_member_token, p_schedule_item_id, true
  );
  perform delete_schedule_item_unchecked_20260711(
    p_member_id, p_member_token, p_schedule_item_id, p_recurrence_scope
  );
end;
$$;

create function set_schedule_reminder_rules(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid,
  p_offsets int[],
  p_recurrence_scope text default 'single'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform assert_schedule_item_management_allowed(
    p_member_id, p_member_token, p_schedule_item_id, true
  );
  perform set_schedule_reminder_rules_unchecked_20260711(
    p_member_id, p_member_token, p_schedule_item_id, p_offsets,
    p_recurrence_scope
  );
end;
$$;

create function replace_schedule_item_recurrence(
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
  p_recurrence_rule text,
  p_recurrence_scope text default 'single'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item_id uuid;
begin
  perform assert_schedule_item_management_allowed(
    p_member_id, p_member_token, p_item_id, true
  );
  v_item_id := replace_schedule_item_recurrence_unchecked_20260711(
    p_member_id, p_member_token, p_item_id, p_title, p_note, p_item_type,
    p_visibility, p_assignee_member_id, p_starts_at, p_ends_at, p_remind_at,
    p_recurrence_rule, p_recurrence_scope
  );
  return v_item_id;
end;
$$;

revoke all on function update_schedule_item(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz,
  timestamptz, text
) from public;
revoke all on function set_schedule_item_status(uuid, text, uuid, text) from public;
revoke all on function delete_schedule_item(uuid, text, uuid, text) from public;
revoke all on function set_schedule_reminder_rules(uuid, text, uuid, int[], text) from public;
revoke all on function replace_schedule_item_recurrence(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz,
  timestamptz, text, text
) from public;

grant execute on function update_schedule_item(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz,
  timestamptz, text
) to anon, authenticated;
grant execute on function set_schedule_item_status(uuid, text, uuid, text)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid, text)
  to anon, authenticated;
grant execute on function set_schedule_reminder_rules(uuid, text, uuid, int[], text)
  to anon, authenticated;
grant execute on function replace_schedule_item_recurrence(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz,
  timestamptz, text, text
) to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260711035232_schedule_assignment_state_consistency',
  'schedule_assignment_state_consistency',
  'Aligns accepted responsibility with schedule management, dashboards, recurrence responses, and reminder delivery.'
)
on conflict (version) do nothing;
