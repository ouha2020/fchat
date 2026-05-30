-- Harden remaining low-risk Supabase security lints without changing the
-- anonymous member-token business RPC contract.

alter function public.schedule_item_is_visible_to_member(public.family_schedule_items, uuid)
  set search_path = public, extensions;

-- Public buckets can serve public URLs without broad SELECT policies that
-- allow clients to list every object in the bucket.
drop policy if exists "chat-images public read" on storage.objects;
drop policy if exists "chat-audios public read" on storage.objects;

-- Internal SECURITY DEFINER helpers and trigger functions should not be
-- directly executable through PostgREST by anon/authenticated clients.
do $$
declare
  v_signature text;
  v_func regprocedure;
  v_signatures text[] := array[
    'public.add_schedule_activity_log(uuid, uuid, text, text, jsonb)',
    'public.assert_join_rate_limit()',
    'public.assign_message_family_seq()',
    'public.cleanup_push_delivery_logs()',
    'public.current_member_from_token(uuid, text)',
    'public.delete_old_schedule_events()',
    'public.enqueue_important_notification_realtime_event()',
    'public.enqueue_message_realtime_event()',
    'public.enqueue_schedule_event_for_visible_members(uuid, text)',
    'public.enqueue_schedule_realtime_events()',
    'public.enqueue_schedule_reminder_delivery_realtime_event()',
    'public.ensure_overdue_schedule_reminders()',
    'public.ensure_schedule_reminder_deliveries(uuid)',
    'public.populate_message_recipients_for_message()',
    'public.record_join_attempt(text, text, boolean)',
    'public.record_sticker_usage(uuid, text)',
    'public.request_ip_hash()',
    'public.sync_schedule_reminder_deliveries()'
  ];
begin
  foreach v_signature in array v_signatures loop
    v_func := to_regprocedure(v_signature);
    if v_func is not null then
      execute format('revoke all on function %s from public, anon, authenticated', v_func);
      execute format('grant execute on function %s to service_role', v_func);
    end if;
  end loop;
end $$;
