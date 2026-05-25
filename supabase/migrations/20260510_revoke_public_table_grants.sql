-- Public clients should only use SECURITY DEFINER RPCs; no direct table access.

revoke all on families from anon, authenticated;
revoke all on family_members from anon, authenticated;
revoke all on messages from anon, authenticated;
revoke all on important_notifications from anon, authenticated;
revoke all on join_attempts from anon, authenticated;

grant execute on function create_family(text, text, text, text, text) to anon, authenticated;
grant execute on function join_family(text, text, text, text) to anon, authenticated;
grant execute on function rejoin_family_member(text, text, text, text) to anon, authenticated;
grant execute on function validate_member(uuid, text, text) to anon, authenticated;
grant execute on function get_family_settings_for_member(uuid, text) to anon, authenticated;
grant execute on function list_messages_for_member(uuid, text, int) to anon, authenticated;
grant execute on function list_family_members_for_member(uuid, text, boolean) to anon, authenticated;
grant execute on function list_important_notifications_for_member(uuid, text) to anon, authenticated;
grant execute on function send_message(uuid, text, text, text, text, text, int, double precision, double precision, text, text, text, text) to anon, authenticated;
grant execute on function delete_message(uuid, text, uuid) to anon, authenticated;
grant execute on function add_important_notification(uuid, text, uuid) to anon, authenticated;
grant execute on function remove_important_notification(uuid, text, uuid) to anon, authenticated;
grant execute on function update_family_name(uuid, text, text, text) to anon, authenticated;
grant execute on function reset_family_code(uuid, text, text) to anon, authenticated;
grant execute on function set_join_enabled(uuid, text, text, boolean) to anon, authenticated;
grant execute on function remove_member(uuid, text, uuid) to anon, authenticated;
grant execute on function leave_family(uuid, text) to anon, authenticated;
