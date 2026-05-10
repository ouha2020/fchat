-- Low-resource PWA Web Push support.
-- Push state is handled by Next.js API routes with the service role key.

alter table messages
  add column if not exists push_requested_at timestamptz;

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text not null default 'unknown'
    check (platform in ('ios', 'android', 'desktop', 'unknown')),
  enabled boolean not null default true,
  messages_enabled boolean not null default true,
  location_enabled boolean not null default true,
  important_enabled boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, endpoint)
);

create index if not exists push_subscriptions_family_member_idx
  on push_subscriptions (family_id, member_id)
  where enabled = true;

create table if not exists user_presence (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  current_page text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, member_id)
);

create index if not exists user_presence_family_active_idx
  on user_presence (family_id, current_page, is_active, last_seen_at desc);

alter table push_subscriptions enable row level security;
alter table user_presence enable row level security;

revoke all on push_subscriptions from anon, authenticated;
revoke all on user_presence from anon, authenticated;
