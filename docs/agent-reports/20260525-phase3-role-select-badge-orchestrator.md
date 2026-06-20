# Phase 3 RoleSelect / RoleBadge Orchestrator Report

## Scope

- Task: Phase 3 P2 `RoleSelect / RoleBadge` audit and minimal UI/a11y fix.
- Files changed: `components/RoleSelect.tsx`, `components/RoleBadge.tsx`.
- Temporary validation route: `app/role-select-smoke/page.tsx`, removed after browser smoke.
- Non-goals: no role values, join/create-family validation, member role permissions, RPC, API, database, or auth changes.

## Findings

- `RoleSelect` displayed selected state primarily through color and border, without explicit radio semantics.
- Role buttons had no `role="radio"` / `aria-checked`, so the three-option selector was less clear for assistive technology.
- The selected state lacked a non-color visible marker.
- `RoleBadge` used local pill classes instead of the established chip semantics and had no title fallback.

## Implementation

- Added `role="radiogroup"` with the existing `homeSelectRole` label to `RoleSelect`.
- Added `role="radio"` and `aria-checked` to each role button.
- Added a visible check icon for the selected option so state is not color-only.
- Added stable `min-h-28`, `min-w-0`, focus-visible ring, and smaller 360px icon sizing.
- Moved `RoleBadge` to the shared `tone-chip` base with role-specific color/ring variants and a `title`.

## Validation

- Temporary route smoke: `/role-select-smoke?w=360`, `/role-select-smoke?w=390`, and `/role-select-smoke?w=430`.
- Browser smoke results:
  - 360px: no horizontal scroll, no overflowing descendants, one radiogroup, three radios, one checked radio, one visible check icon, three role badges, minimum target 112px.
  - 390px: no horizontal scroll, same role/a11y counts, minimum target 112px.
  - 430px: no horizontal scroll, same role/a11y counts, minimum target 112px.
  - Browser console errors/warnings: none.
- Temporary route cleanup: `rg` confirmed no `role-select-smoke`, `RoleSelectSmokePage`, or `data-smoke-frame` source/build residue after clearing stale `.next`.
- `npm run lint`: passed.
- `npm run typecheck`: passed after clearing stale `.next/types` from the deleted smoke route.
- `npm run build`: passed with 37 routes/static pages; `/create-family`, `/join`, and `/members` generated successfully.
- `git diff --check`: passed; only existing LF/CRLF working-copy warnings.

## Risk Notes

- Real join/create-family submit flows were not re-run because validation logic and form data handling were unchanged.
- Role semantics changed only at the UI/a11y layer; stored role values remain `father`, `mother`, and `child`.
