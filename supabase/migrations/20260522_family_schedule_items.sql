-- Family schedule v1: private/family-visible items managed through RPCs.

create table if not exists family_schedule_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  creator_member_id uuid not null references family_members(id) on delete cascade,
  assignee_member_id uuid not null references family_members(id) on delete cascade,
  title text not null,
  note text,
  item_type text not null default 'schedule',
  visibility text not null default 'family',
  starts_at timestamptz not null,
  ends_at timestamptz,
  remind_at timestamptz,
  status text not null default 'active',
  completed_at timestamptz,
  completed_by_member_id uuid references family_members(id) on delete set null,
  deleted_at timestamptz,
  deleted_by_member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_item_type_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_item_type_check
      check (item_type in ('schedule', 'todo', 'reminder'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_visibility_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_visibility_check
      check (visibility in ('family', 'private'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_status_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_status_check
      check (status in ('active', 'done', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_items_title_length_check'
       and conrelid = 'family_schedule_items'::regclass
  ) then
    alter table family_schedule_items
      add constraint family_schedule_items_title_length_check
      check (char_length(trim(title)) between 1 and 60);
  end if;
end;
$$;

create index if not exists family_schedule_items_family_starts_idx
  on family_schedule_items (family_id, starts_at);

create index if not exists family_schedule_items_assignee_starts_idx
  on family_schedule_items (assignee_member_id, starts_at);

create index if not exists family_schedule_items_creator_starts_idx
  on family_schedule_items (creator_member_id, starts_at);

create index if not exists family_schedule_items_family_visibility_starts_idx
  on family_schedule_items (family_id, visibility, starts_at);

alter table family_schedule_items enable row level security;
revoke all on family_schedule_items from anon, authenticated;

drop policy if exists "family schedule items are rpc only" on family_schedule_items;

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
         s.remind_at, s.status, s.completed_at, s.completed_by_member_id,
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

create or replace function delete_schedule_item(
  p_member_id uuid,
  p_member_token text,
  p_schedule_item_id uuid
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
  v_can_delete boolean;
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
     and (
       s.visibility = 'family'
       or s.creator_member_id = v_member.id
       or s.assignee_member_id = v_member.id
     )
   for update;
  if not found then
    raise exception 'schedule_item_not_found';
  end if;

  v_can_delete :=
    v_item.creator_member_id = v_member.id
    or v_item.assignee_member_id = v_member.id
    or (v_item.visibility = 'family' and v_member.is_admin);

  if not v_can_delete then
    raise exception 'not_allowed';
  end if;

  update family_schedule_items
     set status = 'cancelled',
         deleted_at = now(),
         deleted_by_member_id = v_member.id,
         updated_at = now()
   where id = v_item.id;
end;
$$;

grant execute on function list_schedule_items_for_member(uuid, text, timestamptz, timestamptz)
  to anon, authenticated;
grant execute on function create_schedule_item(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid)
  to anon, authenticated;
grant execute on function set_schedule_item_status(uuid, text, uuid, text)
  to anon, authenticated;
grant execute on function delete_schedule_item(uuid, text, uuid)
  to anon, authenticated;
