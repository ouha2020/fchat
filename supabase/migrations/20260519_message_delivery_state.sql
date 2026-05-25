create index if not exists message_recipients_member_delivery_idx
  on message_recipients (member_id, delivery_state, created_at desc);

create index if not exists message_recipients_pending_notify_idx
  on message_recipients (family_id, delivery_state, notified_at)
  where delivery_state = 'pending';

create or replace function mark_messages_delivered(
  p_member_id uuid,
  p_member_token text,
  p_message_ids uuid[]
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_count int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if p_message_ids is null or cardinality(p_message_ids) = 0 then
    return;
  end if;

  v_count := cardinality(p_message_ids);
  if v_count > 300 then
    raise exception 'too_many_message_ids';
  end if;

  update message_recipients mr
     set delivery_state = 'delivered',
         delivered_at = coalesce(mr.delivered_at, now())
    from (
      select distinct requested.message_id
        from unnest(p_message_ids) as requested(message_id)
       where requested.message_id is not null
    ) requested
   where mr.member_id = v_member.id
     and mr.family_id = v_member.family_id
     and mr.message_id = requested.message_id
     and mr.delivery_state = 'pending';
end;
$$;

create or replace function mark_messages_read(
  p_member_id uuid,
  p_member_token text,
  p_message_ids uuid[]
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_count int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if p_message_ids is null or cardinality(p_message_ids) = 0 then
    return;
  end if;

  v_count := cardinality(p_message_ids);
  if v_count > 300 then
    raise exception 'too_many_message_ids';
  end if;

  update message_recipients mr
     set delivery_state = 'read',
         delivered_at = coalesce(mr.delivered_at, now()),
         read_at = coalesce(mr.read_at, now())
    from (
      select distinct requested.message_id
        from unnest(p_message_ids) as requested(message_id)
       where requested.message_id is not null
    ) requested
   where mr.member_id = v_member.id
     and mr.family_id = v_member.family_id
     and mr.message_id = requested.message_id
     and (mr.delivery_state <> 'read' or mr.read_at is null);
end;
$$;

create or replace function get_unread_count_for_member(
  p_member_id uuid,
  p_member_token text
)
returns int
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_count int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select count(*)::int into v_count
    from message_recipients mr
    join messages m
      on m.id = mr.message_id
     and m.family_id = mr.family_id
   where mr.member_id = v_member.id
     and mr.family_id = v_member.family_id
     and mr.read_at is null
     and coalesce(m.sender_member_id, '00000000-0000-0000-0000-000000000000'::uuid)
         <> v_member.id;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function mark_messages_delivered(uuid, text, uuid[]) to anon, authenticated;
grant execute on function mark_messages_read(uuid, text, uuid[]) to anon, authenticated;
grant execute on function get_unread_count_for_member(uuid, text) to anon, authenticated;
