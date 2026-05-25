# Phase 4 /members Orchestrator Report

## Scope

- Task: `/members` P1 audit and minimal layout fix.
- Files changed: `app/members/page.tsx`.
- Temporary validation route: `app/members-layout-smoke/page.tsx`, removed after browser smoke.
- Non-goals: no member validation, Realtime polling, removal API, owner/account auth, whisper routing, Push, Service Worker, RPC, database, or RLS changes.

## Findings

- Member rows placed avatar, long nickname, role badges, whisper icon, and remove button in one row too early. At 390px this could squeeze identity text into a tiny column when the action area was present.
- Long nicknames and keeper names were truncated instead of wrapping safely.
- The remove action used `h-9`, below the preferred touch target used elsewhere in this mobile UI pass.
- Error-state retry/back actions used a fixed two-column grid that could crowd longer localized labels on 360px.
- Admin/me badges used local pill styles instead of the shared status badge semantics already established in `app/globals.css`.

## Implementation

- Split member rows into identity and action zones.
- Kept 360px and 390px member rows stacked; row layout starts at 430px where the action zone has enough space.
- Changed long keeper/member names and last-active text to wrap with `min-w-0` / `break-words`.
- Used `status-badge status-badge-success` for keeper/admin and `status-badge status-badge-muted` for self.
- Raised the remove button to `min-h-10` and kept whisper/keeper icon links at 40px with existing `aria-label` / `title`.
- Changed load-error actions to one column by default, two columns from 390px.

## Validation

- Temporary route smoke: `/members-layout-smoke?w=360`, `/members-layout-smoke?w=390`, and `/members-layout-smoke?w=430`.
- Browser smoke results:
  - 360px: no horizontal scroll, no overflowing descendants, action labels present, minimum interactive target 36px.
  - 390px: no horizontal scroll, no overflowing descendants after moving row breakpoint to 430px, action labels present, minimum interactive target 36px.
  - 430px: no horizontal scroll, no overflowing descendants, action labels present, minimum interactive target 36px.
  - Browser console errors/warnings: none.
- Temporary route cleanup: `rg` confirmed no `members-layout-smoke`, `MembersLayoutSmokePage`, or `data-smoke-frame` source/build residue after clearing stale `.next`.
- `npm run lint`: passed.
- `npm run typecheck`: passed after clearing stale `.next/types` from the deleted smoke route.
- `npm run build`: passed with 37 routes/static pages; `/members` generated successfully.
- `git diff --check`: passed; only existing LF/CRLF working-copy warnings.

## Risk Notes

- The real `/members` route still depends on a valid local family session; browser smoke used a temporary fixture route to isolate layout behavior.
- Member removal confirmation and owner email login requirements were not exercised because removal/account logic was unchanged.
- Realtime member-list refresh and whisper navigation were not revalidated beyond preserving href/labels.
