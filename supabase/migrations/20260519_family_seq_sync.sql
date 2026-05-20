alter table messages
  add column if not exists family_seq bigint;

create table if not exists family_message_sequences (
  family_id uuid primary key references families(id) on delete cascade,
  next_seq bigint not null default 1
);

with ranked as (
  select m.id,
         coalesce(existing.max_seq, 0) +
           row_number() over (
             partition by m.family_id
             order by m.created_at asc, m.id asc
           ) as next_family_seq
    from messages m
    left join lateral (
      select max(family_seq) as max_seq
        from messages existing
       where existing.family_id = m.family_id
         and existing.family_seq is not null
    ) existing on true
   where m.family_seq is null
)
update messages m
   set family_seq = ranked.next_family_seq
  from ranked
 where ranked.id = m.id;

create unique index if not exists messages_family_seq_uidx
  on messages (family_id, family_seq)
  where family_seq is not null;

create index if not exists messages_family_seq_idx
  on messages (family_id, family_seq asc);

insert into family_message_sequences (family_id, next_seq)
select f.id, coalesce(max(m.family_seq), 0) + 1
  from families f
  left join messages m on m.family_id = f.id
 group by f.id
on conflict (family_id) do update
   set next_seq = excluded.next_seq
 where family_message_sequences.next_seq < excluded.next_seq;

create or replace function next_family_message_seq(p_family_id uuid)
returns bigint
security definer
set search_path = public, extensions
language sql
as $$
  insert into family_message_sequences (family_id, next_seq)
  values (p_family_id, 2)
  on conflict (family_id) do update
     set next_seq = family_message_sequences.next_seq + 1
  returning next_seq - 1;
$$;

revoke all on function next_family_message_seq(uuid) from public;
revoke all on function next_family_message_seq(uuid) from anon, authenticated;

create or replace function assign_message_family_seq()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
begin
  if new.family_seq is null then
    new.family_seq := next_family_message_seq(new.family_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_message_family_seq on messages;

create trigger trg_assign_message_family_seq
before insert on messages
for each row
execute function assign_message_family_seq();

drop function if exists list_messages_for_member(uuid, text, int);
drop function if exists list_messages_delta(uuid, text, timestamptz, uuid, int);
drop function if exists get_message_for_member(uuid, text, uuid);
drop function if exists get_messages_by_ids_for_member(uuid, text, uuid[]);
drop function if exists list_messages_after_seq(uuid, text, bigint, int);
drop function if exists list_important_notifications_for_member(uuid, text);

create or replace function list_messages_for_member(
  p_member_id uuid,
  p_member_token text,
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
   order by m.created_at desc, m.id desc
   limit v_limit;
end;
$$;

create or replace function list_messages_delta(
  p_member_id uuid,
  p_member_token text,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit int default 300
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

  v_limit := least(greatest(coalesce(p_limit, 300), 1), 300);

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
     and (
       p_cursor_updated_at is null
       or p_cursor_id is null
       or m.updated_at > p_cursor_updated_at
       or (m.updated_at = p_cursor_updated_at and m.id > p_cursor_id)
     )
   order by m.updated_at asc, m.id asc
   limit v_limit;
end;
$$;

create or replace function list_messages_after_seq(
  p_member_id uuid,
  p_member_token text,
  p_after_seq bigint default 0,
  p_limit int default 300
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
  v_after_seq bigint;
  v_limit int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  v_after_seq := greatest(coalesce(p_after_seq, 0), 0);
  v_limit := least(greatest(coalesce(p_limit, 300), 1), 300);

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
     and m.family_seq is not null
     and m.family_seq > v_after_seq
   order by m.family_seq asc, m.id asc
   limit v_limit;
end;
$$;

create or replace function get_message_for_member(
  p_member_id uuid,
  p_member_token text,
  p_message_id uuid
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
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    return;
  end if;

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
     and m.id = p_message_id
   limit 1;
end;
$$;

create or replace function get_messages_by_ids_for_member(
  p_member_id uuid,
  p_member_token text,
  p_message_ids uuid[]
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
  select m.id, m.family_id, m.family_seq, m.sender_member_id, m.recipient_member_id,
         m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload, m.push_requested_at,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from message_recipients mr
    join messages m on m.id = mr.message_id and m.family_id = mr.family_id
   where mr.member_id = v_member.id
     and m.id in (
       select distinct requested.message_id
         from unnest(p_message_ids) as requested(message_id)
        where requested.message_id is not null
     )
   order by m.family_seq asc nulls last, m.created_at asc, m.id asc;
end;
$$;

create or replace function list_important_notifications_for_member(
  p_member_id uuid,
  p_member_token text
)
returns table (
  id uuid,
  family_id uuid,
  message_id uuid,
  created_by_member_id uuid,
  removed_at timestamptz,
  removed_by_member_id uuid,
  created_at timestamptz,
  message_family_id uuid,
  message_family_seq bigint,
  message_sender_member_id uuid,
  message_recipient_member_id uuid,
  message_type text,
  message_content text,
  message_image_url text,
  message_audio_url text,
  message_audio_duration_ms int,
  message_latitude double precision,
  message_longitude double precision,
  message_address text,
  message_map_url text,
  message_effect_id text,
  message_effect_caption text,
  message_system_event_type text,
  message_system_event_payload jsonb,
  message_deleted_at timestamptz,
  message_deleted_by_member_id uuid,
  message_updated_at timestamptz,
  message_created_at timestamptz
)
security definer
set search_path = public, extensions
language plpgsql
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
  select n.id, n.family_id, n.message_id, n.created_by_member_id,
         n.removed_at, n.removed_by_member_id, n.created_at,
         m.family_id, m.family_seq, m.sender_member_id, m.recipient_member_id,
         m.message_type, m.content,
         m.image_url, m.audio_url, m.audio_duration_ms, m.latitude, m.longitude,
         m.address, m.map_url, m.effect_id, m.effect_caption,
         m.system_event_type, m.system_event_payload,
         m.deleted_at, m.deleted_by_member_id, m.updated_at, m.created_at
    from important_notifications n
    join messages m on m.id = n.message_id and m.family_id = n.family_id
    join message_recipients mr
      on mr.message_id = m.id
     and mr.family_id = m.family_id
     and mr.member_id = v_member.id
   where n.family_id = v_member.family_id
     and n.removed_at is null
     and m.recipient_member_id is null
   order by n.created_at desc;
end;
$$;

grant execute on function list_messages_for_member(uuid, text, int) to anon, authenticated;
grant execute on function list_messages_delta(uuid, text, timestamptz, uuid, int) to anon, authenticated;
grant execute on function list_messages_after_seq(uuid, text, bigint, int) to anon, authenticated;
grant execute on function get_message_for_member(uuid, text, uuid) to anon, authenticated;
grant execute on function get_messages_by_ids_for_member(uuid, text, uuid[]) to anon, authenticated;
grant execute on function list_important_notifications_for_member(uuid, text) to anon, authenticated;
