-- Tighten schedule RPC validation so null enum inputs return friendly errors.

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
  v_id uuid;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');
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

  insert into family_schedule_items (
    family_id, creator_member_id, assignee_member_id, title, note, item_type,
    visibility, starts_at, ends_at, remind_at
  )
  values (
    v_member.family_id, v_member.id, v_assignee.id, v_title, v_note,
    p_item_type, p_visibility, p_starts_at, p_ends_at, p_remind_at
  )
  returning id into v_id;

  return v_id;
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
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if coalesce(p_status, '') not in ('active', 'done') then
    raise exception 'invalid_schedule_status';
  end if;

  select * into v_item
    from family_schedule_items s
   where s.id = p_schedule_item_id
     and s.family_id = v_member.family_id
     and s.deleted_at is null
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;
  if v_item.creator_member_id <> v_member.id and v_item.assignee_member_id <> v_member.id then
    raise exception 'not_allowed';
  end if;

  update family_schedule_items
     set status = p_status,
         completed_at = case when p_status = 'done' then now() else null end,
         completed_by_member_id = case when p_status = 'done' then v_member.id else null end,
         updated_at = now()
   where id = v_item.id;
end;
$$;

grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid)
  to anon, authenticated;
grant execute on function set_schedule_item_status(uuid, text, uuid, text)
  to anon, authenticated;
