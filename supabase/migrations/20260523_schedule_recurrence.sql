-- Family schedule recurrence: finite instance generation.

alter table family_schedule_items
  add column if not exists recurrence_group_id uuid,
  add column if not exists recurrence_rule text,
  add column if not exists recurrence_index int;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_recurrence_rule_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_recurrence_rule_check
      check (
        recurrence_rule is null
        or recurrence_rule in ('none', 'daily', 'weekly', 'monthly')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_recurrence_index_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_recurrence_index_check
      check (recurrence_index is null or recurrence_index >= 0);
  end if;
end;
$$;

create index if not exists family_schedule_items_recurrence_group_idx
  on family_schedule_items (recurrence_group_id, recurrence_index);

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
      recurrence_group_id, recurrence_rule, recurrence_index
    )
    values (
      v_member.family_id, v_member.id, v_assignee.id, v_title, v_note,
      p_item_type, p_visibility, v_starts_at, v_ends_at, v_remind_at,
      v_group_id, v_rule, case when v_rule = 'none' then null else v_index end
    )
    returning id into v_id;

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

grant execute on function list_schedule_items_for_member(uuid, text, timestamptz, timestamptz)
  to anon, authenticated;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid)
  to anon, authenticated;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, text)
  to anon, authenticated;
