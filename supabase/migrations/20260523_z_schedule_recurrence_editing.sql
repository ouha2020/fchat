-- Allow editing the recurrence rule from the schedule detail form.
-- The operation keeps the selected item id, cancels replaced instances, and
-- regenerates a finite series from the selected occurrence.

create or replace function replace_schedule_item_recurrence(
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
#variable_conflict use_column
declare
  v_member record;
  v_item family_schedule_items%rowtype;
  v_assignee family_members%rowtype;
  v_title text;
  v_note text;
  v_rule text;
  v_scope text;
  v_count int;
  v_group_id uuid;
  v_index int;
  v_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remind_at timestamptz;
  v_duration interval;
  v_reminder_offset interval;
  v_assignee_response text;
  v_assignee_responded_at timestamptz;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_rule := coalesce(nullif(trim(coalesce(p_recurrence_rule, '')), ''), 'none');
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
  if v_rule not in ('none', 'daily', 'weekly', 'monthly') then
    raise exception 'invalid_schedule_recurrence';
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
  elsif v_scope = 'single'
    and v_rule is distinct from coalesce(v_item.recurrence_rule, 'none') then
    v_scope := 'future';
  end if;

  with cancelled as (
    update family_schedule_items s
       set status = 'cancelled',
           deleted_at = now(),
           deleted_by_member_id = v_member.id,
           updated_at = now()
     where s.family_id = v_member.family_id
       and s.deleted_at is null
       and s.id <> v_item.id
       and (
         (
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
       )
     returning s.id
  )
  update family_schedule_reminder_deliveries d
     set status = 'skipped',
         skipped_reason = 'schedule_cancelled',
         updated_at = now()
   where d.status in ('pending', 'failed')
     and exists (select 1 from cancelled c where c.id = d.schedule_item_id);

  v_count := case v_rule
    when 'daily' then 30
    when 'weekly' then 12
    when 'monthly' then 12
    else 1
  end;
  v_group_id := case when v_rule = 'none' then null else gen_random_uuid() end;
  v_duration := case when p_ends_at is null then null else p_ends_at - p_starts_at end;
  v_reminder_offset := case when p_remind_at is null then null else p_starts_at - p_remind_at end;
  v_assignee_response := case when v_assignee.id = v_item.creator_member_id then 'accepted' else 'pending' end;
  v_assignee_responded_at := case when v_assignee.id = v_item.creator_member_id then now() else null end;

  update family_schedule_items
     set title = v_title,
         note = v_note,
         item_type = p_item_type,
         visibility = p_visibility,
         assignee_member_id = v_assignee.id,
         assignee_response = case
           when v_item.assignee_member_id is distinct from v_assignee.id then v_assignee_response
           else assignee_response
         end,
         assignee_responded_at = case
           when v_item.assignee_member_id is distinct from v_assignee.id then v_assignee_responded_at
           else assignee_responded_at
         end,
         assignee_response_note = case
           when v_item.assignee_member_id is distinct from v_assignee.id then null
           else assignee_response_note
         end,
         starts_at = p_starts_at,
         ends_at = p_ends_at,
         remind_at = p_remind_at,
         reminded_at = null,
         reminder_push_attempted_at = null,
         reminder_push_error = null,
         recurrence_group_id = v_group_id,
         recurrence_rule = v_rule,
         recurrence_index = case when v_rule = 'none' then null else 0 end,
         updated_at = now()
   where id = v_item.id;
  perform ensure_schedule_reminder_deliveries(v_item.id);

  if v_rule <> 'none' then
    for v_index in 1..(v_count - 1) loop
      v_starts_at := case v_rule
        when 'daily' then p_starts_at + (v_index * interval '1 day')
        when 'weekly' then p_starts_at + (v_index * interval '1 week')
        when 'monthly' then p_starts_at + (v_index * interval '1 month')
        else p_starts_at
      end;
      v_ends_at := case when v_duration is null then null else v_starts_at + v_duration end;
      v_remind_at := case when v_reminder_offset is null then null else v_starts_at - v_reminder_offset end;

      insert into family_schedule_items (
        family_id,
        creator_member_id,
        assignee_member_id,
        title,
        note,
        item_type,
        visibility,
        starts_at,
        ends_at,
        remind_at,
        recurrence_group_id,
        recurrence_rule,
        recurrence_index,
        assignee_response,
        assignee_responded_at
      )
      values (
        v_item.family_id,
        v_item.creator_member_id,
        v_assignee.id,
        v_title,
        v_note,
        p_item_type,
        p_visibility,
        v_starts_at,
        v_ends_at,
        v_remind_at,
        v_group_id,
        v_rule,
        v_index,
        v_assignee_response,
        v_assignee_responded_at
      )
      returning id into v_id;
      perform ensure_schedule_reminder_deliveries(v_id);
    end loop;
  end if;

  perform add_schedule_activity_log(
    v_item.id,
    v_member.id,
    'updated',
    v_member.nickname || ' changed the repeat rule',
    jsonb_build_object('recurrence_rule', v_rule, 'recurrence_scope', v_scope)
  );
  perform enqueue_schedule_event_for_visible_members(v_item.id, 'updated');

  return v_item.id;
end;
$$;

grant execute on function replace_schedule_item_recurrence(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz, timestamptz,
  timestamptz, text, text
) to anon, authenticated;
