-- Personal photo albums curated from public chat images. Each member owns an
-- album; entries are added from the chat image action menu. All access goes
-- through SECURITY DEFINER RPCs (the table has RLS on with no direct grants).

create table if not exists album_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  owner_member_id uuid not null references family_members(id) on delete cascade,
  image_ref text not null,
  source_message_id uuid references messages(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (owner_member_id, image_ref)
);

create index if not exists album_items_owner_created_idx
  on album_items (owner_member_id, created_at desc);

create index if not exists album_items_family_ref_idx
  on album_items (family_id, image_ref);

alter table album_items enable row level security;

-- Add a public (non-whisper) chat image from the caller's family to the
-- caller's own album. Idempotent on (owner, image_ref).
create or replace function add_album_item(
  p_member_id uuid,
  p_member_token text,
  p_image_ref text,
  p_source_message_id uuid default null
)
returns uuid
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_message messages%rowtype;
  v_item_id uuid;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if p_image_ref is null or length(btrim(p_image_ref)) = 0 then
    raise exception 'invalid_album_image';
  end if;
  if p_source_message_id is null then
    raise exception 'invalid_album_image';
  end if;

  select * into v_message
    from messages
   where id = p_source_message_id
     and family_id = v_member.family_id;
  if not found
     or v_message.message_type <> 'image'
     or v_message.deleted_at is not null
     or v_message.recipient_member_id is not null
     or coalesce(v_message.image_url, '') <> p_image_ref then
    raise exception 'invalid_album_image';
  end if;

  insert into album_items (family_id, owner_member_id, image_ref, source_message_id)
  values (v_member.family_id, p_member_id, p_image_ref, p_source_message_id)
  on conflict (owner_member_id, image_ref)
    do update set source_message_id = excluded.source_message_id
  returning id into v_item_id;

  return v_item_id;
end;
$$;

-- List a family member's album. Any member of the same family may view it.
create or replace function list_album_items(
  p_member_id uuid,
  p_member_token text,
  p_owner_member_id uuid
)
returns table (
  id uuid,
  owner_member_id uuid,
  image_ref text,
  source_message_id uuid,
  created_at timestamptz
)
security definer
set search_path = public, extensions
language plpgsql
as $$
#variable_conflict use_column
declare
  v_member record;
  v_owner family_members%rowtype;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_owner from family_members where id = p_owner_member_id;
  if not found or v_owner.family_id <> v_member.family_id then
    raise exception 'forbidden';
  end if;

  return query
    select ai.id, ai.owner_member_id, ai.image_ref, ai.source_message_id, ai.created_at
      from album_items ai
     where ai.owner_member_id = p_owner_member_id
       and ai.family_id = v_member.family_id
     order by ai.created_at desc;
end;
$$;

-- Remove one of the caller's own album items.
create or replace function remove_album_item(
  p_member_id uuid,
  p_member_token text,
  p_item_id uuid
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_member record;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  delete from album_items
   where id = p_item_id
     and owner_member_id = p_member_id;
end;
$$;

grant execute on function add_album_item(uuid, text, text, uuid) to anon, authenticated;
grant execute on function list_album_items(uuid, text, uuid) to anon, authenticated;
grant execute on function remove_album_item(uuid, text, uuid) to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260705_personal_albums',
  'personal_albums',
  'Per-member photo albums curated from public chat images.'
)
on conflict (version) do nothing;
