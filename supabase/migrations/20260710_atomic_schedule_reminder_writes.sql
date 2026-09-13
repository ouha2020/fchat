-- Keep schedule item changes and reminder-rule changes in one transaction.
-- The existing RPCs remain available for backward compatibility; clients that
-- edit both surfaces should use these wrappers to avoid partial success.

create or replace function create_schedule_item_with_reminder_rules(
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
  p_recurrence_rule text,
  p_reminder_offsets int[]
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_item_id uuid;
  v_rule text;
begin
  v_rule := coalesce(nullif(trim(coalesce(p_recurrence_rule, '')), ''), 'none');
  v_item_id := create_schedule_item(
    p_member_id,
    p_member_token,
    p_title,
    p_note,
    p_item_type,
    p_visibility,
    p_starts_at,
    p_ends_at,
    p_remind_at,
    p_assignee_member_id,
    v_rule
  );

  if coalesce(cardinality(p_reminder_offsets), 0) > 1 then
    perform set_schedule_reminder_rules(
      p_member_id,
      p_member_token,
      v_item_id,
      p_reminder_offsets,
      case when v_rule = 'none' then 'single' else 'all' end
    );
  end if;

  return v_item_id;
end;
$$;

create or replace function update_schedule_item_with_reminder_rules(
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
  p_recurrence_scope text,
  p_reminder_offsets int[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  -- Clear/replace old rule rows first. The following item update restores a
  -- custom p_remind_at when no standard offsets were supplied.
  perform set_schedule_reminder_rules(
    p_member_id,
    p_member_token,
    p_item_id,
    coalesce(p_reminder_offsets, '{}'::int[]),
    p_recurrence_scope
  );

  perform update_schedule_item(
    p_member_id,
    p_member_token,
    p_item_id,
    p_title,
    p_note,
    p_item_type,
    p_visibility,
    p_assignee_member_id,
    p_starts_at,
    p_ends_at,
    p_remind_at,
    p_recurrence_scope
  );
end;
$$;

create or replace function replace_schedule_item_recurrence_with_reminder_rules(
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
  p_recurrence_scope text,
  p_reminder_offsets int[]
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_item_id uuid;
  v_rule text;
begin
  v_rule := coalesce(nullif(trim(coalesce(p_recurrence_rule, '')), ''), 'none');
  v_item_id := replace_schedule_item_recurrence(
    p_member_id,
    p_member_token,
    p_item_id,
    p_title,
    p_note,
    p_item_type,
    p_visibility,
    p_assignee_member_id,
    p_starts_at,
    p_ends_at,
    p_remind_at,
    v_rule,
    p_recurrence_scope
  );

  if coalesce(cardinality(p_reminder_offsets), 0) > 1 then
    perform set_schedule_reminder_rules(
      p_member_id,
      p_member_token,
      v_item_id,
      p_reminder_offsets,
      case when v_rule = 'none' then 'single' else 'all' end
    );
  end if;

  return v_item_id;
end;
$$;

grant execute on function create_schedule_item_with_reminder_rules(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  timestamptz, uuid, text, int[]
) to anon, authenticated;

grant execute on function update_schedule_item_with_reminder_rules(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz,
  timestamptz, timestamptz, text, int[]
) to anon, authenticated;

grant execute on function replace_schedule_item_recurrence_with_reminder_rules(
  uuid, text, uuid, text, text, text, text, uuid, timestamptz,
  timestamptz, timestamptz, text, text, int[]
) to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260710_atomic_schedule_reminder_writes',
  'atomic_schedule_reminder_writes',
  'Writes schedule items and reminder rules in one transaction for create, update, and recurrence replacement.'
)
on conflict (version) do nothing;
