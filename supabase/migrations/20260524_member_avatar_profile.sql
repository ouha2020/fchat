-- Personal member avatar support.

alter table family_members
  add column if not exists avatar_url text,
  add column if not exists avatar_updated_at timestamptz;

create or replace function update_member_avatar(
  p_member_id uuid,
  p_member_token text,
  p_avatar_url text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_clean_url text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_clean_url := nullif(trim(coalesce(p_avatar_url, '')), '');
  if v_clean_url is not null then
    if length(v_clean_url) > 2048 or v_clean_url !~* '^https?://' then
      raise exception 'invalid_avatar_url';
    end if;
  end if;

  update family_members
     set avatar_url = v_clean_url,
         avatar_updated_at = case when v_clean_url is null then null else now() end,
         updated_at = now(),
         last_active_at = now()
   where id = v_member.id
     and family_id = v_member.family_id
     and status = 'active';

  return v_clean_url;
end;
$$;

grant execute on function update_member_avatar(uuid, text, text) to anon, authenticated;

create or replace function get_personal_dashboard_for_member(
  p_member_id uuid,
  p_member_token text,
  p_today_start timestamptz,
  p_today_end timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_result jsonb;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;
  if p_today_start is null or p_today_end is null or p_today_end <= p_today_start then
    raise exception 'invalid_schedule_range';
  end if;
  if p_now is null then
    raise exception 'invalid_schedule_time';
  end if;

  with visible_items as (
    select s.*,
           creator.nickname as creator_nickname,
           assignee.nickname as assignee_nickname
      from family_schedule_items s
      join family_members creator on creator.id = s.creator_member_id
      join family_members assignee on assignee.id = s.assignee_member_id
     where s.family_id = v_member.family_id
       and s.deleted_at is null
       and (
         s.visibility = 'family'
         or s.creator_member_id = v_member.id
         or s.assignee_member_id = v_member.id
       )
  ),
  today_assigned as (
    select *
      from visible_items
     where assignee_member_id = v_member.id
       and status = 'active'
       and starts_at >= p_today_start
       and starts_at < p_today_end
     order by starts_at asc, id asc
     limit 5
  ),
  upcoming as (
    select *
      from visible_items
     where status = 'active'
       and starts_at >= p_now
       and starts_at < p_now + interval '7 days'
       and not (
         assignee_member_id = v_member.id
         and starts_at >= p_today_start
         and starts_at < p_today_end
       )
     order by starts_at asc, id asc
     limit 8
  ),
  created_by_me as (
    select *
      from visible_items
     where creator_member_id = v_member.id
       and status = 'active'
       and starts_at >= p_now
     order by starts_at asc, id asc
     limit 5
  ),
  recent_done as (
    select *
      from visible_items
     where status = 'done'
       and (
         assignee_member_id = v_member.id
         or creator_member_id = v_member.id
         or completed_by_member_id = v_member.id
       )
     order by completed_at desc nulls last, updated_at desc, id desc
     limit 5
  )
  select jsonb_build_object(
    'profile',
      jsonb_build_object(
        'member_id', v_member.id,
        'nickname', v_member.nickname,
        'role', v_member.role,
        'is_admin', v_member.is_admin,
        'family_id', v_member.family_id,
        'family_name', f.name,
        'avatar_url', fm.avatar_url
      ),
    'today_assigned',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(today_assigned)::jsonb)) from today_assigned), '[]'::jsonb),
    'upcoming',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(upcoming)::jsonb)) from upcoming), '[]'::jsonb),
    'created_by_me',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(created_by_me)::jsonb)) from created_by_me), '[]'::jsonb),
    'recent_done',
      coalesce((select jsonb_agg(schedule_item_json(row_to_json(recent_done)::jsonb)) from recent_done), '[]'::jsonb)
  )
  into v_result
  from families f
  join family_members fm on fm.id = v_member.id
  where f.id = v_member.family_id;

  return v_result;
end;
$$;

grant execute on function get_personal_dashboard_for_member(uuid, text, timestamptz, timestamptz, timestamptz)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260524_member_avatar_profile',
  'member_avatar_profile',
  'Adds member avatar fields and a self-service avatar update RPC.'
)
on conflict (version) do nothing;
