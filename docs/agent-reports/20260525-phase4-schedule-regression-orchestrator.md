# 2026-05-25 Phase 4 Schedule Regression Audit - Orchestrator

## Scope

Task: continue the Phase 4 `/schedule` P0 regression audit and apply only the smallest safe detail-sheet UI/a11y and viewport fixes found in the existing report and code review.

Subagent status: no new worker was dispatched because recent subagent creation is still blocked by `agent thread limit reached`. This report is written by the Orchestrator and reviews W6's Phase 1 schedule layering report.

Implementation scope:

- `app/schedule/page.tsx`

Governance updates:

- `DESIGN_SYSTEM.md`
- `TASKS_UI.md`
- `PHASE_STATUS.md`
- `docs/iteration-log/_latest.md`
- `docs/agent-reports/20260525-phase4-schedule-regression-orchestrator.md`

## Files Reviewed

- `AGENTS.md`
- `UI_RULES.md`
- `DESIGN_SYSTEM.md`
- `TASKS_UI.md`
- `PHASE_STATUS.md`
- `docs/agent-reports/20260525-phase1-schedule-layering.md`
- `app/schedule/page.tsx`
- `lib/scheduleService.ts`
- `components/Dialog.tsx`
- `components/KeeperRequestSheet.tsx`

## Findings

### P0

No confirmed P0 blocker was found in static review.

The full `/schedule` P0 regression item remains open because real authenticated data, mobile keyboard behavior, and device/PWA reminder flows were not fully exercised in this local pass.

### P1 - Detail Sheet Was Visual Modal But Not Semantic Modal

Evidence:

- `ScheduleDetailPanel` rendered as a fixed overlay and bottom sheet.
- Before this round, the panel lacked `role="dialog"`, `aria-modal`, a readable title binding, initial focus entry, focus restoration, and a Tab focus boundary.
- W6's Phase 1 report identified this as a keyboard and screen-reader layering risk.

Risk:

- Keyboard users could tab into the background schedule page while the detail sheet is open.
- Screen readers could treat the background page and the detail sheet as the same active layer.
- Closing the sheet could leave focus in an unpredictable location.

Fix applied:

- Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and a stable title id.
- Focus now enters the close/cancel button when the sheet opens.
- Focus is restored to the previous active element when the sheet unmounts.
- Tab and Shift+Tab cycle within visible focusable controls in the sheet.
- Escape closes the detail sheet in read mode; in edit mode Escape exits edit mode first instead of closing the whole sheet.

### P1 - Detail Sheet Did Not Track The Visual Viewport

Evidence:

- The panel previously used viewport classes based on `dvh` only and the overlay was fixed to `inset-0`.
- W6's report identified soft-keyboard risk around comment input, decline reason input, and edit save controls.

Fix applied:

- The detail overlay now measures `window.visualViewport.height` and `offsetTop` while mounted.
- The overlay height and transform update on visual viewport `resize` / `scroll`, window `resize`, and `orientationchange`.
- The inner sheet height is capped by `min(92dvh, calc(100% - 1rem))`, so the panel uses the current visible area when the browser chrome or keyboard changes the viewport.

Remaining risk:

- iOS/Android PWA soft keyboard may still need real-device tuning for comment input, decline reason input, or edit save controls.
- This round did not restructure the composer into a sticky footer or change the edit form footer.

Smallest follow-up:

- Run a dedicated real-device or browser-authenticated smoke of the schedule detail sheet with keyboard open before attempting a larger layout restructure.

### P1 - Compressed Detail Sheet Could Clip Conversation Controls

Evidence:

- A temporary local fixture rendered the real `ScheduleDetailPanel` with long title, long note, reminder status, comments, private record, assignee response controls, and edit controls.
- At 360px / 390px / 430px widths with a 520px compressed viewport, the broader dialog stayed inside the viewport and had no horizontal scroll, but the assignee `拒绝` control could be scrolled into a visually nearby position while its hit target overlapped the final action row.
- The issue came from the read-mode body and conversation section being compressed too aggressively; this was a UI reachability issue, not a schedule RPC or permission issue.

Fix applied:

- The read-mode detail body now uses vertical scrolling instead of clipping overflow.
- The conversation section now keeps a minimum usable height so the assignee response controls, comment input, and final action row do not collapse into the same hit area.

Validation:

- Temporary fixture smoke passed at 360px, 390px, and 430px widths with a 520px compressed viewport.
- Covered interactions: open and fill decline reason, fill comment and activate send, enter edit mode and activate save.
- For all three widths: no horizontal scroll, dialog stayed inside viewport, browser console had no errors or warnings.
- The temporary fixture and query entry were removed before final validation; `rg` found no `__smoke`, `ScheduleDetailSmokeFixture`, or smoke data left in `app/schedule/page.tsx`.

## Security And Architecture Notes

- No schedule RPC, RLS, database, migration, Push, Service Worker, Realtime, reminder delivery, or Storage behavior changed.
- Schedule reads/writes still go through `lib/scheduleService.ts` RPC calls with `member_id + member_token`.
- Private schedule visibility remains server/RPC governed; this round did not add frontend-only permission filtering.
- No title, note, comment body, location, media URL, family code, member token, Auth token, or password-like value was added to Push payloads, URLs, or logs.

## Validation Performed

- `npm run lint`: passed after the `ScheduleDetailPanel` change.
- `npm run typecheck`: passed after the `ScheduleDetailPanel` change.
- Browser smoke attempt: opened `http://127.0.0.1:3001/schedule`, but the in-app browser did not have a usable local family session and the real detail sheet could not be opened. No authenticated sheet behavior was claimed.
- Temporary fixture browser smoke: passed at 360px / 390px / 430px by 520px compressed viewport before fixture removal; no horizontal scroll; decline reason, comment send, and edit save controls were reachable.
- Browser screenshot capture was attempted but timed out in the in-app browser, so DOM measurements and interaction outcomes are the recorded evidence.
- Final `npm run build`: passed with 37 routes/static pages after the visual viewport and reachability update.
- Final `git diff --check`: passed with only existing LF/CRLF working-copy warnings after the visual viewport and reachability update.

## Not Covered

- Authenticated browser smoke of real `/schedule` data.
- 360px / 390px / 430px real detail sheet interaction with soft keyboard open.
- Month/week/day switching with real long event sets.
- Private schedule A/B/C/admin visibility matrix.
- Reminder Push click to `/schedule?item=<itemId>`.

## Follow-Up

- Continue keeping the broader `/schedule` P0 item open.
- Next schedule-safe step: real authenticated 360px / 390px / 430px soft-keyboard regression for comment input, decline reason, edit save, private visibility, and reminder status flows.
