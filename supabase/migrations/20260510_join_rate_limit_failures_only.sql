create or replace function assert_join_rate_limit()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip_hash text;
  v_minute_count int;
  v_hour_count int;
begin
  v_ip_hash := request_ip_hash();

  select count(*) into v_minute_count
    from join_attempts
   where ip_hash = v_ip_hash
     and success = false
     and created_at > now() - interval '1 minute';

  select count(*) into v_hour_count
    from join_attempts
   where ip_hash = v_ip_hash
     and success = false
     and created_at > now() - interval '1 hour';

  if v_minute_count >= 5 or v_hour_count >= 30 then
    raise exception 'rate_limited';
  end if;

  return v_ip_hash;
end;
$$;
