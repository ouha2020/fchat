# 2026-05-25 Phase 1 Chat Layering Audit - Worker W5

## Scope

Assignment: audit `/chat` layering risks for keyboard behavior, recording, toolbar, whisper mode, important notices, message action menus, dynamic viewport, Realtime compensation assumptions, and Push click return path.

Mode: read-only static audit. No browser/dev-server validation was performed in this worker pass.

Write scope: this report only.

## Files Reviewed

Governance and phase context:

- `AGENTS.md`
- `UI_RULES.md`
- `DESIGN_SYSTEM.md`
- `TASKS_UI.md`
- `CODEX_UI_LOOP.md`
- `PHASE_STATUS.md`
- `docs/iteration-log/_latest.md`
- `docs/agent-reports/README.md`

Chat UI and layering:

- `app/chat/page.tsx`
- `components/ChatInput.tsx`
- `components/ChatMessage.tsx`
- `components/ImportantNoticeBar.tsx`
- `components/EffectOverlay.tsx`
- `components/KeeperRequestSheet.tsx`
- `components/Dialog.tsx`
- `components/Toast.tsx`

Realtime, cache, Push, and presence references:

- `lib/messageService.ts`
- `lib/messageSync.ts`
- `lib/messageCache.ts`
- `lib/messageRepository.ts` via imports in `app/chat/page.tsx`
- `lib/pushNotificationService.ts`
- `lib/usePushNotificationControls.ts`
- `lib/pushMessageServer.ts`
- `lib/webPushServer.ts`
- `app/api/push/send-message-notification/route.ts`
- `app/api/push/presence/route.ts`
- `components/ServiceWorkerRegister.tsx`
- `components/AppPresenceTracker.tsx`
- `public/sw.js`

## Summary

No P0 blocker was found in static review. The chat page still uses a dynamic viewport variable rather than `h-screen`, Realtime events are lightweight and refetch full messages through member-token RPCs, and Push click payloads route through message IDs rather than carrying message body/media/location content.

Main risks are interaction-layer stability under mobile keyboard pressure: input popovers can be clipped, the message action menu is not fully visual-viewport aware, and the Push click return path has a one-shot scroll guard that should be tested with multiple notification clicks in the same open chat session.

## Findings

### P0

None found.

### P1

1. Chat input popovers can be clipped or cover too much of the log when the keyboard is open.

Evidence:

- `app/chat/page.tsx` sets the chat root to `height: var(--chat-viewport-height, 100dvh)` and `overflow-hidden`.
- `components/ChatInput.tsx` anchors the more-actions toolbar and whisper picker with `absolute bottom-full`.
- The whisper picker uses fixed caps (`max-h-72`, inner `max-h-52`) rather than a value derived from the remaining visible viewport.
- `ImportantNoticeBar`, keeper mode, whisper mode, and the input bar all consume normal-flow vertical space before the message log.

Risk:

- On 360/390/430px widths with the keyboard open, especially with an expanded important notice or whisper/keeper strip, the picker can extend beyond the visible root and be clipped by the page container.
- If many active members exist, some whisper targets may be hard or impossible to reach without closing the keyboard.

Minimal next task:

- Make `ChatInput` popovers visual-viewport aware: cap height against available space above the input bar, keep inner scroll reachable, and validate with keyboard open at 360/390/430px.

2. Message action menu uses layout viewport coordinates and has an incomplete interaction shield.

Evidence:

- `app/chat/page.tsx` calculates menu coordinates with `window.innerWidth` and `window.innerHeight`.
- The action menu is `fixed z-50`; the transparent close layer is `fixed inset-0 z-40`.
- The bottom input wrapper is also `relative z-40`, and `ChatInput` itself has `relative z-50` inside that lower layer.
- The menu does not recalculate on `visualViewport` resize/scroll, keyboard open/close, or orientation change.

Risk:

- Long-pressing near the lower half of the viewport while the keyboard is open can place the menu behind the keyboard or too close to the input layer.
- Because the dismiss layer and bottom input share the same z band, the input area may remain interactable while a message action menu is open.
- This can produce accidental sends/recording attempts or leave the action menu open while focus moves to the textarea.

Minimal next task:

- Move action menu placement to `visualViewport` coordinates, close/reposition it on viewport resize and scroll, and raise the dismiss layer above the chat input while keeping dialogs/toasts above it.

3. Push click return path is probably functional, but the scroll guard is one-shot per page lifetime.

Evidence:

- `public/sw.js` opens or focuses `/chat?mid=<messageId>` for message notifications.
- `app/chat/page.tsx` reads `mid` from `window.location.search` and calls `fetchPushMessageNow(mid, true)` if the message is not already present.
- `hasScrolledToNotifiedRef` is a boolean; once true, later `mid` changes in the same mounted chat page will be ignored.
- Service worker `postMessage` handling fetches the message but does not request a scroll/highlight.

Risk:

- A second notification click into an already open/mounted chat session may fetch the message but fail to scroll/highlight if the browser does not fully reload/remount the page.
- This is most likely on installed PWA/browser focus-return flows and should be validated on iOS and Android.

Minimal next task:

- Track the last handled `mid` value instead of a boolean, and consider letting notification-click `postMessage` trigger the same fetch-and-scroll path.

### P2

1. Expanded important notices are bounded but compete with the message log during keyboard use.

Evidence:

- `ImportantNoticeBar` lives in normal flow between header/error and the message log.
- Expanded state adds an internal `max-h-[120px]` scroll area.
- The chat page has no auto-collapse or compact mode when the textarea focuses, keyboard opens, or recording starts.

Risk:

- On a reduced visual viewport, header + expanded notice + whisper/keeper strip + input can leave a very small message log.
- The bar likely does not overlap critical controls, but it can make the page feel pinned and unstable during high-frequency chat input.

Minimal next task:

- Add a manual validation pass for expanded notices with keyboard, recording, and action menus before changing the component. If needed later, collapse to the latest notice while the keyboard is active.

2. Recording zone may become stale if the visual viewport changes mid-recording.

Evidence:

- `ChatInput` stores a `safeRectRef` from the pressed voice button, then refreshes it when recording state mounts the recording bar.
- Recording is cancelled on hidden/blur/pagehide/beforeunload, which is good.
- There is no listener that recomputes the recording bar bounds during orientation change or visual viewport resize while still recording.

Risk:

- On iOS/Android, keyboard, browser chrome, or orientation changes during a hold-to-record gesture can make the release/cancel zone feel wrong.

Minimal next task:

- During a recording session, update the recording safe rectangle on `visualViewport.resize`, `visualViewport.scroll`, and `orientationchange`, or cancel recording on those events with a privacy-safe notice.

3. Message action menu needs a11y semantics and focus behavior before UI polish.

Evidence:

- Chat input's more-actions menu uses `role="menu"`, but the message action menu is a plain `div`.
- There is no focus handoff to the action menu, no escape handler local to the menu, and no role/aria grouping for menu items.

Risk:

- Keyboard and screen-reader users may not discover or close the menu predictably.
- Future visual refactors may accidentally make the menu look modal while it is not managed like one.

Minimal next task:

- Give the message action surface menu/dialog semantics consistent with the chosen interaction model, add Escape handling, and validate focus return to the message or composer.

### P3

1. Textarea naming relies on placeholder text.

Evidence:

- `components/ChatInput.tsx` renders the composer textarea with a placeholder but no explicit `aria-label` or associated visible/sr-only label.

Risk:

- This is not a layering blocker, but the UI rules call for form controls to have a label or aria name.

Minimal next task:

- Add an accessible name to the chat composer during the ChatInput a11y pass.

2. Toasts sit above all chat layers.

Evidence:

- `components/Toast.tsx` renders at `z-[9999]`, above dialogs, keeper sheets, effect overlay, action menus, and input.

Risk:

- Toasts are dismissible and usually short-lived, but a burst of error messages can visually cover lower chat controls.

Minimal next task:

- During manual validation, include failed upload/recording and Push permission errors while the keyboard is open.

## Security And Architecture Notes

- Realtime message delivery preserves the intended architecture: `message_realtime_events` is used as a lightweight signal, and `get_message_for_member` / `get_messages_by_ids_for_member` RPCs are used to fetch full message data with `member_id + member_token`.
- The chat page still applies a frontend visibility filter for whispers, but reviewed fetch paths also go through RPCs. This frontend filter must remain a defense-in-depth layer, not the authority.
- Important notices intentionally exclude whisper messages in the chat surface (`!notification.message?.recipient_member_id`), which avoids accidentally pinning private messages to the shared notice bar.
- Push message payload construction in `lib/pushMessageServer.ts` includes title, safe body summary, `/chat`, `familyId`, `messageId`, and tag. Static review did not find message body, media URL, coordinates, family code, Auth token, or member token in message Push payloads.
- Push fanout is based on `message_recipients`, skips sender/self, skips inactive/read/delivered recipients, checks active chat presence, and disables 404/410 subscriptions.
- Out-of-scope security note from a reviewed Push helper: `lib/pushNotificationService.ts` builds Push diagnostics with `memberToken` in the query string. That is not part of the chat click-return path, but it conflicts with the project rule against putting member tokens in URLs and should be assigned to a Push/settings security task.
- Do not change Push, Realtime, Storage, RPC, or Service Worker behavior as part of a visual-only chat layering cleanup without a dedicated architecture/security review.

## Minimal Next Tasks

1. P1: Validate and fix `ChatInput` popover height/placement against the visible viewport with keyboard open.
2. P1: Validate and fix message action menu placement, dismiss layer, and keyboard/viewport behavior.
3. P1: Validate Push notification click return for two different message notifications in the same open PWA session; update the `mid` scroll guard if needed.
4. P2: Validate expanded important notices plus keyboard/recording/whisper strip before deciding whether to auto-collapse.
5. P2: Validate recording hold/cancel behavior across orientation, backgrounding, and browser chrome changes.
6. P2: Add a11y semantics/focus handling for the message action menu in a later implementation phase.

## Manual Validation Suggestions

Run on 360px, 390px, and 430px mobile widths, with at least one iOS Safari/PWA pass and one Android Chrome/PWA pass:

- Open the chat keyboard, then open the plus toolbar and whisper picker. Confirm no clipping, no horizontal scroll, all active members reachable, and the input remains stable.
- Expand important notices, focus the textarea, open the toolbar, and enter whisper mode. Confirm the message log remains usable and key controls are not hidden.
- Long-press messages near the top, center, and bottom of the viewport with keyboard closed and open. Confirm the action menu is visible, clamped, dismissible, and does not allow accidental input actions underneath.
- Start voice recording, drag in/out of the cancel zone, rotate the device if possible, background/foreground the app, and confirm privacy cancellation or release behavior is predictable.
- Send normal and whisper text/image/audio/location messages. Confirm whisper labels are visible, whisper messages do not appear in important notices, and action menu options do not expose private messages to admin-only broad actions.
- Disable network or background the app for more than 45 seconds, send messages from another member, return to chat, and confirm Realtime fallback/seq compensation catches up without duplicate side effects.
- Trigger a message Push while the app is closed/backgrounded, click it, and confirm `/chat?mid=<messageId>` fetches through RPC, scrolls, and highlights. Repeat with a second notification without killing the app.
- Confirm schedule reminder Push still routes to `/schedule?item=<itemId>` and does not interfere with chat `mid` handling.
- Inspect notification payloads in dev logs or Push diagnostics only for safe fields; do not add body text, media URLs, coordinates, family code, or tokens.

## Validation Performed

- Static code review only.
- `git diff --check`: passed, exit code 0. Git printed existing LF/CRLF working-copy warnings, but no whitespace errors.
- `git diff --check -- docs/agent-reports/20260525-phase1-chat-layering.md`: passed, exit code 0.

## Modification Statement

I modified exactly one file for this assignment: `docs/agent-reports/20260525-phase1-chat-layering.md`.

I did not modify `app/chat/page.tsx`, `components/ChatInput.tsx`, `components/ChatMessage.tsx`, `components/ImportantNoticeBar.tsx`, `public/sw.js`, services, `TASKS_UI.md`, `PHASE_STATUS.md`, `docs/iteration-log/_latest.md`, or any file outside this report.
