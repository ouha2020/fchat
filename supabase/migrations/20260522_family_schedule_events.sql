-- Family schedule realtime events: lightweight per-member sync signals.

create table if not exists family_schedule_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_item_id uuid not null references family_schedule_items(id) on delete cascade,
  recipient_member_id uuid not null references family_members(id) on delete cascade,
  event_type text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'family_schedule_events_event_type_check'
       and conrelid = 'family_schedule_events'::regclass
  ) then
    alter table family_schedule_events
      add constraint family_schedule_events_event_type_check
      check (event_type in (
        'created',
        'updated',
        'status_changed',
        'deleted',
        'reminder_updated'
      ));
  end if;
end;
$$;

create index if not exists family_schedule_events_recipient_created_idx
  on family_schedule_events (recipient_member_id, created_at desc);

create index if not exists family_schedule_events_item_idx
  on family_schedule_events (schedule_item_id, created_at desc);

create index if not exists family_schedule_events_cleanup_idx
  on family_schedule_events (created_at);

alter table family_schedule_events enable row level security;
revoke all on family_schedule_events from anon, authenticated;
grant select on family_schedule_events to anon, authenticated;

drop policy if exists "family schedule events are realtime signals" on family_schedule_events;
create policy "family schedule events are realtime signals"
  on family_schedule_events for select
  to anon, authenticated
  using (true);

create or replace function enqueue_schedule_realtime_events()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'created';

    insert into family_schedule_events (
      family_id, schedule_item_id, recipient_member_id, event_type
    )
    select new.family_id, new.id, recipients.member_id, v_event_type
      from (
        select distinct fm.id as member_id
          from family_members fm
         where fm.family_id = new.family_id
           and fm.status = 'active'
           and (
             new.visibility = 'family'
             or fm.id in (new.creator_member_id, new.assignee_member_id)
           )
      ) recipients;

    delete from family_schedule_events
     where created_at < now() - interval '1 day';

    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    v_event_type := 'deleted';
  elsif old.status is distinct from new.status and new.status = 'cancelled' then
    v_event_type := 'deleted';
  elsif old.status is distinct from new.status then
    v_event_type := 'status_changed';
  elsif old.remind_at is distinct from new.remind_at then
    v_event_type := 'reminder_updated';
  elsif old.title is distinct from new.title
     or old.note is distinct from new.note
     or old.item_type is distinct from new.item_type
     or old.visibility is distinct from new.visibility
     or old.starts_at is distinct from new.starts_at
     or old.ends_at is distinct from new.ends_at
     or old.assignee_member_id is distinct from new.assignee_member_id then
    v_event_type := 'updated';
  else
    return new;
  end if;

  insert into family_schedule_events (
    family_id, schedule_item_id, recipient_member_id, event_type
  )
  select new.family_id, new.id, recipients.member_id, v_event_type
    from (
      select distinct fm.id as member_id
        from family_members fm
       where fm.family_id = new.family_id
         and fm.status = 'active'
         and (
           (
             new.visibility = 'family'
             or fm.id in (new.creator_member_id, new.assignee_member_id)
           )
           or (
             old.visibility = 'family'
             or fm.id in (old.creator_member_id, old.assignee_member_id)
           )
         )
    ) recipients;

  delete from family_schedule_events
   where created_at < now() - interval '1 day';

  return new;
end;
$$;

drop trigger if exists trg_family_schedule_realtime_events on family_schedule_items;

create trigger trg_family_schedule_realtime_events
after insert or update on family_schedule_items
for each row
execute function enqueue_schedule_realtime_events();

create or replace function delete_old_schedule_events()
returns int
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_deleted int;
begin
  delete from family_schedule_events
   where created_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function delete_old_schedule_events() from public;
grant execute on function delete_old_schedule_events() to service_role;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'family_schedule_events'
  ) then
    execute 'alter publication supabase_realtime add table family_schedule_events';
  end if;
end $$;
