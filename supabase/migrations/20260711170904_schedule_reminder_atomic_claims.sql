-- Atomically claim reminder deliveries before sending Push so overlapping
-- workers cannot send the same delivery in parallel.

alter table family_schedule_reminder_deliveries
  drop constraint if exists family_schedule_reminder_deliveries_status_check;

alter table family_schedule_reminder_deliveries
  add constraint family_schedule_reminder_deliveries_status_check
  check (status in ('pending', 'processing', 'sent', 'skipped', 'failed', 'gone'));

create or replace function claim_schedule_reminder_deliveries(
  p_mode text,
  p_limit int default 100
)
returns table (
  id uuid,
  family_id uuid,
  schedule_item_id uuid,
  member_id uuid,
  scheduled_for timestamptz,
  reminder_kind text,
  status text,
  attempt_count int
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_mode text;
  v_limit int;
  v_now timestamptz := now();
begin
  v_mode := trim(coalesce(p_mode, ''));
  if v_mode not in ('due', 'retry') then
    raise exception 'invalid_schedule_reminder_claim_mode';
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 100), 100));

  update family_schedule_reminder_deliveries d
     set status = 'failed',
         next_retry_at = case
           when d.attempt_count < 3 then v_now
           else null
         end,
         error_status = null,
         error_message = 'reminder_processing_timeout',
         updated_at = v_now
   where d.status = 'processing'
     and d.last_attempt_at < v_now - interval '5 minutes';

  return query
  with candidates as materialized (
    select d.id
      from family_schedule_reminder_deliveries d
     where (
       v_mode = 'due'
       and d.status = 'pending'
       and d.scheduled_for <= v_now
     ) or (
       v_mode = 'retry'
       and d.status = 'failed'
       and d.next_retry_at is not null
       and d.next_retry_at <= v_now
       and d.attempt_count < 3
     )
     order by case
       when v_mode = 'retry' then d.next_retry_at
       else d.scheduled_for
     end asc
     for update skip locked
     limit v_limit
  )
  update family_schedule_reminder_deliveries d
     set status = 'processing',
         attempt_count = d.attempt_count + 1,
         last_attempt_at = v_now,
         next_retry_at = null,
         skipped_reason = null,
         error_status = null,
         error_message = null,
         updated_at = v_now
    from candidates c
   where d.id = c.id
  returning d.id,
            d.family_id,
            d.schedule_item_id,
            d.member_id,
            d.scheduled_for,
            d.reminder_kind,
            d.status,
            d.attempt_count;
end;
$$;

revoke all on function claim_schedule_reminder_deliveries(text, int)
  from public, anon, authenticated;
grant execute on function claim_schedule_reminder_deliveries(text, int)
  to service_role;

insert into app_schema_migrations (version, name, description)
values (
  '20260711170904_schedule_reminder_atomic_claims',
  'schedule_reminder_atomic_claims',
  'Claims due and retry reminder deliveries atomically and recovers abandoned processing claims.'
)
on conflict (version) do nothing;
