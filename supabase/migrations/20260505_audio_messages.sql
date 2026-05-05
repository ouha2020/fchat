-- 新增语音消息支持：
-- 1) messages 表加 audio_url / audio_duration_ms 列；message_type 枚举增加 'audio'
-- 2) send_message RPC 重载（drop 旧的，create 新签名，多两个音频参数）
-- 3) 创建 chat-audios 公共 Storage bucket，给 anon 读 + 上传策略

alter table messages
  add column if not exists audio_url text,
  add column if not exists audio_duration_ms int;

alter table messages drop constraint if exists messages_message_type_check;
alter table messages add constraint messages_message_type_check
  check (message_type in ('text', 'image', 'audio', 'location', 'system'));

drop function if exists send_message(uuid, text, text, text, text, double precision, double precision, text, text);

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
  p_map_url text default null
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
    latitude, longitude, address, map_url
  )
  values (
    v_family_id, p_member_id, p_message_type,
    p_content, p_image_url, p_audio_url, p_audio_duration_ms,
    p_latitude, p_longitude, p_address, p_map_url
  )
  returning id into v_message_id;

  update family_members
     set last_active_at = now()
   where id = p_member_id;

  return v_message_id;
end;
$$;

grant execute on function send_message(uuid, text, text, text, text, text, int, double precision, double precision, text, text) to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('chat-audios', 'chat-audios', true)
on conflict (id) do nothing;

drop policy if exists "chat-audios public read" on storage.objects;
create policy "chat-audios public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'chat-audios');

drop policy if exists "chat-audios anon upload" on storage.objects;
create policy "chat-audios anon upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'chat-audios');
