-- Harden message writes against malformed URLs, oversized text payloads, and
-- invalid media/location metadata. Supabase client calls are parameterized, so
-- this is defense in depth for direct RPC callers with a valid member token.

create or replace function send_message(
  p_member_id uuid,
  p_member_token text,
  p_message_type text,
  p_content text default null,
  p_image_url text default null,
  p_audio_url text default null,
  p_audio_duration_ms int default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_address text default null,
  p_map_url text default null,
  p_effect_id text default null,
  p_effect_caption text default null
)
returns uuid
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
  v_message_id uuid;
begin
  if p_message_type not in ('text', 'image', 'audio', 'location') then
    raise exception 'invalid_message_type';
  end if;
  if length(coalesce(p_content, '')) > 2000 then
    raise exception 'message_too_long';
  end if;
  if length(coalesce(p_address, '')) > 500 then
    raise exception 'message_too_long';
  end if;
  if length(coalesce(p_effect_caption, '')) > 120 then
    raise exception 'message_too_long';
  end if;
  if p_image_url is not null and (
    length(p_image_url) > 2048 or p_image_url !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception 'invalid_image_url';
  end if;
  if p_audio_url is not null and (
    length(p_audio_url) > 2048 or p_audio_url !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception 'invalid_audio_url';
  end if;
  if p_map_url is not null and (
    length(p_map_url) > 2048 or p_map_url !~* '^https://[^[:space:]]+$'
  ) then
    raise exception 'invalid_location';
  end if;
  if p_message_type = 'image' and p_image_url is null then
    raise exception 'invalid_image_url';
  end if;
  if p_message_type = 'audio' and (
    p_audio_url is null or p_audio_duration_ms is null or
    p_audio_duration_ms < 0 or p_audio_duration_ms > 600000
  ) then
    raise exception 'invalid_audio_url';
  end if;
  if p_message_type = 'location' and (
    p_latitude is null or p_longitude is null or
    p_latitude < -90 or p_latitude > 90 or
    p_longitude < -180 or p_longitude > 180
  ) then
    raise exception 'invalid_location';
  end if;
  if p_effect_id is not null and p_effect_id not in
       ('hearts', 'fireworks', 'confetti', 'money', 'sparkles', 'cake') then
    raise exception 'invalid_effect_id';
  end if;

  select family_id into v_family_id
    from family_members
   where id = p_member_id
     and member_token_hash = hash_secret(p_member_token)
     and status = 'active';

  if v_family_id is null then
    raise exception 'unauthorized';
  end if;

  insert into messages (
    family_id, sender_member_id, message_type,
    content, image_url, audio_url, audio_duration_ms,
    latitude, longitude, address, map_url,
    effect_id, effect_caption
  )
  values (
    v_family_id, p_member_id, p_message_type,
    p_content, p_image_url, p_audio_url, p_audio_duration_ms,
    p_latitude, p_longitude, p_address, p_map_url,
    p_effect_id, p_effect_caption
  )
  returning id into v_message_id;

  update family_members
     set last_active_at = now()
   where id = p_member_id;

  return v_message_id;
end;
$$;

grant execute on function send_message(uuid, text, text, text, text, text, int, double precision, double precision, text, text, text, text) to anon, authenticated;
