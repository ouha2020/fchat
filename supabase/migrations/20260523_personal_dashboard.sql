-- Family schedule stage 7: personal dashboard aggregation.

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
         and starts_at >= p_today_start
         and starts_at < p_today_end
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
        'family_name', f.name
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
  where f.id = v_member.family_id;

  return v_result;
end;
$$;

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
    'creator_member_id', p_item ->> 'creator_member_id',
    'creator_nickname', p_item ->> 'creator_nickname',
    'recurrence_group_id', p_item ->> 'recurrence_group_id',
    'recurrence_rule', p_item ->> 'recurrence_rule'
  );
$$;

grant execute on function get_personal_dashboard_for_member(uuid, text, timestamptz, timestamptz, timestamptz)
  to anon, authenticated;
