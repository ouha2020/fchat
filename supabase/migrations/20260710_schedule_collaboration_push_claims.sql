-- Bind each collaboration Push to one recent, authenticated schedule event.
-- The unique evidence indexes make client retries idempotent without putting
-- schedule titles, notes, media, or other private content into the Push layer.

create table if not exists family_schedule_collaboration_push_claims (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_item_id uuid not null references family_schedule_items(id) on delete cascade,
  actor_member_id uuid not null references family_members(id) on delete cascade,
  event_type text not null,
  activity_log_id uuid references family_schedule_activity_logs(id) on delete cascade,
  context_event_id uuid references family_context_events(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint family_schedule_collaboration_push_claims_event_type_check
    check (event_type in ('created', 'assigned', 'accepted', 'declined', 'commented')),
  constraint family_schedule_collaboration_push_claims_evidence_check
    check (
      (
        activity_log_id is not null
        and context_event_id is null
        and event_type in ('created', 'assigned', 'accepted', 'declined')
      )
      or (
        activity_log_id is null
        and context_event_id is not null
        and event_type = 'commented'
      )
    )
);

create unique index if not exists family_schedule_collaboration_push_claims_activity_uidx
  on family_schedule_collaboration_push_claims (activity_log_id)
  where activity_log_id is not null;

create unique index if not exists family_schedule_collaboration_push_claims_context_uidx
  on family_schedule_collaboration_push_claims (context_event_id)
  where context_event_id is not null;

create index if not exists family_schedule_collaboration_push_claims_family_created_idx
  on family_schedule_collaboration_push_claims (family_id, created_at desc);

alter table family_schedule_collaboration_push_claims enable row level security;
revoke all on family_schedule_collaboration_push_claims from anon, authenticated;

drop policy if exists "schedule collaboration push claims are service only"
  on family_schedule_collaboration_push_claims;
create policy "schedule collaboration push claims are service only"
  on family_schedule_collaboration_push_claims
  for select
  to anon, authenticated
  using (false);

insert into app_schema_migrations (version, name, description)
values (
  '20260710_schedule_collaboration_push_claims',
  'schedule_collaboration_push_claims',
  'Binds schedule collaboration Push delivery to recent activity/context evidence and deduplicates retries.'
)
on conflict (version) do nothing;
