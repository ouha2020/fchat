-- Push delivery logs for diagnostics and cost tracking.
-- Success logs auto-expire after 7 days; failure logs kept 30 days.

create table if not exists push_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  subscription_id uuid references push_subscriptions(id) on delete set null,
  member_id uuid references family_members(id) on delete set null,
  endpoint text,
  status text not null check (status in ('sent', 'failed', 'gone', 'skipped')),
  error_code text,
  error_message text,
  retry_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists push_delivery_logs_family_created_idx
  on push_delivery_logs (family_id, created_at desc);

create index if not exists push_delivery_logs_subscription_idx
  on push_delivery_logs (subscription_id, created_at desc);

create index if not exists push_delivery_logs_created_idx
  on push_delivery_logs (created_at);

alter table push_delivery_logs enable row level security;

revoke all on push_delivery_logs from anon, authenticated;
grant select on push_delivery_logs to anon, authenticated;

drop policy if exists "push delivery logs are readable by anon" on push_delivery_logs;
create policy "push delivery logs are readable by anon"
  on push_delivery_logs for select
  to anon, authenticated
  using (true);

-- Periodic cleanup: remove sent/skipped logs older than 7 days,
-- and failed/gone logs older than 30 days.
create or replace function cleanup_push_delivery_logs()
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
begin
  delete from push_delivery_logs
   where status in ('sent', 'skipped')
     and created_at < now() - interval '7 days';

  delete from push_delivery_logs
   where status in ('failed', 'gone')
     and created_at < now() - interval '30 days';
end;
$$;

grant execute on function cleanup_push_delivery_logs() to anon, authenticated;
