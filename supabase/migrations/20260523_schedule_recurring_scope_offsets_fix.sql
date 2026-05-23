-- Keep recurring schedule instances spaced out when editing a whole series or future items.

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
       (
         v_scope = 'single'
         and s.id = v_item.id
       )
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
end;
$$;

grant execute on function update_schedule_item(uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz, timestamptz, text)
  to anon, authenticated;
