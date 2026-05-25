-- Platform-only schema health catalog for production database consistency checks.

create table if not exists app_schema_migrations (
  version text primary key,
  name text not null,
  description text,
  applied_at timestamptz not null default now()
);

alter table app_schema_migrations enable row level security;
revoke all on app_schema_migrations from anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260523_app_schema_health',
  'app_schema_health',
  'Adds platform-only schema health catalog checks.'
)
on conflict (version) do nothing;

create or replace function schema_health_ping()
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('ok', true, 'checkedAt', now());
$$;

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
    'realtimeTables', v_realtime,
    'buckets', v_buckets,
    'supabaseMigrations', v_supabase_migrations,
    'appMigrations', v_app_migrations,
    'catalogWarnings', v_warnings
  );
end;
$$;

revoke execute on function schema_health_ping() from public, anon, authenticated;
revoke execute on function get_system_health_catalog() from public, anon, authenticated;
grant execute on function schema_health_ping() to service_role;
grant execute on function get_system_health_catalog() to service_role;
