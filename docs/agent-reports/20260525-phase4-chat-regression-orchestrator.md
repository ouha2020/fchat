# 2026-05-25 Phase 4 Chat Regression Audit - Orchestrator

## Scope

Task: read-only-first `/chat` regression audit, then one smallest safe fix.

Subagent status: two report-only worker dispatches were attempted for separate write scopes:

- `docs/agent-reports/20260525-phase4-chat-regression-viewport-input.md`
- `docs/agent-reports/20260525-phase4-chat-regression-sync-push.md`

Both dispatches failed with `agent thread limit reached`. No worker report was fabricated.

Implementation scope after audit: one guard fix in `app/chat/page.tsx` so a mounted chat page can handle a later different `?mid=` notification target. No Service Worker, Push payload, RPC, Realtime, Storage, migration, or database change was made.

## Files Read

- `AGENTS.md`
- `UI_RULES.md`
- `DESIGN_SYSTEM.md`
- `TASKS_UI.md`
- `CODEX_UI_LOOP.md`
- `PHASE_STATUS.md`
- `docs/iteration-log/_latest.md`
- `docs/agent-reports/20260525-phase1-chat-layering.md`
- `app/chat/page.tsx`
- `components/ChatInput.tsx`
- `components/ChatMessage.tsx`
- `components/ImportantNoticeBar.tsx`
- `components/Toast.tsx`
- `app/globals.css`
- `lib/messageSync.ts`
- `lib/messageService.ts`
- `lib/messageCache.ts`
- `lib/pushMessageServer.ts`
- `components/ServiceWorkerRegister.tsx`
- `public/sw.js`

## Findings

### P0

No confirmed P0 blocker was found in static review.

### P1 - Notification `mid` Scroll Guard Was One-Shot

Evidence:

- `public/sw.js` routes message notification clicks to `/chat?mid=<messageId>`.
- `app/chat/page.tsx` reads `mid` and scrolls/highlights the matching message.
- Before this round, `app/chat/page.tsx` used a boolean `hasScrolledToNotifiedRef`; once any notification target was handled, later `mid` values in the same mounted chat page could be ignored.

Risk:

- In an already open PWA/browser chat session, clicking two different message notifications in sequence can focus the same mounted page. If the page does not fully remount, the second target may fetch or focus without reliably scrolling/highlighting.

Fix applied:

- Replaced the boolean guard with `lastScrolledToNotifiedMessageIdRef`.
- The page now suppresses repeated handling only for the same message id, while allowing a later different `mid` to scroll and highlight.

Remaining validation:

- Needs manual PWA/browser validation with two real message notifications in sequence.
- Service Worker `postMessage` still fetches foreground/clicked messages without an explicit clicked-vs-foreground distinction; this was not changed in this UI round.

### P1 - Real Chat Regression Still Needs Manual Device Coverage

Static review confirms the current chat page still uses `--chat-viewport-height` backed by `window.visualViewport`, `100dvh` fallback, internal message scrolling, and bottom composer safe-area handling.

Remaining manual checks:

- 360px / 390px / 430px widths.
- iOS Safari/PWA and Android Chrome/PWA if available.
- Keyboard open while sending text.
- More actions and whisper picker after the Phase 4 popover fix.
- Message action menu near top/center/bottom with keyboard closed and open.
- Recording hold/cancel while browser chrome or orientation changes.
- Expanded important notice plus keyboard and whisper/keeper strips.

### P2 - Recording Cancel Zone Can Still Drift On Viewport Changes

Evidence:

- `components/ChatInput.tsx` stores `safeRectRef` from the voice button at pointer down.
- Recording is privacy-cancelled on visibility/blur/pagehide/beforeunload, which is good.
- The safe rectangle is not recomputed or cancelled on visual viewport resize/scroll or orientation change while recording.

Risk:

- On mobile, browser chrome, keyboard, or orientation changes during hold-to-record could make the release/cancel zone feel stale.

Smallest follow-up:

- During recording, either cancel for privacy on visual viewport/orientation changes with the existing privacy notice pattern, or recompute the active recording bar rect. This should be a dedicated `ChatInput` recording task, not bundled with visual polish.

### P2 - ChatMessage Location Detail Needs Dedicated Long-Text Smoke

Evidence:

- Text messages use `whitespace-pre-wrap break-words`.
- Sender/role metadata uses truncation.
- Location message detail currently uses a plain `text-xs leading-5` span.

Risk:

- Very long addresses or malformed location labels should be checked at 360px to confirm they wrap without horizontal overflow.

Smallest follow-up:

- A narrow `ChatMessage` bubble smoke route with long text, long nickname, long location address, image/audio/private states, then one small visual fix if overflow is reproduced.

## Security And Architecture Notes

- Realtime events remain lightweight: `message_realtime_events` only triggers refetch by RPC.
- `get_message_for_member`, `get_messages_by_ids_for_member`, and delta/list RPC calls still pass `member_id + member_token`.
- Push payload review found message notification payloads include safe summary fields, `familyId`, `messageId`, URL, and tag; no message body, media URL, coordinates, family code, Auth token, or member token was added in this round.
- Important notices still exclude whisper/private messages from shared notice display.
- No Service Worker or Push payload behavior was changed.

## Validation Plan For Manual Regression

1. Start with a clean member session and at least two devices or members.
2. At 360px, 390px, and 430px widths, open `/chat`, focus the composer, open more actions, open whisper picker, and verify no horizontal overflow or hidden controls.
3. Long-press normal, image, audio, location, whisper, deleted, and important messages near top/center/bottom; verify the action menu remains in viewport and dismisses cleanly.
4. Send normal and whisper text/image/audio/location messages; verify private labels and important-notice exclusions.
5. Background the app long enough to reconnect, send messages from another member, and verify seq/delta compensation catches up without duplicates.
6. Trigger two different message Push notifications while the app is already open or backgrounded; click the first and then the second without killing the app; verify each message scrolls and highlights.
7. Trigger a schedule reminder Push and verify it routes to `/schedule?item=<itemId>` rather than `/chat?mid=`.

## Modification Statement

Final code modification from this audit:

- `app/chat/page.tsx`

Final report modification:

- `docs/agent-reports/20260525-phase4-chat-regression-orchestrator.md`

No other implementation file was changed by this audit/fix step.
