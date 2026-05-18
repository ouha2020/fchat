-- Tighten newly added auth-family RPC grants.
-- Server-only functions must not inherit PUBLIC execute privileges.

revoke execute on function create_family(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function create_family_with_verified_code(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function issue_member_session_for_user(uuid, text) from public, anon, authenticated;
revoke execute on function require_admin(uuid, text, text) from public, anon, authenticated;

grant execute on function create_family_with_verified_code(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function issue_member_session_for_user(uuid, text) to service_role;
