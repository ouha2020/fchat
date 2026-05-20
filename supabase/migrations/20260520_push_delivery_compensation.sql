alter table push_delivery_logs
  add column if not exists error_status int,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_attempt_at timestamptz;

create index if not exists push_delivery_logs_retry_idx
  on push_delivery_logs (status, next_retry_at)
  where status = 'failed';

create index if not exists push_delivery_logs_message_member_idx
  on push_delivery_logs (message_id, member_id, created_at desc);

drop policy if exists "push delivery logs are readable by anon" on push_delivery_logs;
drop policy if exists "push delivery logs are rpc only" on push_delivery_logs;
create policy "push delivery logs are rpc only"
  on push_delivery_logs for select
  to anon, authenticated
  using (false);

revoke select on push_delivery_logs from anon, authenticated;
