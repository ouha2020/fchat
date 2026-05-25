-- Ensure delete_schedule_item writes the timeline event before soft-delete.

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

  v_summary := v_member.nickname || ' deleted the schedule';
  perform add_schedule_activity_log(v_item.id, v_member.id, 'deleted', v_summary, '{}'::jsonb);
  perform insert_schedule_context_event(v_item.id, 'member', v_member.id, 'deleted', v_summary, null, null);

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

grant execute on function delete_schedule_item(uuid, text, uuid)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid, text)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_schedule_context_delete_timeline_fix',
  'schedule_context_delete_timeline_fix',
  'Writes schedule delete timeline events before soft-deleting schedule items.'
)
on conflict (version) do nothing;
