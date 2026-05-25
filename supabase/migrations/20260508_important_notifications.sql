create table if not exists important_notifications (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  created_by_member_id uuid references family_members(id) on delete set null,
  removed_at timestamptz,
  removed_by_member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists important_notifications_active_message_idx
  on important_notifications (family_id, message_id)
  where removed_at is null;

create index if not exists important_notifications_family_created_at_idx
  on important_notifications (family_id, created_at desc)
  where removed_at is null;

alter table important_notifications replica identity full;

create or replace function add_important_notification(
  p_member_id uuid,
  p_member_token text,
  p_message_id uuid
)
returns uuid
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_member family_members%rowtype;
  v_message messages%rowtype;
  v_notification_id uuid;
begin
  select * into v_member
    from family_members
   where id = p_member_id
     and member_token_hash = hash_secret(p_member_token)
     and status = 'active';
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_message
    from messages
   where id = p_message_id
     and family_id = v_member.family_id;
  if not found then
    raise exception 'message_not_found';
  end if;

  select id into v_notification_id
    from important_notifications
   where family_id = v_member.family_id
     and message_id = p_message_id
     and removed_at is null
   limit 1;

  if v_notification_id is not null then
    return v_notification_id;
  end if;

  insert into important_notifications (
    family_id, message_id, created_by_member_id
  )
  values (
    v_member.family_id, p_message_id, p_member_id
  )
  returning id into v_notification_id;

  update family_members
     set last_active_at = now()
   where id = p_member_id;

  return v_notification_id;
end;
$$;

create or replace function remove_important_notification(
  p_member_id uuid,
  p_member_token text,
  p_notification_id uuid
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_member family_members%rowtype;
  v_notification important_notifications%rowtype;
begin
  select * into v_member
    from family_members
   where id = p_member_id
     and member_token_hash = hash_secret(p_member_token)
     and status = 'active';
  if not found then
    raise exception 'unauthorized';
  end if;

  select * into v_notification
    from important_notifications
   where id = p_notification_id
     and family_id = v_member.family_id;
  if not found then
    raise exception 'important_notification_not_found';
  end if;

  if v_notification.removed_at is null then
    update important_notifications
       set removed_at = now(),
           removed_by_member_id = p_member_id
     where id = p_notification_id;
  end if;

  update family_members
     set last_active_at = now()
   where id = p_member_id;
end;
$$;

grant execute on function add_important_notification(uuid, text, uuid) to anon, authenticated;
grant execute on function remove_important_notification(uuid, text, uuid) to anon, authenticated;

alter table important_notifications enable row level security;

drop policy if exists "important notifications are readable by anon" on important_notifications;
create policy "important notifications are readable by anon"
  on important_notifications for select
  to anon, authenticated
  using (true);

grant select on important_notifications to anon, authenticated;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and tablename = 'important_notifications'
  ) then
    execute 'alter publication supabase_realtime add table important_notifications';
  end if;
end
$$;
