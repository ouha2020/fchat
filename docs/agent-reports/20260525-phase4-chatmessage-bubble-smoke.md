# 2026-05-25 Phase 4 ChatMessage Bubble Smoke - Orchestrator

## Scope

Task: run a narrow `ChatMessage` long text / long address / media / whisper bubble smoke. Fix only reproduced visual overflow.

Subagent status: no new worker was dispatched for this small smoke because recent Phase 4 dispatches are blocked by `agent thread limit reached`. This report is written by the Orchestrator.

Write scope kept permanent:

- This report only.
- Governance docs are updated by the Orchestrator separately.

Temporary validation route:

- `app/chat-message-bubble-smoke/page.tsx` was created to render real `ChatMessage` cases.
- The route was deleted after browser validation.

## Cases Covered

- Other-member text with a long nickname and a long unbroken token.
- Current-member text with repeated long unbroken tokens.
- Location message with a very long address.
- Private location message with a long address and whisper styling.
- Private image message.
- Long-duration audio message.
- Deleted message.
- Long system message payload.

## Browser Smoke Results

Target: `http://127.0.0.1:3001/chat-message-bubble-smoke`

Widths checked:

- 360px: passed. `documentElement.scrollWidth` and `body.scrollWidth` stayed within the measured viewport; no `[data-smoke-message]` element or descendant overflowed left/right.
- 390px: passed. No horizontal overflow; no overflowing bubble descendants.
- 430px: passed. No horizontal overflow; no overflowing bubble descendants.

Notes:

- The in-app browser reported viewport client widths slightly below the requested widths because of scrollbar/browser chrome, but all page scroll widths stayed within those measured client widths.
- The temporary route used real `ChatMessage`, `AudioBubble`, i18n, current CSS, and the app layout providers.

## Findings

### P0

None found.

### P1

None reproduced in this smoke. No permanent `ChatMessage` visual code fix was applied.

### P2

1. Real data/manual chat regression is still needed.

Evidence:

- The smoke route isolates `ChatMessage` rendering and does not cover authenticated `/chat`, real media dimensions, long-press timing, real Push return, or mobile soft keyboard.

Smallest follow-up:

- Keep real `/chat` manual regression as a separate validation task, especially around long-press action menu entry, keyboard, recording, and Push-click return.

2. Recording viewport/orientation remains the next narrow technical risk.

Evidence:

- The previous audit found `ChatInput` records the hold/cancel safe rectangle at pointer down and does not recompute it on visual viewport/orientation changes.

Smallest follow-up:

- Run a dedicated `ChatInput` recording viewport/orientation audit and choose either privacy-cancel or safe-rect recompute.

## Security And Architecture Notes

- No message visibility, RPC, Realtime, Push, Service Worker, Storage, upload, or database behavior changed.
- No message body, media URL, coordinates, family code, member token, Auth token, or password-like value was added to logs, URLs, or Push payloads.
- The smoke route used static mock data only and was removed after validation.

## Validation Performed

- `npm run typecheck`: passed while the temporary route existed.
- Browser smoke: 360px / 390px / 430px passed on the temporary route.
- Temporary route removed after validation.
- Final `npm run lint`: passed.
- Final `npm run typecheck`: passed.
- Final `npm run build`: passed with 37 routes/static pages; the temporary smoke route was not present.
- Final `git diff --check`: passed with only existing LF/CRLF working-copy warnings.

## Modification Statement

Permanent code changes from this task: none.

Final permanent files for this task:

- `docs/agent-reports/20260525-phase4-chatmessage-bubble-smoke.md`
