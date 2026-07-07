-- Only allow newly sent chat image/audio messages to reference family-scoped
-- storage objects. Existing legacy public URLs remain readable through the
-- message read path, but new sends cannot introduce arbitrary external media.

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
  p_effect_caption text default null,
  p_recipient_member_id uuid default null
)
returns uuid
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_recipient family_members%rowtype;
  v_message_id uuid;
  v_image_ref_prefix text;
  v_audio_ref_prefix text;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_image_ref_prefix := 'storage://chat-images/family/' || v_member.family_id::text || '/';
  v_audio_ref_prefix := 'storage://chat-audios/family/' || v_member.family_id::text || '/';

  if p_recipient_member_id is not null then
    if p_recipient_member_id = p_member_id then
      raise exception 'cannot_whisper_self';
    end if;

    select * into v_recipient
      from family_members
     where id = p_recipient_member_id
       and family_id = v_member.family_id
       and status = 'active';
    if not found then
      raise exception 'member_not_found';
    end if;
  end if;

  if p_message_type not in ('text', 'image', 'audio', 'location') then
    raise exception 'invalid_message_type';
  end if;
  if p_content is not null and (length(trim(p_content)) = 0 or length(p_content) > 1000) then
    raise exception 'message_too_long';
  end if;
  if length(coalesce(p_address, '')) > 500 or length(coalesce(p_effect_caption, '')) > 120 then
    raise exception 'message_too_long';
  end if;
  if p_image_url is not null and (
    length(p_image_url) > 2048 or not (
      p_image_url like v_image_ref_prefix || '%'
      and p_image_url !~ '\.\.'
      and p_image_url ~ '^storage://chat-images/[A-Za-z0-9/_.$-]+$'
    )
  ) then
    raise exception 'invalid_image_url';
  end if;
  if p_audio_url is not null and (
    length(p_audio_url) > 2048 or not (
      p_audio_url like v_audio_ref_prefix || '%'
      and p_audio_url !~ '\.\.'
      and p_audio_url ~ '^storage://chat-audios/[A-Za-z0-9/_.$-]+$'
    )
  ) then
    raise exception 'invalid_audio_url';
  end if;
  if p_map_url is not null and (
    length(p_map_url) > 2048 or p_map_url !~* '^https://[^[:space:]]+$'
  ) then
    raise exception 'invalid_location';
  end if;
  if p_message_type = 'text' and (p_content is null or length(trim(p_content)) = 0) then
    raise exception 'message_too_long';
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

  insert into messages (
    family_id, sender_member_id, recipient_member_id, message_type,
    content, image_url, audio_url, audio_duration_ms,
    latitude, longitude, address, map_url,
    effect_id, effect_caption
  )
  values (
    v_member.family_id, p_member_id, p_recipient_member_id, p_message_type,
    p_content, p_image_url, p_audio_url, p_audio_duration_ms,
    p_latitude, p_longitude, p_address, p_map_url,
    p_effect_id, p_effect_caption
  )
  returning id into v_message_id;

  update family_members
     set last_active_at = now(),
         last_seen_at = now(),
         updated_at = now()
   where id = p_member_id;

  return v_message_id;
end;
$$;

grant execute on function send_message(uuid, text, text, text, text, text, int, double precision, double precision, text, text, text, text, uuid)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260707_harden_chat_media_refs',
  'harden_chat_media_refs',
  'Restricts newly sent chat image and audio refs to family-scoped storage objects.'
)
on conflict (version) do nothing;
