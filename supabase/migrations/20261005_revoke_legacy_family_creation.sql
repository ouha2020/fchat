-- The owner account API replaces both legacy anonymous family creation overloads.
-- Keep historical functions for compatibility with stored definitions, but do
-- not expose them through the Data API. Missing overloads are already closed.
do $$
declare
  legacy_signature text;
begin
  foreach legacy_signature in array array[
    'public.create_family(text,text,text,text)',
    'public.create_family(text,text,text,text,text)'
  ] loop
    if to_regprocedure(legacy_signature) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', legacy_signature);
    end if;
  end loop;
end;
$$;

insert into public.app_schema_migrations (version, name, description)
values ('20261005_revoke_legacy_family_creation', 'revoke_legacy_family_creation',
  'Revokes public access to legacy family creation overloads; owner creation uses the authenticated server API.')
on conflict (version) do nothing;
