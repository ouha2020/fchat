-- Extend system health catalog with trigger, bucket detail, and storage policy checks.

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
  v_triggers jsonb := '[]'::jsonb;
  v_realtime jsonb := '[]'::jsonb;
  v_buckets jsonb := '[]'::jsonb;
  v_storage_policies jsonb := '[]'::jsonb;
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
    'schema', n.nspname,
    'table', c.relname,
    'name', t.tgname,
    'enabled', t.tgenabled::text,
    'definition', pg_get_triggerdef(t.oid, true)
  ) order by n.nspname, c.relname, t.tgname), '[]'::jsonb)
    into v_triggers
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and not t.tgisinternal;

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', schemaname,
    'table', tablename
  ) order by schemaname, tablename), '[]'::jsonb)
    into v_realtime
    from pg_publication_tables
   where pubname = 'supabase_realtime';

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', b.name,
      'public', case
        when to_jsonb(b) ? 'public' then (to_jsonb(b)->>'public')::boolean
        else null
      end,
      'file_size_limit', case
        when to_jsonb(b) ? 'file_size_limit'
          and nullif(to_jsonb(b)->>'file_size_limit', '') is not null
          then (to_jsonb(b)->>'file_size_limit')::bigint
        else null
      end,
      'allowed_mime_types', case
        when to_jsonb(b) ? 'allowed_mime_types' then to_jsonb(b)->'allowed_mime_types'
        else null
      end
    ) order by b.name), '[]'::jsonb)
      into v_buckets
      from storage.buckets b;
  exception
    when undefined_table or undefined_column or insufficient_privilege then
      v_buckets := '[]'::jsonb;
      v_warnings := v_warnings || jsonb_build_array('storage_buckets_unavailable');
  end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname,
      'table', tablename,
      'policy', policyname,
      'roles', to_jsonb(roles),
      'command', cmd,
      'qual', qual
    ) order by schemaname, tablename, policyname), '[]'::jsonb)
      into v_storage_policies
      from pg_policies
     where schemaname = 'storage';
  exception
    when insufficient_privilege then
      v_storage_policies := '[]'::jsonb;
      v_warnings := v_warnings || jsonb_build_array('storage_policies_unavailable');
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
    'triggers', v_triggers,
    'realtimeTables', v_realtime,
    'buckets', v_buckets,
    'storagePolicies', v_storage_policies,
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
  '20260524_system_health_consistency_checks',
  'system_health_consistency_checks',
  'Adds trigger, bucket detail, storage policy, and consistency catalog data for system health checks.'
)
on conflict (version) do update
set name = excluded.name,
    description = excluded.description;
