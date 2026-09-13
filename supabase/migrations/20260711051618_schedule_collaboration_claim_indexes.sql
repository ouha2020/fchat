create index if not exists family_schedule_collaboration_claims_schedule_item_idx
  on family_schedule_collaboration_push_claims (schedule_item_id);

create index if not exists family_schedule_collaboration_claims_actor_member_idx
  on family_schedule_collaboration_push_claims (actor_member_id);

insert into app_schema_migrations (version, name, description)
values (
  '20260711051618_schedule_collaboration_claim_indexes',
  'schedule_collaboration_claim_indexes',
  'Adds covering indexes for schedule and actor foreign keys on collaboration Push claims.'
)
on conflict (version) do nothing;
