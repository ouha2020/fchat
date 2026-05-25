# 2026-05-25 Phase 4 ChatInput Recording Viewport Audit - Orchestrator

## Scope

Task: audit `ChatInput` recording behavior when the visual viewport or device orientation changes during hold-to-record.

Subagent status: no worker was dispatched for this narrow implementation because recent Phase 4 worker creation is still blocked by `agent thread limit reached`. This report is written by the Orchestrator.

Permanent write scope:

- `components/ChatInput.tsx`
- `lib/i18n.ts`
- `DESIGN_SYSTEM.md`
- `TASKS_UI.md`
- `PHASE_STATUS.md`
- `docs/iteration-log/_latest.md`
- `docs/agent-reports/20260525-phase4-chatinput-recording-viewport.md`

Temporary validation route:

- `app/chatinput-recording-consent-smoke/page.tsx` was created to open the recording consent dialog with the updated copy.
- The route was deleted after browser validation.

## Decision

Use privacy-cancel, not safe-rect recompute.

Reasoning:

- `ChatInput` records a release/cancel hit area from pointer position and recording bar geometry.
- Mobile visual viewport changes can be caused by browser chrome, keyboard behavior, orientation changes, or PWA shell changes while the user is holding the record control.
- Recomputing the safe rectangle during an active hold risks changing the meaning of the user's current finger position.
- Cancelling mirrors the existing background/blur/pagehide privacy behavior and avoids accidental audio send after the viewport moves.

## Changes

- During `recordingState.status === "recording"`, `ChatInput` now listens to:
  - `window.visualViewport.resize`
  - `window.visualViewport.scroll`
  - `window.resize`
  - `window.orientationchange`
- Those events queue one animation-frame privacy cancel.
- The cancel path removes document pointer listeners, cancels the active recording handle, returns state to idle, and shows the existing privacy notice.
- Recording consent and stopped-copy were updated in Chinese, Japanese, and English to mention backgrounding, screen rotation, and viewport changes.
- `DESIGN_SYSTEM.md` now records the baseline: viewport/orientation changes during recording should privacy-cancel unless a future dedicated task validates a different model.

## Browser Smoke Results

Target: `http://127.0.0.1:3001/chatinput-recording-consent-smoke`

What was covered:

- The updated recording consent copy in the existing Dialog shell.
- Mobile widths 360px, 390px, and 430px.

Results:

- 360px: passed. Dialog stayed inside viewport; `documentElement.scrollWidth` and `body.scrollWidth` stayed at 360px; dialog buttons did not overflow.
- 390px: passed. Dialog stayed inside viewport; no horizontal overflow; dialog buttons did not overflow.
- 430px: passed. Dialog stayed inside viewport; no horizontal overflow; dialog buttons did not overflow.

Limit:

- The in-app browser click API could not faithfully automate the real long-press hold-to-record gesture plus live viewport/orientation transition.
- The implementation path was validated by static review, lint, typecheck, build, and the copy/dialog smoke. Real microphone + PWA orientation validation remains a manual follow-up.

## Security And Architecture Notes

- No message visibility, Push, Service Worker, RPC, Realtime, Storage, upload, database, or migration behavior changed.
- No audio blob, media URL, coordinates, message body, family code, member token, Auth token, or password-like value was added to URL, logs, or Push payload.
- The audio recording service remains unchanged; only the UI component's active-recording cancellation trigger set was extended.

## Validation Performed

- `npm run lint`: passed after the `ChatInput` effect change.
- `npm run typecheck`: passed after the `ChatInput` effect change.
- Browser smoke: recording consent dialog passed at 360px / 390px / 430px.
- Temporary route removed and dev server stopped after browser smoke.
- Final `npm run lint`: passed.
- Final `npm run typecheck`: passed.
- Final `npm run build`: passed with 37 routes/static pages; the temporary smoke route was not present.
- Final `git diff --check`: passed with only existing LF/CRLF working-copy warnings.

## Follow-Up

- Manual device/PWA validation should still cover real microphone recording, orientation change while holding, browser chrome resize while holding, and keyboard behavior around the composer.
- Keep real consecutive `/chat?mid=` Push-click validation as a separate task.
