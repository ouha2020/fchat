-- Family schedule reminders: due-scan fields for server-side Push reminders.

alter table family_schedule_items
  add column if not exists reminded_at timestamptz,
  add column if not exists reminder_push_attempted_at timestamptz,
  add column if not exists reminder_push_error text;

create index if not exists family_schedule_items_due_reminders_idx
  on family_schedule_items (remind_at)
  where remind_at is not null
    and reminded_at is null
    and deleted_at is null
    and status = 'active';

drop function if exists list_schedule_items_for_member(uuid, text, timestamptz, timestamptz);

create or replace function list_schedule_items_for_member(
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
   order by s.starts_at asc, s.created_at asc, s.id asc;
end;
$$;

grant execute on function list_schedule_items_for_member(uuid, text, timestamptz, timestamptz)
  to anon, authenticated;
