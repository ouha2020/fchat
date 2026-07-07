# UI Iteration Log - Home Entry Panel Polish

## Basic Info

- Date: 2026-07-07 JST
- Executor: Codex
- Source: user requested current optimization pass, including mobile UI consistency.
- Scope: `app/page.tsx`
- Non-goals: no auth flow rewrite, no database change for this UI item, no Vercel action, no broad page redesign.

## Audit

- Read `AGENTS.md`, `UI_RULES.md`, `DESIGN_SYSTEM.md`, `CODEX_UI_LOOP.md`, `TASKS_UI.md`, and the latest iteration log.
- The homepage already uses the selected warm HomeTree visual direction.
- The entry panel still felt visually heavier than the illustration because the border, radius, fill, and shadows looked more like a detached control card.

## Select

- Selected one small UI task: polish the home entry panel so it sits closer to the supplied warm family illustration style.
- Kept the existing create/join/login/forgot-password flow and labels.

## Implement

- Softened the panel surface to a warmer translucent white.
- Reduced radius from `32px` to `28px`.
- Reduced the shadow strength and made it warmer.
- Adjusted the create/join button fills, radius, border, and shadows.
- Kept large mobile tap targets and the existing two-action layout.

## Validate

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test`: passed, 6 files / 65 tests.
- `npm run build`: passed, 38 generated static pages.
- `git diff --check`: passed, only LF/CRLF working-copy warnings.
- Local production smoke used `npx next start -p 3002` and installed Chrome via Playwright.
- Homepage checked at 360px, 390px, and 430px:
  - no horizontal overflow,
  - no console errors,
  - HomeTree content present,
  - create/join buttons remained 68px tall.
- Local server was stopped after verification.

## Review

- UX: the entry panel remains bottom reachable and keeps the same primary actions.
- A11y: no icon-only controls were added; existing buttons/links remain text-labeled.
- Performance: only class names changed; no new images, scripts, subscriptions, or network requests.
- Security: no auth, RPC, database, Push, Storage, or Service Worker behavior changed for this UI task.

## Record

- Changed file: `app/page.tsx`
- Related reports:
  - `docs/agent-reports/20260707-supabase-warning-triage.md`
  - `docs/agent-reports/20260707-regression-checklist.md`
- Next UI recommendation: verify the homepage at 360px/390px/430px, then only adjust spacing if the bottom panel still feels too detached from the illustration.
