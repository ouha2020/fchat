drop function if exists get_messages_by_ids_for_member(uuid, text, uuid[]);

create or replace function get_messages_by_ids_for_member(
  p_member_id uuid,
  p_member_token text,
  p_message_ids uuid[]
)
returns table (
  id uuid,
  family_id uuid,
  sender_member_id uuid,
  recipient_member_id uuid,
  message_type text,
  content text,
  image_url text,
  audio_url text,
  audio_duration_ms int,
  latitude double precision,
  longitude double precision,
  address text,
  map_url text,
  effect_id text,
  effect_caption text,
  system_event_type text,
  system_event_payload jsonb,
  push_requested_at timestamptz,
  deleted_at timestamptz,
  deleted_by_member_id uuid,
  updated_at timestamptz,
  created_at timestamptz
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_count int;
begin
  if p_message_ids is null or cardinality(p_message_ids) = 0 then
    return;
  end if;

  v_count := cardinality(p_message_ids);
  if v_count > 100 then
    raise exception 'too_many_message_ids';
  end if;

  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    return;
  end if;

  return query
  select m.id, m.family_id, m.sender_member_id, m.recipient_member_id,
         m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload, m.push_requested_at,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from messages m
   where m.id in (
       select distinct requested.message_id
         from unnest(p_message_ids) as requested(message_id)
        where requested.message_id is not null
     )
     and m.family_id = v_member.family_id
     and (
       m.recipient_member_id is null
       or m.sender_member_id = v_member.id
       or m.recipient_member_id = v_member.id
     )
   order by m.created_at asc, m.id asc;
end;
$$;

grant execute on function get_messages_by_ids_for_member(uuid, text, uuid[]) to anon, authenticated;
