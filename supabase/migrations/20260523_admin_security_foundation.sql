-- Management admin security foundation.
-- Admin identities are Supabase Auth users, authorized separately here.

alter table families
  add column if not exists is_disabled boolean not null default false,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_reason text,
  add column if not exists disabled_by_admin_id uuid;

create index if not exists families_disabled_created_idx
  on families (is_disabled, created_at desc);

alter table messages
  add column if not exists admin_deleted_by_admin_id uuid,
  add column if not exists admin_deleted_reason text;

create table if not exists admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'readonly'
    check (role in ('super_admin', 'operator', 'readonly')),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists admin_role_permissions (
  role text not null check (role in ('super_admin', 'operator', 'readonly')),
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (role, permission)
);

create table if not exists admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references admin_profiles(id) on delete set null,
  admin_email text,
  admin_role text not null default 'unknown',
  action text not null,
  target_type text not null,
  target_id text not null,
  family_id uuid references families(id) on delete set null,
  reason text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on admin_audit_logs (created_at desc);

create index if not exists admin_audit_logs_family_created_idx
  on admin_audit_logs (family_id, created_at desc)
  where family_id is not null;

create index if not exists admin_audit_logs_admin_created_idx
  on admin_audit_logs (admin_id, created_at desc)
  where admin_id is not null;

create index if not exists admin_audit_logs_action_created_idx
  on admin_audit_logs (action, created_at desc);

create table if not exists admin_metric_snapshots (
  snapshot_key text primary key default 'latest',
  period_start timestamptz not null,
  period_end timestamptz not null,
  recent_messages_24h int not null default 0,
  active_families_today int not null default 0,
  push_sent_24h int not null default 0,
  push_failed_24h int not null default 0,
  push_success_rate numeric(6, 5) not null default 0,
  upload_bytes_24h bigint not null default 0,
  generated_at timestamptz not null default now(),
  constraint admin_metric_snapshots_singleton check (snapshot_key = 'latest')
);

create table if not exists storage_upload_logs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references families(id) on delete set null,
  member_id uuid references family_members(id) on delete set null,
  bucket_id text not null,
  object_path text not null,
  mime_type text,
  byte_size bigint not null default 0,
  cleanup_status text not null default 'active'
    check (cleanup_status in ('active', 'marked_for_cleanup', 'cleaned')),
  cleanup_reason text,
  cleanup_marked_at timestamptz,
  cleanup_marked_by_admin_id uuid references admin_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table storage_upload_logs
  add column if not exists cleanup_status text not null default 'active',
  add column if not exists cleanup_reason text,
  add column if not exists cleanup_marked_at timestamptz,
  add column if not exists cleanup_marked_by_admin_id uuid references admin_profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'storage_upload_logs_cleanup_status_check'
       and conrelid = 'storage_upload_logs'::regclass
  ) then
    alter table storage_upload_logs
      add constraint storage_upload_logs_cleanup_status_check
      check (cleanup_status in ('active', 'marked_for_cleanup', 'cleaned'));
  end if;
end;
$$;

create index if not exists storage_upload_logs_family_created_idx
  on storage_upload_logs (family_id, created_at desc);

create index if not exists storage_upload_logs_created_idx
  on storage_upload_logs (created_at desc);

create index if not exists storage_upload_logs_cleanup_status_idx
  on storage_upload_logs (cleanup_status, created_at desc);

alter table admin_profiles enable row level security;
alter table admin_role_permissions enable row level security;
alter table admin_audit_logs enable row level security;
alter table admin_metric_snapshots enable row level security;
alter table storage_upload_logs enable row level security;

revoke all on admin_profiles from anon, authenticated;
revoke all on admin_role_permissions from anon, authenticated;
revoke all on admin_audit_logs from anon, authenticated;
revoke all on admin_metric_snapshots from anon, authenticated;
revoke all on storage_upload_logs from anon, authenticated;

grant select, insert, update on admin_profiles to service_role;
grant select, insert, update, delete on admin_role_permissions to service_role;
grant select, insert on admin_audit_logs to service_role;
grant select, insert, update, delete on admin_metric_snapshots to service_role;
grant select, insert, update on storage_upload_logs to service_role;

create or replace function prevent_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  raise exception 'admin_audit_logs_append_only';
end;
$$;

drop trigger if exists trg_admin_audit_logs_append_only on admin_audit_logs;
create trigger trg_admin_audit_logs_append_only
before update or delete on admin_audit_logs
for each row execute function prevent_admin_audit_mutation();

insert into admin_role_permissions (role, permission)
select role, permission
from (
  values
    ('readonly', 'admin.session'),
    ('readonly', 'dashboard.read'),
    ('readonly', 'audit.read'),
    ('readonly', 'system_health.read'),
    ('readonly', 'family.read'),
    ('readonly', 'member.read'),
    ('readonly', 'message.read_metadata'),
    ('readonly', 'push.read'),
    ('readonly', 'upload.read_metadata'),

    ('operator', 'admin.session'),
    ('operator', 'dashboard.read'),
    ('operator', 'audit.read'),
    ('operator', 'system_health.read'),
    ('operator', 'family.read'),
    ('operator', 'family.disable'),
    ('operator', 'family.reset_code'),
    ('operator', 'member.read'),
    ('operator', 'member.remove'),
    ('operator', 'member.restore'),
    ('operator', 'message.read_metadata'),
    ('operator', 'message.soft_delete'),
    ('operator', 'push.read'),
    ('operator', 'push.disable_endpoint'),
    ('operator', 'upload.read_metadata'),
    ('operator', 'upload.mark_cleanup'),

    ('super_admin', 'admin.session'),
    ('super_admin', 'admin.manage'),
    ('super_admin', 'dashboard.read'),
    ('super_admin', 'audit.read'),
    ('super_admin', 'system_health.read'),
    ('super_admin', 'family.read'),
    ('super_admin', 'family.disable'),
    ('super_admin', 'family.reset_code'),
    ('super_admin', 'member.read'),
    ('super_admin', 'member.remove'),
    ('super_admin', 'member.restore'),
    ('super_admin', 'message.read_metadata'),
    ('super_admin', 'message.soft_delete'),
    ('super_admin', 'push.read'),
    ('super_admin', 'push.disable_endpoint'),
    ('super_admin', 'upload.read_metadata'),
    ('super_admin', 'upload.mark_cleanup')
) as seed(role, permission)
on conflict (role, permission) do nothing;

create or replace function refresh_admin_metric_snapshot()
returns admin_metric_snapshots
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_start timestamptz := now() - interval '24 hours';
  v_today timestamptz := date_trunc('day', now());
  v_end timestamptz := now();
  v_sent int := 0;
  v_failed int := 0;
  v_row admin_metric_snapshots%rowtype;
begin
  select count(*)::int
    into v_sent
    from push_delivery_logs
   where created_at >= v_start
     and created_at < v_end
     and status = 'sent';

  select count(*)::int
    into v_failed
    from push_delivery_logs
   where created_at >= v_start
     and created_at < v_end
     and status in ('failed', 'gone');

  insert into admin_metric_snapshots (
    snapshot_key,
    period_start,
    period_end,
    recent_messages_24h,
    active_families_today,
    push_sent_24h,
    push_failed_24h,
    push_success_rate,
    upload_bytes_24h,
    generated_at
  )
  values (
    'latest',
    v_start,
    v_end,
    (select count(*)::int from messages where created_at >= v_start and created_at < v_end),
    (select count(distinct family_id)::int from messages where created_at >= v_today and created_at < v_end),
    v_sent,
    v_failed,
    case when (v_sent + v_failed) = 0 then 0 else v_sent::numeric / (v_sent + v_failed)::numeric end,
    (select coalesce(sum(byte_size), 0)::bigint from storage_upload_logs where created_at >= v_start and created_at < v_end),
    now()
  )
  on conflict (snapshot_key) do update set
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    recent_messages_24h = excluded.recent_messages_24h,
    active_families_today = excluded.active_families_today,
    push_sent_24h = excluded.push_sent_24h,
    push_failed_24h = excluded.push_failed_24h,
    push_success_rate = excluded.push_success_rate,
    upload_bytes_24h = excluded.upload_bytes_24h,
    generated_at = excluded.generated_at
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function refresh_admin_metric_snapshot() from public, anon, authenticated;
grant execute on function refresh_admin_metric_snapshot() to service_role;

insert into app_schema_migrations (version, name, description)
values (
  '20260523_admin_security_foundation',
  'admin_security_foundation',
  'Adds independent admin RBAC, audit logs, metric snapshot cache, and upload cleanup metadata.'
)
on conflict (version) do nothing;
