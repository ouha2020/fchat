-- Back-fill older chat history: keyset-paginated fetch of messages strictly
-- older than the given (created_at, id) cursor, newest-first. Visibility is
-- inherited from message_recipients like list_messages_for_member, so
-- whispers stay scoped to their sender/recipient.
create or replace function list_messages_before(
  p_member_id uuid,
  p_member_token text,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit int default 100
)
returns table (
  id uuid,
  family_id uuid,
  family_seq bigint,
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
  v_limit int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if p_before_created_at is null or p_before_id is null then
    raise exception 'invalid_cursor';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 300);

  return query
  select m.id, m.family_id, m.family_seq, m.sender_member_id, m.recipient_member_id,
         m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload, m.push_requested_at,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from message_recipients mr
    join messages m on m.id = mr.message_id and m.family_id = mr.family_id
   where mr.member_id = v_member.id
     and (m.created_at, m.id) < (p_before_created_at, p_before_id)
   order by m.created_at desc, m.id desc
   limit v_limit;
end;
$$;

grant execute on function list_messages_before(uuid, text, timestamptz, uuid, int) to anon, authenticated;
