-- Family schedule stage 8: server-side search and filters.

drop function if exists search_schedule_items_for_member(
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  uuid,
  text,
  text,
  int
);

create or replace function search_schedule_items_for_member(
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
  assignee_nickname text
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
         assignee.nickname as assignee_nickname
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

grant execute on function search_schedule_items_for_member(
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  uuid,
  text,
  text,
  int
) to anon, authenticated;
