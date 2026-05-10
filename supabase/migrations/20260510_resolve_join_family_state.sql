drop function if exists resolve_join_family_state(text, text);

create or replace function resolve_join_family_state(
  p_family_code text,
  p_nickname text
)
returns table (
  status text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_family families%rowtype;
  v_clean_code text;
  v_clean_nickname text;
  v_ip_hash text;
begin
  begin
    v_ip_hash := assert_join_rate_limit();
  exception when others then
    if sqlerrm like '%rate_limited%' then
      return query select 'rate_limited'::text;
      return;
    end if;
    raise;
  end;

  v_clean_code := upper(trim(coalesce(p_family_code, '')));
  v_clean_nickname := trim(coalesce(p_nickname, ''));

  if v_clean_code !~ '^[A-Z0-9]{6,12}$' then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    return query select 'invalid_family_code'::text;
    return;
  end if;

  if length(v_clean_nickname) = 0 or length(v_clean_nickname) > 20 then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    return query select 'nickname_required'::text;
    return;
  end if;

  select * into v_family
    from families
   where families.family_code = v_clean_code
     and (families.code_expires_at is null or families.code_expires_at > now())
   limit 1;

  if not found or not v_family.join_enabled then
    perform record_join_attempt(v_ip_hash, v_clean_code, false);
    return query select 'invalid_family_code'::text;
    return;
  end if;

  if exists (
    select 1
      from family_members fm
     where fm.family_id = v_family.id
       and fm.nickname = v_clean_nickname
       and fm.status in ('active', 'removed')
  ) then
    return query select 'rejoin_required'::text;
    return;
  end if;

  return query select 'can_join'::text;
end;
$$;

grant execute on function resolve_join_family_state(text, text) to anon, authenticated;
