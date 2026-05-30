-- family_message_sequences is an internal counter table used by
-- SECURITY DEFINER message sequencing functions. Public clients must not
-- access it directly through the Data API.

alter table public.family_message_sequences enable row level security;

revoke all on table public.family_message_sequences from public;
revoke all on table public.family_message_sequences from anon, authenticated;

grant all on table public.family_message_sequences to service_role;
