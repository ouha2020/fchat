-- Allow Home Assistant system events to be stored in messages.

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'messages_system_event_type_check'
       and conrelid = 'messages'::regclass
  ) then
    alter table messages
      drop constraint messages_system_event_type_check;
  end if;

  alter table messages
    add constraint messages_system_event_type_check
    check (
      system_event_type is null
      or system_event_type in (
        'family_created',
        'member_joined',
        'family_renamed',
        'family_code_reset',
        'join_enabled',
        'join_disabled',
        'member_removed',
        'member_left',
        'admin_password_changed',
        'keeper_request_created',
        'assistant_card_created',
        'assistant_card_confirmed',
        'assistant_card_cancelled',
        'assistant_action_done'
      )
    );
end $$;
