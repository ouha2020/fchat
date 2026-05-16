-- Add admin_password_updated_at column and update_admin_password RPC

alter table families
  add column if not exists admin_password_updated_at timestamptz;

-- Add admin_password_changed to system_event_type allowlist
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'messages_system_event_type_check'
       and conrelid = 'messages'::regclass
  ) then
    return;
  end if;

  alter table messages
    drop constraint messages_system_event_type_check;

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
        'admin_password_changed'
      )
    );
end $$;

create or replace function update_admin_password(
  p_member_id uuid,
  p_member_token text,
  p_current_password text,
  p_new_password text
)
returns void
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_family_id uuid;
begin
  if p_new_password is null or length(p_new_password) < 4 or length(p_new_password) > 128 then
    raise exception 'admin_password_too_short';
  end if;

  v_family_id := require_admin(p_member_id, p_member_token, p_current_password);

  update families
     set admin_password_hash = hash_secret(p_new_password),
         admin_password_updated_at = now(),
         updated_at = now()
   where id = v_family_id;

  insert into messages (
    family_id, message_type, content, system_event_type, system_event_payload
  )
  values (
    v_family_id,
    'system',
    '管理员已修改管理密码',
    'admin_password_changed',
    '{}'::jsonb
  );
end;
$$;

grant execute on function update_admin_password(uuid, text, text, text) to anon, authenticated;
