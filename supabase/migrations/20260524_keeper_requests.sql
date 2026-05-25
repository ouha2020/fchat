-- HomeGarden おうち係 request workflow.

alter table messages
  add column if not exists recipient_member_id uuid references family_members(id) on delete set null,
  add column if not exists system_event_type text,
  add column if not exists system_event_payload jsonb;

create table if not exists keeper_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  requester_member_id uuid not null references family_members(id) on delete cascade,
  assignee_member_id uuid references family_members(id) on delete set null,
  schedule_item_id uuid references family_schedule_items(id) on delete set null,
  source_message_id uuid references messages(id) on delete set null,
  request_text text not null,
  request_type text not null,
  visibility text not null,
  status text not null default 'created',
  due_at timestamptz,
  remind_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint keeper_requests_request_type_check
    check (request_type in ('schedule', 'todo', 'reminder')),
  constraint keeper_requests_visibility_check
    check (visibility in ('family', 'private')),
  constraint keeper_requests_status_check
    check (status in ('draft', 'created', 'done', 'cancelled')),
  constraint keeper_requests_text_length_check
    check (char_length(trim(request_text)) between 1 and 300)
);

create index if not exists keeper_requests_family_created_idx
  on keeper_requests (family_id, created_at desc);

create index if not exists keeper_requests_requester_idx
  on keeper_requests (requester_member_id, created_at desc);

create index if not exists keeper_requests_assignee_idx
  on keeper_requests (assignee_member_id, created_at desc)
  where assignee_member_id is not null;

alter table keeper_requests enable row level security;
revoke all on keeper_requests from anon, authenticated;

drop policy if exists "keeper requests are rpc only" on keeper_requests;
create policy "keeper requests are rpc only"
  on keeper_requests for select
  to anon, authenticated
  using (false);

create or replace function create_keeper_request(
  p_member_id uuid,
  p_member_token text,
  p_request_text text,
  p_request_type text,
  p_assignee_member_id uuid,
  p_visibility text,
  p_starts_at timestamptz,
  p_remind_at timestamptz,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_assignee family_members%rowtype;
  v_request_text text;
  v_note text;
  v_schedule_item_id uuid;
  v_request_id uuid;
  v_message_id uuid;
  v_target_kind text;
  v_content text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_request_text := trim(coalesce(p_request_text, ''));
  v_note := nullif(trim(coalesce(p_note, '')), '');

  if length(v_request_text) = 0 then
    raise exception 'keeper_request_required';
  end if;
  if length(v_request_text) > 300 then
    raise exception 'keeper_request_too_long';
  end if;
  if coalesce(p_request_type, '') not in ('schedule', 'todo', 'reminder') then
    raise exception 'invalid_keeper_request_type';
  end if;
  if coalesce(p_visibility, '') not in ('family', 'private') then
    raise exception 'invalid_keeper_visibility';
  end if;
  if p_starts_at is null then
    raise exception 'invalid_schedule_time';
  end if;

  select * into v_assignee
    from family_members fm
   where fm.id = coalesce(p_assignee_member_id, v_member.id)
     and fm.family_id = v_member.family_id
     and fm.status = 'active'
   limit 1;
  if not found then
    raise exception 'member_not_found';
  end if;

  v_schedule_item_id := create_schedule_item(
    p_member_id,
    p_member_token,
    v_request_text,
    v_note,
    p_request_type,
    p_visibility,
    p_starts_at,
    null,
    p_remind_at,
    v_assignee.id,
    'none'
  );

  if p_remind_at is not null then
    perform set_schedule_reminder_rules(
      p_member_id,
      p_member_token,
      v_schedule_item_id,
      array[0]::int[],
      'single'
    );
  end if;

  insert into keeper_requests (
    family_id, requester_member_id, assignee_member_id, schedule_item_id,
    request_text, request_type, visibility, status, due_at, remind_at
  )
  values (
    v_member.family_id, v_member.id, v_assignee.id, v_schedule_item_id,
    v_request_text, p_request_type, p_visibility, 'created', p_starts_at, p_remind_at
  )
  returning id into v_request_id;

  v_target_kind := case
    when p_visibility = 'family' then 'family'
    when v_assignee.id = v_member.id then 'self'
    else 'assignee'
  end;

  v_content := case
    when v_target_kind = 'family' then '收到，我会提醒大家。'
    when v_target_kind = 'assignee' then '收到，我会提醒' || v_assignee.nickname || '。'
    else '收到，我会提醒你。'
  end;

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, system_event_type, system_event_payload
  )
  values (
    v_member.family_id,
    v_member.id,
    case when p_visibility = 'private' then v_assignee.id else null end,
    'system',
    v_content,
    'keeper_request_created',
    jsonb_build_object(
      'actor_type', 'keeper',
      'actor_name', 'おうち係',
      'request_id', v_request_id,
      'schedule_item_id', v_schedule_item_id,
      'target_kind', v_target_kind,
      'assignee_member_id', v_assignee.id,
      'assignee_nickname', v_assignee.nickname,
      'request_type', p_request_type
    )
  )
  returning id into v_message_id;

  update keeper_requests
     set source_message_id = v_message_id,
         updated_at = now()
   where id = v_request_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'schedule_item_id', v_schedule_item_id,
    'message_id', v_message_id
  );
end;
$$;

grant execute on function create_keeper_request(
  uuid, text, text, text, uuid, text, timestamptz, timestamptz, text
) to anon, authenticated;

create or replace function list_keeper_requests_for_member(
  p_member_id uuid,
  p_member_token text
)
returns table (
  id uuid,
  family_id uuid,
  requester_member_id uuid,
  assignee_member_id uuid,
  schedule_item_id uuid,
  source_message_id uuid,
  request_text text,
  request_type text,
  visibility text,
  status text,
  due_at timestamptz,
  remind_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
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

  return query
  select kr.id, kr.family_id, kr.requester_member_id, kr.assignee_member_id,
         kr.schedule_item_id, kr.source_message_id, kr.request_text,
         kr.request_type, kr.visibility, kr.status, kr.due_at, kr.remind_at,
         kr.created_at, kr.updated_at
    from keeper_requests kr
   where kr.family_id = v_member.family_id
     and (
       kr.visibility = 'family'
       or kr.requester_member_id = v_member.id
       or kr.assignee_member_id = v_member.id
     )
   order by kr.created_at desc, kr.id desc
   limit 200;
end;
$$;

grant execute on function list_keeper_requests_for_member(uuid, text)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_keeper_requests',
  'keeper_requests',
  'Adds the HomeGarden おうち係 request workflow.'
)
on conflict (version) do nothing;
