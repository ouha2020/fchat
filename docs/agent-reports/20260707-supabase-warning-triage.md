# Supabase Warning Triage - 2026-07-07

## Scope

- Source: `C:/Users/wangb/Downloads/Supabase Performance Security Lints (bmgwejinidicxrzpccvd).csv`
- Project: `bmgwejinidicxrzpccvd`
- Goal: classify current Supabase security warnings and separate real fixes from expected anonymous-member RPC exposure.

## Summary

The CSV contains 138 WARN rows:

- 67 `anon_security_definer_function_executable`
- 67 `authenticated_security_definer_function_executable`
- 2 `public_bucket_allows_listing`
- 1 `function_search_path_mutable`
- 1 `auth_leaked_password_protection`

No CRITICAL rows were present in this CSV. The earlier public table/RLS issue is not represented in this export.

## Already Covered In Repository Migrations

These warnings are already addressed in repository SQL and should be verified against production migration state:

- `function_search_path_mutable` for `public.schedule_item_is_visible_to_member`
  - Covered by `supabase/migrations/20260527084753_harden_remaining_security_lints.sql`.
  - Also present in canonical `supabase/schema.sql`.
- Broad SELECT policies on `chat-images` and `chat-audios`
  - Covered by `supabase/migrations/20260527084753_harden_remaining_security_lints.sql`.
  - Further hardened by `supabase/migrations/20260614_private_chat_media_storage.sql`, which makes chat media buckets private.
  - Also present in canonical `supabase/schema.sql`.
- Direct execution of internal helper/trigger functions by `anon` / `authenticated`
  - Covered by `supabase/migrations/20260527084753_harden_remaining_security_lints.sql`.
  - Helpers revoked there include `current_member_from_token`, `assert_join_rate_limit`, `assign_message_family_seq`, realtime enqueue helpers, reminder delivery helpers, and other internal functions.

If these warnings still appear in Supabase after refresh, production likely has not applied the repository migrations or the Advisor result was exported before refresh.

## Fixed In This Iteration

New media sends are now restricted to family-scoped storage references:

- Client send validation rejects arbitrary HTTP(S) media URLs for new image/audio messages.
- `send_message` now rejects arbitrary HTTP(S) values in `p_image_url` and `p_audio_url`.
- Existing legacy HTTP(S) media remains readable in the client read path so old messages do not break.

Files:

- `lib/mediaRefs.ts`
- `lib/messageService.ts`
- `lib/mediaRefs.test.ts`
- `supabase/schema.sql`
- `supabase/migrations/20260707_harden_chat_media_refs.sql`

## Accepted / Expected Warnings

Many SECURITY DEFINER RPCs are intentionally callable by `anon` and `authenticated` because normal family members do not use Supabase Auth. They authenticate with `member_id + member_token` inside each RPC.

Examples that should remain callable unless the identity model changes:

- `validate_member`
- `send_message`
- `list_messages_for_member`
- `get_message_for_member`
- `get_messages_by_ids_for_member`
- `mark_messages_read`
- `mark_messages_delivered`
- `list_schedule_items_for_member`
- `create_schedule_item`
- `update_schedule_item`
- `delete_schedule_item`
- `respond_schedule_assignment`
- `update_member_avatar`

These are not automatically safe just because they are expected. They are acceptable only if each function validates member token, family membership, active status, and visibility before returning or mutating data.

## Requires Supabase Dashboard Action

`auth_leaked_password_protection` cannot be fixed in repository SQL. Enable leaked password protection in Supabase Auth password security settings.

## Production Check

Before marking warnings resolved:

1. Confirm production has applied:
   - `20260527084753_harden_remaining_security_lints.sql`
   - `20260614_private_chat_media_storage.sql`
   - `20260707_harden_chat_media_refs.sql`
2. Refresh Supabase Advisors.
3. Confirm `chat-images` and `chat-audios` are private and have no broad public SELECT listing policy.
4. Confirm internal helper functions are not directly executable by `anon` / `authenticated`.
5. Enable leaked password protection in Supabase Auth.

## Risks

- Do not revoke all SECURITY DEFINER RPCs globally. That would break anonymous family members because the app relies on token-validated RPC calls.
- Applying `20260707_harden_chat_media_refs.sql` will reject older clients that still try to send direct HTTP(S) media URLs. Current app upload paths return `storage://` references.
- The CSV is a snapshot, not a live advisor check. Production state must be verified after migrations are applied.
