-- Admin-sensitive flows now use the family owner's Supabase Auth session.
-- Keep legacy functions defined for old deployments, but stop exposing them
-- to browser clients where a separate admin password could be used directly.

revoke execute on function update_family_name(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function reset_family_code(uuid, text, text) from public, anon, authenticated;
revoke execute on function set_join_enabled(uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function update_admin_password(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function rejoin_family_member(text, text, text, text) from public, anon, authenticated;
revoke execute on function remove_member(uuid, text, uuid) from public, anon, authenticated;

grant execute on function update_family_name(uuid, text, text, text) to service_role;
grant execute on function reset_family_code(uuid, text, text) to service_role;
grant execute on function set_join_enabled(uuid, text, text, boolean) to service_role;
grant execute on function update_admin_password(uuid, text, text, text) to service_role;
grant execute on function rejoin_family_member(text, text, text, text) to service_role;
grant execute on function remove_member(uuid, text, uuid) to service_role;
