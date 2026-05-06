# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # one-time
npm run dev              # localhost:3000 — needs .env.local
npm run build            # production build (also runs typecheck via Next)
npm run lint             # next lint
npm run typecheck        # tsc --noEmit (build also covers this)
```

There are no automated tests; verification is manual through the running app plus `npm run build`.

`.env.local` must define `NEXT_PUBLIC_SUPABASE_URL` and either `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (preferred, new naming) or `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `lib/supabaseClient.ts` reads either.

## Branch / deploy workflow

- Develop on **`Codex/family-chat-webapp-AYGTc`** (per harness instructions). Never push to `main` directly.
- `main` is wired to Vercel auto-deploy. Ship via PR + merge with the GitHub MCP tools (`mcp__github__create_pull_request` then `mcp__github__merge_pull_request`).
- `vercel.json` pins `framework: nextjs` so Vercel doesn't fall back to a static-site preset that hunts for a `build/` directory.

## Supabase project

- Project id: **`bmgwejinidicxrzpccvd`** (project name `fchat`, region ap-northeast-1).
- For schema changes, prefer `mcp__73b73c29-…__apply_migration` over hand-coaching the user through the SQL Editor — and **also** mirror the change into `supabase/schema.sql` and a new file under `supabase/migrations/` so the repo stays the source of truth for fresh installs.

## Architecture

### Auth model — anonymous, token-in-localStorage

There is no Supabase Auth. A "session" is `{family_id, member_id, member_token, nickname, role, is_admin, family_name, family_code}` saved by `lib/authLocal.ts` to `localStorage["family-chat:session"]`. The token is a 24-byte hex string returned by the `create_family` / `join_family` RPCs and stored as a SHA-256 hash in `family_members.member_token_hash`. `validate_member` rehydrates the session on app open.

### All writes go through `SECURITY DEFINER` RPCs

`messages`, `family_members`, and `families` are RLS-protected. Reads are open to `anon` (RLS `using (true)` on `messages` / `family_members`; the `families_public` view hides `admin_password_hash`). Every write — create/join family, send/delete message, admin actions, leave — is a `SECURITY DEFINER` Postgres function that takes `p_member_id + p_member_token` and validates them with `hash_secret`. The RPC is the only place authorization happens; the client layer in `lib/*Service.ts` is just a thin wrapper.

When adding new RPCs:
- Set `set search_path = public, extensions` (Supabase puts `pgcrypto` in `extensions`; without this, `gen_random_bytes` / `digest` fail at call time).
- Add `#variable_conflict use_column` to plpgsql functions whose `RETURNS TABLE` columns share names with table columns (esp. `family_id`). Otherwise queries explode with "column reference is ambiguous".
- Run `grant execute on function … to anon, authenticated;` and don't forget to update the grant signature when params change.

### Realtime + the React 18 batching trap

The `messages` and `family_members` tables are in `supabase_realtime`. `messages` has `replica identity full` so UPDATE events (used by soft-delete) carry the whole row.

`app/chat/page.tsx` subscribes to two channels (one for messages, one for family_members) — splitting them avoids events being silently dropped when multiple `postgres_changes` listeners share a channel. There's also an 8-second visibility-aware polling fallback so missed Realtime broadcasts still surface.

**Important React 18 footgun this codebase has been bitten by twice**: in a Realtime callback, the `setState` updater function is *not* guaranteed to run synchronously. The pattern `let isNew = false; setMessages((prev) => { isNew = true; ... }); if (isNew) trigger();` is broken — any new state side-effect (e.g. firing the effect overlay) must be done **outside** the `setMessages` updater, with deduplication via a `useRef` Set.

### Effect overlay (`#XXXX` easter eggs)

Sender-side encryption: when the user sends text matching `^#\d{4}$`, `lib/effects.ts#transformForSending` rewrites `content` to the caption (or a placeholder emoji) and emits the effect via the `messages.effect_id` + `messages.effect_caption` columns. Receivers trigger animation off `effect_id` (`effectFromColumns`), with a fallback to `detectEffect(content)` for backward compat with legacy clients that still ship raw `#XXXX`. The DB RPC enforces an allowlist on `effect_id`.

`components/EffectOverlay.tsx` keys the overlay on `${messageId}-${Date.now()}` — without a unique key React reuses the component instance and the CSS keyframes never replay, so subsequent triggers visually do nothing. The overlay's auto-dismiss timer reads `onDone` through a ref to be immune to parent-render churn.

### Storage

Two public buckets, both with anon read + insert policies: `chat-images` (image messages) and `chat-audios` (voice messages). `lib/messageService.ts` writes to `${family_id}/${ts}-${rand}.${ext}`. `lib/recordingService.ts` picks the best `MediaRecorder` mime type per browser (`webm/opus → mp4 → ogg`).

### Mobile viewport

The chat page uses `h-[100dvh]` (dynamic viewport height) — *not* `h-screen` — so the keyboard shrinks the chat container instead of pushing the message area off-screen. Don't reintroduce `h-screen` on full-height pages.

### Soft delete

`messages.deleted_at` + `messages.deleted_by_member_id`. Sender or admin can call `delete_message` RPC; system messages cannot be deleted. `ChatMessage.tsx` renders a centered "撤回了一条消息" pill instead of the bubble. Long-press / right-click triggers `useLongPress` (500ms hold), which surfaces a `window.confirm` in the chat page.

## File map (only the load-bearing pieces)

- `app/chat/page.tsx` — owner of session restore, Realtime subscriptions, polling fallback, optimistic updates, effect triggering, delete handler, and overlay rendering. The hairiest file in the repo.
- `lib/effects.ts` — effect map + `transformForSending` + `effectFromColumns`. New codes go in `SPECIAL`.
- `supabase/schema.sql` — canonical schema, RPCs, RLS, publication, buckets. Idempotent (uses `if not exists` / `or replace` / `drop policy if exists`).
- `supabase/migrations/<date>_<name>.sql` — each adds one of: search_path fix, ambiguous-column fix, family_members realtime, audio messages, effect columns, delete_message. They're meant to run additively against an already-deployed DB.

When changing the DB, update **both** `supabase/schema.sql` and add a new file in `supabase/migrations/`.
