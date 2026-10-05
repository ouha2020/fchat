-- Run only in the intended test/project database using the SQL editor or psql.
-- All identities/tokens/content below are synthetic. Never substitute a real family.
-- The exception subtransaction ALWAYS rolls back its fixtures, including trigger writes.
-- Unexpected failures abort the statement too. No Storage object or Push request is sent.
-- Output contains only case names/results, never tokens, hashes or private row contents.
do $permission_test$
declare
  f uuid := gen_random_uuid();
  other_f uuid := gen_random_uuid();
  members uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  tokens text[] := array[]::text[];
  whisper uuid;
  group_message uuid;
  private_item uuid;
  private_event uuid;
  media_ref text;
  i integer;
  denied boolean;
  cases text[] := array[]::text[];
begin
  perform set_config('statement_timeout', '15s', true);
  -- No obsolete overload may bypass the owner API. Missing functions are safe.
  for i in 4..5 loop
    media_ref := case when i = 4 then 'public.create_family(text,text,text,text)'
      else 'public.create_family(text,text,text,text,text)' end;
    if to_regprocedure(media_ref) is not null and (
      has_function_privilege('anon', to_regprocedure(media_ref), 'EXECUTE') or
      has_function_privilege('authenticated', to_regprocedure(media_ref), 'EXECUTE')
    ) then raise exception 'regression:legacy_family_creation_%', i; end if;
  end loop;
  cases := array_append(cases, 'legacy_family_creation_not_public');
  begin
    insert into public.families(id,name,family_code,admin_password_hash)
      values(f,'Permission regression fixture','T' || upper(left(replace(f::text,'-',''),11)),public.hash_secret('synthetic-admin-password')),
            (other_f,'Cross-family fixture','T' || upper(left(replace(other_f::text,'-',''),11)),public.hash_secret('synthetic-admin-password'));
    for i in 1..5 loop
      tokens := array_append(tokens,replace(gen_random_uuid()::text,'-','') || left(replace(gen_random_uuid()::text,'-',''),16));
      insert into public.family_members(id,family_id,nickname,role,member_token_hash,access_token_hash,is_admin)
        values(members[i],case when i=5 then other_f else f end,'Fixture ' || i,'child',
          public.hash_secret(tokens[i]),public.hash_secret(tokens[i]),i=4);
    end loop;

    -- These are the actual public caller privileges, not postgres table privileges.
    set local role anon;
    for i in 1..5 loop
      if not exists(select 1 from public.validate_member(members[i],tokens[i],null)) then
        raise exception 'regression:active_member_%',i;
      end if;
    end loop;
    cases := array_append(cases,'five_active_identities_validate_as_anon');
    media_ref := 'storage://chat-images/family/' || f::text || '/synthetic-fixture.png';
    whisper := public.send_message(p_member_id=>members[1],p_member_token=>tokens[1],
      p_message_type=>'image',p_image_url=>media_ref,p_recipient_member_id=>members[2]);
    group_message := public.send_message(p_member_id=>members[1],p_member_token=>tokens[1],
      p_message_type=>'text',p_content=>'Synthetic group regression');
    private_item := public.create_schedule_item(p_member_id=>members[1],p_member_token=>tokens[1],
      p_title=>'Synthetic private schedule',p_note=>null,p_item_type=>'schedule',p_visibility=>'private',
      p_starts_at=>now()+interval '1 day',p_ends_at=>now()+interval '1 day 1 hour',p_remind_at=>null,
      p_assignee_member_id=>members[2],p_recurrence_rule=>'none');
    private_event := public.create_schedule_context_event(p_member_id=>members[1],p_member_token=>tokens[1],
      p_schedule_item_id=>private_item,p_event_type=>'audio',p_visibility=>'private',p_recipient_member_id=>members[2],
      p_audio_url=>'storage://chat-audios/family/' || f::text || '/synthetic-fixture.webm',p_audio_duration_ms=>1000);

    for i in 1..5 loop
      if exists(select 1 from public.get_message_for_member(members[i],tokens[i],whisper)) <> (i in (1,2)) then
        raise exception 'regression:whisper_visibility_%',i;
      end if;
      if exists(select 1 from public.get_schedule_item_for_member(members[i],tokens[i],private_item)) <> (i in (1,2)) then
        raise exception 'regression:private_schedule_visibility_%',i;
      end if;
      cases := array_append(cases,'whisper_and_private_schedule_identity_' || i);
      if i in (1,2) then
        perform public.get_schedule_collaboration_for_member(members[i],tokens[i],private_item);
        if not exists(select 1 from public.list_schedule_context_events_for_member(members[i],tokens[i],private_item) where id=private_event) then
          raise exception 'regression:private_audio_visibility_%',i;
        end if;
      else
        denied := false;
        begin
          perform public.get_schedule_collaboration_for_member(members[i],tokens[i],private_item);
        exception when others then
          if sqlerrm <> 'schedule_item_not_found' then raise; end if;
          denied := true;
        end;
        if not denied then raise exception 'regression:collaboration_allowed_%',i; end if;
        denied := false;
        begin
          perform public.list_schedule_context_events_for_member(members[i],tokens[i],private_item);
        exception when others then
          if sqlerrm <> 'schedule_item_not_found' then raise; end if;
          denied := true;
        end;
        if not denied then raise exception 'regression:private_audio_allowed_%',i; end if;
        denied := false;
        begin
          perform public.create_schedule_context_event(p_member_id=>members[i],p_member_token=>tokens[i],
            p_schedule_item_id=>private_item,p_event_type=>'text',p_text_content=>'Must be denied');
        exception when others then
          if sqlerrm <> 'schedule_item_not_found' then raise; end if;
          denied := true;
        end;
        if not denied then raise exception 'regression:private_comment_allowed_%',i; end if;
      end if;
      cases := array_append(cases,'collaboration_audio_comment_identity_' || i);
    end loop;
    denied := false;
    begin
      perform 1 from public.messages limit 0;
    exception when insufficient_privilege then denied := true;
    end;
    if not denied then raise exception 'regression:anon_direct_table_access'; end if;
    cases := array_append(cases,'anon_direct_message_table_denied');
    reset role;

    if (select count(*) from public.message_recipients where message_id=whisper) <> 2
      or exists(select 1 from public.message_recipients where message_id=whisper and member_id not in (members[1],members[2])) then
      raise exception 'regression:whisper_recipient_source';
    end if;
    if (select count(*) from public.family_context_event_recipients where event_id=private_event) <> 2
      or exists(select 1 from public.family_context_event_recipients where event_id=private_event and member_id not in (members[1],members[2])) then
      raise exception 'regression:private_audio_recipient_source';
    end if;
    cases := array_append(cases,'message_and_context_media_recipient_sources');
    update public.family_members set status='removed' where id=members[2];
    set local role anon;
    if exists(select 1 from public.validate_member(members[2],tokens[2],null))
      or exists(select 1 from public.get_message_for_member(members[2],tokens[2],whisper))
      or exists(select 1 from public.get_message_for_member(members[2],tokens[2],group_message)) then
      raise exception 'regression:removed_member_read';
    end if;
    cases := array_append(cases,'removed_member_old_token_and_message_reads_denied');
    denied := false;
    begin
      perform public.send_message(p_member_id=>members[2],p_member_token=>tokens[2],p_message_type=>'text',p_content=>'Must be denied');
    exception when others then
      if sqlerrm <> 'unauthorized' then raise; end if;
      denied := true;
    end;
    if not denied then raise exception 'regression:removed_member_send'; end if;
    cases := array_append(cases,'removed_member_send_denied');
    denied := false;
    begin
      perform public.get_schedule_item_for_member(members[2],tokens[2],private_item);
    exception when others then
      if sqlerrm <> 'unauthorized' then raise; end if;
      denied := true;
    end;
    if not denied then raise exception 'regression:removed_member_schedule_read'; end if;
    cases := array_append(cases,'removed_member_schedule_read_denied');
    denied := false;
    begin
      perform public.create_schedule_context_event(p_member_id=>members[2],p_member_token=>tokens[2],
        p_schedule_item_id=>private_item,p_event_type=>'text',p_text_content=>'Must be denied');
    exception when others then
      if sqlerrm <> 'unauthorized' then raise; end if;
      denied := true;
    end;
    if not denied then raise exception 'regression:removed_member_schedule_write'; end if;
    cases := array_append(cases,'removed_member_schedule_write_denied');

    -- Roll back every test row and every trigger write, including ordinary event cleanup.
    raise exception using errcode='ZX001',message='rollback_permission_fixtures';
  exception when sqlstate 'ZX001' then
    if sqlerrm <> 'rollback_permission_fixtures' then raise; end if;
  end;
  if exists(select 1 from public.families where id in (f,other_f))
    or exists(select 1 from public.family_members where id=any(members))
    or exists(select 1 from public.messages where id in (whisper,group_message))
    or exists(select 1 from public.family_schedule_items where id=private_item)
    or exists(select 1 from public.family_context_events where id=private_event) then
    raise exception 'regression:fixture_rollback_failed';
  end if;
  perform set_config('familychat.permission_regression_result',jsonb_build_object(
    'passed',true,'case_count',cardinality(cases),'cases',cases,'fixtures_rolled_back',true,
    'actual_rpc_role','anon','storage_objects_created',0)::text,false);
end;
$permission_test$;
select current_setting('familychat.permission_regression_result')::jsonb as permission_regression;
