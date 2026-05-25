-- Message visibility privacy hardening.
-- Keep chat message contents, important notification rows, and recipient rows
-- readable only through SECURITY DEFINER RPCs.

alter table messages enable row level security;
alter table important_notifications enable row level security;
alter table message_recipients enable row level security;

revoke all on messages from anon, authenticated;
revoke all on important_notifications from anon, authenticated;
revoke all on message_recipients from anon, authenticated;

drop policy if exists "messages are readable by anon" on messages;
drop policy if exists "messages require RPC" on messages;
create policy "messages require RPC"
  on messages for select
  to anon, authenticated
  using (false);

drop policy if exists "important notifications are readable by anon" on important_notifications;
drop policy if exists "important notifications require RPC" on important_notifications;
create policy "important notifications require RPC"
  on important_notifications for select
  to anon, authenticated
  using (false);

drop policy if exists "message recipients are rpc only" on message_recipients;
create policy "message recipients are rpc only"
  on message_recipients for select
  to anon, authenticated
  using (false);

create or replace function get_system_health_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tables jsonb := '[]'::jsonb;
  v_columns jsonb := '[]'::jsonb;
  v_functions jsonb := '[]'::jsonb;
  v_grants jsonb := '[]'::jsonb;
  v_table_privileges jsonb := '[]'::jsonb;
  v_policies jsonb := '[]'::jsonb;
  v_realtime jsonb := '[]'::jsonb;
  v_buckets jsonb := '[]'::jsonb;
  v_supabase_migrations jsonb := '[]'::jsonb;
  v_app_migrations jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'name', c.relname,
    'rls', c.relrowsecurity
  ) order by n.nspname, c.relname), '[]'::jsonb)
    into v_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p')
     and n.nspname in ('public', 'storage');

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', table_schema,
    'table', table_name,
    'column', column_name
  ) order by table_schema, table_name, ordinal_position), '[]'::jsonb)
    into v_columns
    from information_schema.columns
   where table_schema in ('public', 'storage');

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'name', p.proname,
    'args', pg_get_function_identity_arguments(p.oid)
  ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    into v_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public';

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', routine_schema,
    'name', routine_name,
    'grantee', grantee,
    'privilege', privilege_type
  ) order by routine_schema, routine_name, grantee), '[]'::jsonb)
    into v_grants
    from information_schema.routine_privileges
   where routine_schema = 'public';

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', table_schema,
    'table', table_name,
    'grantee', grantee,
    'privilege', privilege_type
  ) order by table_schema, table_name, grantee, privilege_type), '[]'::jsonb)
    into v_table_privileges
    from information_schema.table_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated');

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', schemaname,
    'table', tablename,
    'policy', policyname,
    'roles', to_jsonb(roles),
    'command', cmd,
    'qual', qual
  ) order by schemaname, tablename, policyname), '[]'::jsonb)
    into v_policies
    from pg_policies
   where schemaname = 'public';

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', schemaname,
    'table', tablename
  ) order by schemaname, tablename), '[]'::jsonb)
    into v_realtime
    from pg_publication_tables
   where pubname = 'supabase_realtime';

  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', name) order by name), '[]'::jsonb)
      into v_buckets
      from storage.buckets;
  exception
    when undefined_table or insufficient_privilege then
      v_buckets := '[]'::jsonb;
      v_warnings := v_warnings || jsonb_build_array('storage_buckets_unavailable');
  end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'version', version::text,
      'name', name
    ) order by version), '[]'::jsonb)
      into v_supabase_migrations
      from supabase_migrations.schema_migrations;
  exception
    when undefined_table or insufficient_privilege then
      v_supabase_migrations := '[]'::jsonb;
      v_warnings := v_warnings || jsonb_build_array('supabase_migrations_unavailable');
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'version', version,
    'name', name
  ) order by version), '[]'::jsonb)
    into v_app_migrations
    from app_schema_migrations;

  return jsonb_build_object(
    'tables', v_tables,
    'columns', v_columns,
    'functions', v_functions,
    'routineGrants', v_grants,
    'tablePrivileges', v_table_privileges,
    'policies', v_policies,
    'realtimeTables', v_realtime,
    'buckets', v_buckets,
    'supabaseMigrations', v_supabase_migrations,
    'appMigrations', v_app_migrations,
    'catalogWarnings', v_warnings
  );
end;
$$;

revoke execute on function get_system_health_catalog() from public, anon, authenticated;
grant execute on function get_system_health_catalog() to service_role;

insert into app_schema_migrations (version, name, description)
values (
  '20260523_message_visibility_privacy_hardening',
  'message_visibility_privacy_hardening',
  'Enforces RPC-only reads for message privacy tables and adds privacy drift health checks.'
)
on conflict (version) do nothing;
