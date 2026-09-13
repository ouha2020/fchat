-- A creator who assigns a schedule to themselves owns an already-confirmed
-- responsibility. It must not be possible to decline that self-assignment.

update family_schedule_items
   set assignee_response = 'accepted',
       assignee_responded_at = coalesce(assignee_responded_at, created_at),
       assignee_response_note = null,
       updated_at = now()
 where creator_member_id = assignee_member_id
   and assignee_response <> 'accepted';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'family_schedule_items_self_assignment_accepted_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_self_assignment_accepted_check
      check (
        creator_member_id <> assignee_member_id
        or assignee_response = 'accepted'
      );
  end if;
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
  if v_item.creator_member_id = v_item.assignee_member_id then
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

revoke all on function respond_schedule_assignment(uuid, text, uuid, text, text)
  from public;
grant execute on function respond_schedule_assignment(uuid, text, uuid, text, text)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260711052009_schedule_self_assignment_guard',
  'schedule_self_assignment_guard',
  'Keeps creator self-assignments accepted and rejects meaningless self-decline responses.'
)
on conflict (version) do nothing;
