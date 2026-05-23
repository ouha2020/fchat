alter table push_subscriptions
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_reason text;

alter table push_delivery_logs
  add column if not exists attempt_source text,
  add column if not exists skip_reason text;

create index if not exists push_delivery_logs_message_subscription_idx
  on push_delivery_logs (message_id, subscription_id, created_at desc);
