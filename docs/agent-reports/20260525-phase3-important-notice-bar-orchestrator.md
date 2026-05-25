# Phase 3 ImportantNoticeBar Orchestrator Report

## Scope

- Task: Phase 3 P2 `ImportantNoticeBar` audit for expanded state, long title/preview, read state, and remove-button stability.
- File changed: `components/ImportantNoticeBar.tsx`.
- Temporary validation route: `/important-notice-smoke`, deleted after browser smoke.

## Changes

- Added `useId`, `aria-controls`, and an explicit expand/collapse `aria-label` for the notice toggle.
- Added `role="list"` / `role="listitem"` to the expanded important-notice list.
- Changed the expanded list height from a fixed 120px to `32dvh`, keeping it scrollable without taking over the chat viewport.
- Added focus-visible rings and stable minimum height to selectable notice rows.
- Kept long sender, preview, and read-state text single-line truncated with `title` carrying the full summary.
- Replaced the visual remove glyph with an inline decorative SVG while preserving `aria-label` and `title`.
- Normalized read-state separators to ASCII `, ` and `/` to avoid narrow-width and encoding drift.

## Validation

- Browser smoke at 360px, 390px, and 430px on temporary `/important-notice-smoke`:
  - No horizontal overflow.
  - Expanded toggle exposed `aria-expanded`, `aria-controls`, and a readable label.
  - Expanded list rendered 3 list items with stable row heights.
  - Remove buttons stayed 40px by 40px, had label/title, and their SVGs were `aria-hidden`.
  - Long preview and read-state strings stayed within the viewport and preserved full text via `title`.
  - Select interaction updated the selected id; remove interaction reduced list items from 3 to 2.
  - Console errors/warnings: none.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed with 37 routes/static pages; temporary smoke route was not present in the route table.
- `git diff --check`: passed; only existing LF/CRLF working-copy warnings.

## Boundaries

- No important notification service, message visibility, RPC, Push, Service Worker, Realtime, Storage, permission, or database logic changed.
- Real authenticated chat important-notice read-state loading/removal was not executed because the local smoke route covered isolated component UI behavior only.
