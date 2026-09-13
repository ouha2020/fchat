-- Create all assistant cards for one multi-date request in one transaction.
-- Any invalid draft rolls back the complete batch, including card messages.

alter table assistant_action_cards
  add column if not exists batch_request_id uuid,
  add column if not exists batch_index int;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'assistant_action_cards_batch_pair_check'
       and conrelid = 'assistant_action_cards'::regclass
  ) then
    alter table assistant_action_cards
      add constraint assistant_action_cards_batch_pair_check
      check (
        (batch_request_id is null and batch_index is null)
        or (
          batch_request_id is not null
          and batch_index between 0 and 30
        )
      );
  end if;
end;
$$;

create unique index if not exists assistant_action_cards_batch_request_idx
  on assistant_action_cards (
    family_id,
    created_by_member_id,
    batch_request_id,
    batch_index
  )
  where batch_request_id is not null;

create or replace function create_assistant_action_cards_batch(
  p_member_id uuid,
  p_member_token text,
  p_batch_request_id uuid,
  p_cards jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_member record;
  v_card jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_card_id uuid;
  v_count int;
  v_existing_count int;
  v_position int;
begin
  select * into v_member from current_member_from_token(p_member_id, p_member_token);
  if not found then
    raise exception 'unauthorized';
  end if;

  if p_batch_request_id is null or jsonb_typeof(p_cards) <> 'array' then
    raise exception 'invalid_assistant_card_batch';
  end if;

  v_count := jsonb_array_length(p_cards);
  if v_count < 1 or v_count > 31 then
    raise exception 'invalid_assistant_card_batch';
  end if;

  select count(*) into v_existing_count
    from assistant_action_cards a
   where a.family_id = v_member.family_id
     and a.created_by_member_id = v_member.id
     and a.batch_request_id = p_batch_request_id;

  if v_existing_count > 0 then
    if v_existing_count <> v_count then
      raise exception 'assistant_card_batch_incomplete';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'card_id', a.id,
          'message_id', a.card_message_id
        )
        order by a.batch_index
      ),
      '[]'::jsonb
    ) into v_results
      from assistant_action_cards a
     where a.family_id = v_member.family_id
       and a.created_by_member_id = v_member.id
       and a.batch_request_id = p_batch_request_id;
    return v_results;
  end if;

  begin
    for v_card, v_position in
      select entry.value, (entry.position - 1)::int
        from jsonb_array_elements(p_cards) with ordinality as entry(value, position)
       order by entry.position
    loop
      if jsonb_typeof(v_card) <> 'object' then
        raise exception 'invalid_assistant_card_batch';
      end if;

      v_result := create_assistant_action_card(
        p_member_id,
        p_member_token,
        v_card->>'card_type',
        v_card->>'title',
        v_card->>'summary',
        case
          when jsonb_typeof(v_card->'payload') = 'object' then v_card->'payload'
          else '{}'::jsonb
        end,
        nullif(v_card->>'source_message_id', '')::uuid,
        nullif(v_card->>'target_message_id', '')::uuid
      );

      v_card_id := nullif(v_result->>'card_id', '')::uuid;
      update assistant_action_cards
         set batch_request_id = p_batch_request_id,
             batch_index = v_position,
             updated_at = now()
       where id = v_card_id
         and family_id = v_member.family_id
         and created_by_member_id = v_member.id;
      if not found then
        raise exception 'assistant_card_batch_incomplete';
      end if;

      v_results := v_results || jsonb_build_array(v_result);
    end loop;
  exception
    when unique_violation then
      select count(*) into v_existing_count
        from assistant_action_cards a
       where a.family_id = v_member.family_id
         and a.created_by_member_id = v_member.id
         and a.batch_request_id = p_batch_request_id;
      if v_existing_count <> v_count then
        raise;
      end if;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'card_id', a.id,
            'message_id', a.card_message_id
          )
          order by a.batch_index
        ),
        '[]'::jsonb
      ) into v_results
        from assistant_action_cards a
       where a.family_id = v_member.family_id
         and a.created_by_member_id = v_member.id
         and a.batch_request_id = p_batch_request_id;
  end;

  return v_results;
end;
$$;

revoke all on function create_assistant_action_cards_batch(uuid, text, uuid, jsonb)
  from public;
grant execute on function create_assistant_action_cards_batch(uuid, text, uuid, jsonb)
  to anon, authenticated;

insert into app_schema_migrations (version, name, description)
values (
  '20260711044649_atomic_assistant_action_card_batch',
  'atomic_assistant_action_card_batch',
  'Creates every assistant card for a multi-date request atomically so retries cannot follow a partial batch.'
)
on conflict (version) do nothing;
