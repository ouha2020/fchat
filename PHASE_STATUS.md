# UI Refactor Phase Status

Last updated: 2026-05-25 JST
Orchestrator: Codex

## Current Phase

- Phase: Phase 3/4 controlled execution - remaining low-risk component closure while Phase 4 page tasks are already started.
- Mode: Orchestrator-controlled single-scope ImportantNoticeBar component task; no large page/component rewrite in this run.
- Phase 0 status: governance baseline complete; see `docs/iteration-log/_latest.md`.
- Phase 2 status: P1/P2 design-system foundation tasks completed; P3 motion rules remain for later.
- Phase 3 status: first five P1 component tasks completed and validated; P2 RoleSelect / RoleBadge semantics, P2 AudioBubble a11y semantics, and P2 ImportantNoticeBar stability/a11y completed.
- Phase 4 status: P1 `/chat` message action menu viewport clamp, P1 `ChatInput` popover height/placement, `/chat?mid=` consecutive notification guard, P2 `ChatMessage` bubble smoke, P2 `ChatInput` recording viewport/orientation privacy-cancel, local `/schedule` detail sheet modal/a11y/visual-viewport plus compressed-height control reachability fixes, `/settings` row/action layout fixes, `/me` long-text/avatar/dashboard layout fixes, and `/members` member-row layout fixes completed; real PWA/manual chat and broader `/schedule` regression remain open.
- `TASKS_UI.md` status: updated by Orchestrator after completing low-risk Phase 3 component tasks plus Phase 3 RoleSelect / RoleBadge semantics, Phase 3 AudioBubble a11y semantics, Phase 3 ImportantNoticeBar stability/a11y, and Phase 4 chat action menu, ChatInput popover, `mid` guard, ChatMessage bubble smoke, ChatInput recording viewport/orientation, `/schedule` detail sheet a11y/viewport/reachability progress, `/settings` P1 row/action layout, `/me` P1 layout/a11y task, and `/members` P1 layout task.

## Control Rules

- Only the Orchestrator may edit `PHASE_STATUS.md`.
- Only the Orchestrator may finalize `TASKS_UI.md`.
- Workers may only write their assigned Markdown report under `docs/agent-reports/`.
- Workers must not edit pages, components, services, migrations, schema, Push, Service Worker, governance files, or shared iteration logs.
- Worker reports are advisory until reviewed by the Orchestrator.
- Do not merge worker changes unless validation passes.

## Duplicate Dispatch Correction

A first worker dispatch produced duplicate agents with the same write scopes. Those duplicate agents were closed by the Orchestrator to prevent multiple agents editing the same report files.

Closed duplicate agent ids:

- W1 duplicate: `019e5c46-6246-79b3-8fe7-b005a9a07983`
- W2 duplicate: `019e5c46-76a6-7473-8da1-2c67492c1f6c`
- W3 duplicate: `019e5c46-91bf-7493-b424-192c74dc2c9a`
- W4 duplicate: `019e5c46-b332-72a0-964d-97e1dc770059`
- W5 duplicate: `019e5c46-d4c6-7763-875d-945ef6c71fdb`
- W6 duplicate: `019e5c46-f67a-7d41-adc5-211f47772a85`

Any `PHASE_STATUS.md` edits from those duplicate workers are not authoritative.

## File Locks

| Path | Owner | Status | Notes |
| --- | --- | --- | --- |
| `PHASE_STATUS.md` | Orchestrator | locked | Phase control only. |
| `TASKS_UI.md` | Orchestrator | locked | Update only after reviewed worker outputs. |
| `docs/iteration-log/_latest.md` | Orchestrator | updated | Records the latest Phase 3 ImportantNoticeBar stability/a11y round. |
| `docs/agent-reports/20260525-phase1-page-inventory.md` | Worker W1 | completed / reviewed | Page inventory accepted as report-only output. |
| `docs/agent-reports/20260525-phase1-component-inventory.md` | Worker W2 | completed / reviewed | Component inventory accepted as report-only output. |
| `docs/agent-reports/20260525-phase1-style-semantics.md` | Worker W3 | completed / reviewed | Style semantics accepted as report-only output. |
| `docs/agent-reports/20260525-phase1-mobile-widths.md` | Worker W4 | completed / reviewed | Mobile width audit accepted as report-only output with browser-blocked caveat. |
| `docs/agent-reports/20260525-phase1-chat-layering.md` | Worker W5 | completed / reviewed | Chat layering accepted as report-only output. |
| `docs/agent-reports/20260525-phase1-schedule-layering.md` | Worker W6 | completed / reviewed | Schedule layering accepted as report-only output. |
| `docs/agent-reports/20260525-phase4-chat-regression-orchestrator.md` | Orchestrator | updated | Local report for read-only `/chat` regression audit after worker dispatch was blocked. |
| `docs/agent-reports/20260525-phase4-chatmessage-bubble-smoke.md` | Orchestrator | updated | Local report for ChatMessage long text/media/whisper bubble smoke; no permanent code fix needed. |
| `docs/agent-reports/20260525-phase4-chatinput-recording-viewport.md` | Orchestrator | updated | Local report for ChatInput recording viewport/orientation audit and privacy-cancel decision. |
| `docs/agent-reports/20260525-phase4-schedule-regression-orchestrator.md` | Orchestrator | updated | Local report for `/schedule` regression audit progress, detail sheet modal/a11y, viewport, and compressed-height reachability fixes. |
| `docs/agent-reports/20260525-phase4-settings-orchestrator.md` | Orchestrator | updated | Local report for `/settings` row/action layout audit and smoke validation. |
| `docs/agent-reports/20260525-phase4-me-orchestrator.md` | Orchestrator | updated | Local report for `/me` long nickname/avatar/dashboard/empty-state layout and a11y validation. |
| `docs/agent-reports/20260525-phase4-members-orchestrator.md` | Orchestrator | updated | Local report for `/members` long nickname/member-row/action layout and a11y validation. |
| `docs/agent-reports/20260525-phase3-role-select-badge-orchestrator.md` | Orchestrator | updated | Local report for RoleSelect radiogroup semantics and RoleBadge tone-chip validation. |
| `docs/agent-reports/20260525-phase3-audio-bubble-orchestrator.md` | Orchestrator | updated | Local report for AudioBubble playback/unplayed/important highlight screen-reader semantics. |
| `docs/agent-reports/20260525-phase3-important-notice-bar-orchestrator.md` | Orchestrator | updated | Local report for ImportantNoticeBar expanded-state, long-text, read-state, and remove-button validation. |
| `DESIGN_SYSTEM.md` | Orchestrator | updated | Records ChatInput recording viewport/orientation privacy-cancel baseline plus RoleSelect/RoleBadge, AudioBubble, ImportantNoticeBar, settings row/action, `/me`, and `/members` layout semantics. |
| `app/chat/page.tsx` | Orchestrator | updated | Message action menu now clamps to visual viewport; `?mid=` notification scroll guard now dedupes by message id instead of one page-lifetime boolean. |
| `app/schedule/page.tsx` | Orchestrator | updated | Schedule detail sheet now has modal role/label, focus entry/restoration, Tab focus loop, Escape behavior, visual viewport-aware overlay height, and scroll/min-height fixes so comment, decline reason, and edit save controls remain reachable in compressed viewports. |
| `app/globals.css` | Orchestrator | updated | Added note/chip/badge semantics, button/form/Dialog/Toast semantics, Assistant action row semantics, shared sheet safe-area semantics, chat action menu classes, ChatInput popover classes, and settings row/action layout classes. |
| `components/ChatInput.tsx` | Orchestrator | updated | Composer-local popovers now use visual-viewport-aware max height; active recording now privacy-cancels on visual viewport/window resize, visual viewport scroll, and orientation change. |
| `lib/i18n.ts` | Orchestrator | updated | Recording consent/stopped copy now mentions backgrounding, screen rotation, and viewport changes in zh/ja/en; AudioBubble play/pause/unplayed labels added in zh/ja/en. |
| `components/ui/TextField.tsx` | Orchestrator | updated | Added `aria-errormessage` linkage for rendered error text. |
| `components/Dialog.tsx` | Orchestrator | updated | Added Dialog panel/action classes, modal role/label, initial focus entry, and focus restoration. |
| `components/Toast.tsx` | Orchestrator | updated | Moved Toast positioning and bar styling to semantic classes; added dismiss label and hidden decorative icon. |
| `components/AssistantActionCard.tsx` | Orchestrator | updated | Action rows now use wrapping shared assistant action classes. |
| `components/KeeperRequestSheet.tsx` | Orchestrator | updated | Sheet now uses shared backdrop/panel/body/actions classes for safe-area and footer stability. |
| `components/RoleSelect.tsx` | Orchestrator | updated | Added radiogroup/radio/aria-checked semantics, non-color selected check marker, focus ring, and compact 360px sizing; no role values or submit logic changed. |
| `components/RoleBadge.tsx` | Orchestrator | updated | Uses shared `tone-chip` base with role-specific classification tones; no role values or permissions changed. |
| `components/AudioBubble.tsx` | Orchestrator | updated | Added localized aria/title labels, aria-pressed, unplayed sr-only status, decorative icon/waveform hiding, and focus ring; no audio upload/send/playback service logic changed. |
| `components/ImportantNoticeBar.tsx` | Orchestrator | updated | Added expand/list a11y semantics, viewport-relative expanded height, row focus rings, stable truncation/title handling, and decorative SVG remove icon; no important notification service/RPC logic changed. |
| `app/create-family/page.tsx` | Orchestrator | updated | Low-risk `info-note` adoption only. |
| `app/verify-family-code/page.tsx` | Orchestrator | updated | Low-risk `info-note` adoption only. |
| `app/join/page.tsx` | Orchestrator | updated | Low-risk `info-note` / `warning-note` adoption only. |
| `app/settings/page.tsx` | Orchestrator | updated | Low-risk `info-note`, Push status badge, and settings row/action layout adoption; no Push, API, RPC, owner auth, or database logic changed. |
| `app/me/page.tsx` | Orchestrator | updated | Low-risk long nickname/family name wrapping, avatar action grid, personal dashboard empty-state/meta wrapping, private lock a11y label, and footer touch target; no avatar service, dashboard RPC, schedule navigation, Push, API, or database logic changed. |
| `app/members/page.tsx` | Orchestrator | updated | Low-risk member row layout, long nickname wrapping, status badge adoption, action breakpoint, and remove button touch target; no member RPC, removal API, owner Auth, Realtime, Push, or database logic changed. |
| `public/sw.js`, `supabase/**`, `types/**` | none | read-only during this implementation pass | No implementation changes in this orchestration round. |

## Worker Assignments

| Worker | Agent id | Task | Write scope | Read scope | Status |
| --- | --- | --- | --- | --- | --- |
| W1 | `019e5c46-8f4c-7c41-b057-bc98caada4c1` / James | Establish page inventory with key user paths, data dependencies, and manual validation points. | `docs/agent-reports/20260525-phase1-page-inventory.md` | `app/**`, relevant `lib/**`, `components/**` references | completed / reviewed / closed |
| W2 | `019e5c46-b661-71f2-ae58-f8f11257403b` / Galileo | Establish component inventory and classify display, interaction, business-sensitive, and PWA/Push support components. | `docs/agent-reports/20260525-phase1-component-inventory.md` | `components/**`, `public/ui-icons/**`, `app/globals.css` | completed / reviewed |
| W3 | `019e5c46-cf73-7481-894f-4303fc091ffc` / Dirac | Audit global semantic classes and repeated Tailwind patterns; list extraction candidates without changing styles. | `docs/agent-reports/20260525-phase1-style-semantics.md` | `app/globals.css`, `tailwind.config.ts`, `app/**`, `components/**` | completed / reviewed / closed |
| W4 | `019e5c46-efd4-7371-9a79-2eb8dd5f3287` / Hilbert | Audit mobile width risks at 360px, 390px, and 430px using static review and optional local browser checks if available. | `docs/agent-reports/20260525-phase1-mobile-widths.md` | `app/**`, `components/**`, CSS files | completed / reviewed / closed |
| W5 | `019e5c47-09d6-7160-b0da-fd476892c707` / Sartre | Audit chat page layering risks for keyboard, recording, toolbar, whisper, important notice, and message action menu. | `docs/agent-reports/20260525-phase1-chat-layering.md` | `app/chat/page.tsx`, chat components, message services, `public/sw.js` references | completed / reviewed / closed |
| W6 | `019e5c47-2c04-7490-ac4d-7a4309ba7e86` / Mill | Audit schedule page layering risks for detail panel, filters, month/week/day switching, comments, and reminder status. | `docs/agent-reports/20260525-phase1-schedule-layering.md` | `app/schedule/page.tsx`, schedule components/services | completed / reviewed / closed |

## Review Queue

- W1-W6 reports reviewed and accepted as report-only outputs.
- `TASKS_UI.md` finalized with reviewed Phase 1 findings.
- Phase 3 RoleSelect / RoleBadge semantics, AudioBubble a11y semantics, and ImportantNoticeBar stability/a11y completed by Orchestrator.
- Phase 4 chat action menu clamp, ChatInput popover height/placement, `/chat?mid=` consecutive notification guard, ChatMessage bubble smoke, ChatInput recording viewport/orientation privacy-cancel, `/schedule` detail sheet modal/a11y plus visual-viewport/compressed-height reachability progress, `/settings` row/action layout, `/me` long-text/avatar/dashboard layout, and `/members` member-row/action layout completed by Orchestrator.
- Two report-only Phase 4 chat regression worker dispatches were attempted in this round, but subagent creation is still blocked by `agent thread limit reached`; no worker report was fabricated.
- Next safe step: select exactly one remaining task, preferably real authenticated `/schedule` / PWA `mid` validation when device conditions are available, or a read-only audit before higher-risk UI changes.
- Additional implementation/report files currently exist and must not be treated as automatically merged phase output:
  - `docs/agent-reports/shared-components.md`
  - `docs/agent-reports/screen-chat-list.md`
  - `docs/agent-reports/qa-a11y-performance.md`
- The additional reports describe candidate work and validation results, but each related implementation scope still needs Orchestrator review before phase advancement.

## Run Log

- 2026-05-25 JST: User requested "运行"; Orchestrator re-read current phase status, `TASKS_UI.md`, iteration log, W1-W6 reports, and the additional reports.
- 2026-05-25 JST: Current worktree validation completed:
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed; generated 37 routes/static pages.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: No migration, API, RPC, Push, Service Worker, or database validation was performed in this run because the Orchestrator did not make implementation changes.
- 2026-05-25 JST: User requested starting execution from the generated prompt pack. Orchestrator selected the smallest Phase 2 task: complete button/input/label/status rules in `DESIGN_SYSTEM.md`.
- 2026-05-25 JST: Attempted to dispatch a report-only Phase 2 worker for design-system rules, but the subagent tool returned `agent thread limit reached`. No worker output was fabricated.
- 2026-05-25 JST: Orchestrator completed the docs-only Phase 2 task locally and updated `TASKS_UI.md`.
- 2026-05-25 JST: User requested "继续"; Orchestrator selected the next smallest Phase 2 task: classify existing `app/globals.css` semantic classes into keep / narrow scope / extraction candidate / deprecation plan.
- 2026-05-25 JST: Attempted Phase 2 worker dispatch for globals semantics in the prior continuation path, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator reviewed W3 style-semantics output and `app/globals.css`, added the classification to `DESIGN_SYSTEM.md`, and finalized the corresponding `TASKS_UI.md` item.
- 2026-05-25 JST: User requested "继续"; Orchestrator selected the next Phase 2 P1 task: define Dialog, Sheet, Toast, and Action Menu layering, visual viewport, dismiss layer, safe-area, and focus strategy.
- 2026-05-25 JST: Attempted to dispatch a report-only Phase 2 worker for Dialog/Toast layering, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator reviewed W5 chat layering, W6 schedule layering, `components/Dialog.tsx`, `components/Toast.tsx`, `components/KeeperRequestSheet.tsx`, `components/ChatInput.tsx`, `app/chat/page.tsx`, and `app/schedule/page.tsx`, then added the docs-only layering strategy to `DESIGN_SYSTEM.md`.
- 2026-05-25 JST: User requested "继续"; Orchestrator selected the next Phase 2 P2 task: define icon asset rules and decide whether to keep `public/ui-icons` or introduce an icon library.
- 2026-05-25 JST: Attempted to dispatch a report-only Phase 2 worker for icon assets, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator reviewed `package.json`, `public/ui-icons`, `components/ui/BottomTabBar.tsx`, `components/RoleSelect.tsx`, `components/ChatInput.tsx`, `components/Toast.tsx`, and icon usage scan results, then documented a conservative decision to keep `public/ui-icons` for now.
- 2026-05-25 JST: User requested autonomous continuation; Orchestrator selected the next Phase 2 P2 task: define the color usage matrix and decide whether schedule `fuchsia` / `cyan` tones are allowed.
- 2026-05-25 JST: Attempted to dispatch a report-only Phase 2 worker for the color matrix, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator reviewed `tailwind.config.ts`, `app/schedule/page.tsx` schedule tone mapping, W3 style-semantics findings, and broad color usage scan results, then documented `fuchsia` / `cyan` as schedule-only type tones.
- 2026-05-25 JST: User requested starting code changes. Orchestrator selected the smallest safe implementation: add note/chip/badge semantic classes and adopt them only in low-risk account/settings UI.
- 2026-05-25 JST: Attempted to dispatch a report-only validation worker for the note/chip/badge implementation scope, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator updated `app/globals.css`, `app/create-family/page.tsx`, `app/verify-family-code/page.tsx`, `app/join/page.tsx`, and `app/settings/page.tsx`; no chat, schedule, Push logic, RPC, database, or Service Worker code changed.
- 2026-05-25 JST: User requested continuation. Orchestrator selected Phase 3 P1 button component/semantic audit.
- 2026-05-25 JST: Attempted to dispatch a report-only Phase 3 worker for button semantics, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator found that `.btn-sm` / `.btn-md` / `.btn-lg` / `.btn-icon` were defined before button variants that `@apply btn`, causing `components/ui/Button.tsx` size modifiers to be overridden. The size modifier rules were moved after variants in `app/globals.css`.
- 2026-05-25 JST: Button semantics validation completed:
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: initial run hit a stale `.next` cache missing chunk; after clearing generated `.next`, rerun passed with 37 routes/static pages.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
  - Browser smoke check for `/join` at 360px, 390px, and 430px: no horizontal overflow or button-area overflow observed.
- 2026-05-25 JST: User requested continuation; Orchestrator selected Phase 3 P1 form controls audit.
- 2026-05-25 JST: Attempted to dispatch a report-only Phase 3 worker for form controls, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator completed a small form-control semantics implementation locally: `field` now includes `min-w-0`, `label` / `field-hint` / `field-error-text` allow long text wrapping, and `components/ui/TextField.tsx` links errors with `aria-errormessage`.
- 2026-05-25 JST: Form controls validation completed:
  - `npm run typecheck`: passed.
  - `npm run lint`: passed.
  - `npm run build`: passed with 37 routes/static pages.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
  - Browser smoke check for `/forgot-password` at 360px, 390px, and 430px on `http://localhost:3001`: no horizontal overflow or form-control overflow observed.
  - The existing `http://localhost:3000` dev server still returned a stale `.next` missing chunk error, so a clean dev server was started on port 3001 for browser validation.
- 2026-05-25 JST: User requested continuation; Orchestrator selected Phase 3 P1 Dialog local mobile/focus review.
- 2026-05-25 JST: Attempted to dispatch a report-only Phase 3 worker for Dialog mobile review, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator completed a small Dialog shell implementation locally: extracted `dialog-panel` / `dialog-actions`, added modal `role="dialog"` / `aria-modal`, used the current dialog title as `aria-label`, moved initial focus into the dialog wrapper, and restored focus on close.
- 2026-05-25 JST: Dialog browser smoke used a temporary local-only `/dialog-smoke` route to open a long-label confirm dialog at 360px, 390px, and 430px. The temporary route was deleted immediately after verification.
- 2026-05-25 JST: Dialog validation completed before governance doc updates:
  - `npm run typecheck`: passed.
  - `npm run lint`: passed.
  - `npm run build`: passed with 37 routes/static pages.
  - Browser smoke check at 360px, 390px, and 430px on `http://localhost:3001/dialog-smoke`: no horizontal overflow; `role="dialog"`, `aria-modal="true"`, title label, panel bounds, action wrapping, and focus entry verified.
  - Clean dev server on port 3001 was stopped after smoke testing.
- 2026-05-25 JST: Final post-doc validation completed:
  - `npm run lint`: passed.
  - `npm run typecheck`: initially hit stale `.next/types` from the deleted temporary smoke route; after clearing generated `.next`, rerun passed.
  - `npm run build`: passed with 37 routes/static pages after clearing `.next`.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: User requested continuation; Orchestrator selected Phase 3 P1 Toast safe-area/occlusion review.
- 2026-05-25 JST: Attempted to dispatch a report-only Phase 3 worker for Toast audit, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator completed a small Toast shell implementation locally: extracted `toast-viewport`, `toast-bar`, tone variants, and `toast-message`; mobile Toast bottom offset now accounts for `env(safe-area-inset-bottom)` and bottom input/navigation height; Toast bars have a readable dismiss label and decorative icons are hidden from assistive tech.
- 2026-05-25 JST: Toast browser smoke used a temporary local-only `/toast-smoke` route with a bottom fixed input bar to verify 360px, 390px, and 430px. The temporary route was deleted immediately after verification.
- 2026-05-25 JST: Toast validation completed before governance doc updates:
  - `npm run typecheck`: passed.
  - `npm run lint`: passed.
  - `npm run build`: passed with 37 routes/static pages after clearing generated `.next`.
  - Browser smoke check at 360px, 390px, and 430px on `http://localhost:3001/toast-smoke`: no horizontal overflow; Toast did not overlap the bottom input bar; `role="status"`, `aria-live="polite"`, and dismiss label verified.
  - Clean dev server on port 3001 was stopped after smoke testing.
- 2026-05-25 JST: Final post-doc validation completed:
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: User requested continuation; Orchestrator selected Phase 3 P1 AssistantActionCard / KeeperRequestSheet review.
- 2026-05-25 JST: Attempted to dispatch a report-only Phase 3 worker for Assistant/Keeper audit, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator completed a small Assistant/Keeper layout implementation locally: assistant action rows now use wrapping shared classes, and KeeperRequestSheet uses shared sheet backdrop/panel/body/actions classes for max-height, internal scroll, footer visibility, and bottom safe-area.
- 2026-05-25 JST: Assistant/Keeper browser smoke used a temporary local-only `/assistant-keeper-smoke` route to verify 360px, 390px, and 430px. The temporary route was deleted immediately after verification.
- 2026-05-25 JST: Assistant/Keeper validation completed before governance doc updates:
  - `npm run typecheck`: passed.
  - `npm run lint`: passed.
  - `npm run build`: passed with 37 routes/static pages after clearing generated `.next`.
  - Browser smoke check at 360px, 390px, and 430px on `http://localhost:3001/assistant-keeper-smoke`: no horizontal overflow; assistant action row wrapped safely; Keeper sheet footer remained visible and body scrolled internally.
  - Clean dev server on port 3001 was stopped after smoke testing.
- 2026-05-25 JST: Final post-doc validation completed:
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: User requested continuation; Orchestrator selected Phase 4 P1 chat message action menu viewport clamp.
- 2026-05-25 JST: Attempted to dispatch a report-only Phase 4 worker for chat action menu audit, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator completed a small chat action menu implementation locally: action menu placement now preserves the original trigger point, measures the rendered menu, clamps against `window.visualViewport`, reserves bottom composer space when available, and recalculates on visual viewport `resize` / `scroll`, window resize, and orientation change.
- 2026-05-25 JST: Orchestrator also extracted `chat-action-dismiss-layer` / `chat-action-menu`, raised the dismiss/menu layer above the input chrome but below sheet/dialog/toast, and added `role="menu"` / `menuitem`, Escape close, and focus restoration.
- 2026-05-25 JST: Chat action menu browser smoke used a temporary local-only `/chat-action-menu-smoke` route to verify 360px, 390px, and 430px. The temporary route was deleted immediately after verification.
- 2026-05-25 JST: Chat action menu validation completed:
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed with 37 routes/static pages after clearing generated `.next`.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
  - Browser smoke check at 360px, 390px, and 430px on `http://127.0.0.1:3001/chat-action-menu-smoke`: no horizontal overflow; menu stayed inside viewport and above the composer; `role="menu"` / four `menuitem`s and z-index layering verified.
  - Clean dev server on port 3001 was stopped after smoke testing.
- 2026-05-25 JST: User requested continuation; Orchestrator selected Phase 4 P1 ChatInput popover height/placement audit.
- 2026-05-25 JST: Attempted to dispatch a report-only Phase 4 worker for ChatInput popover audit, but subagent creation was still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator completed a small ChatInput popover implementation locally: more-actions and whisper picker popovers now derive max height from available visual viewport space above the input shell, recalculate on visual viewport `resize` / `scroll`, window resize, and orientation change, and keep long whisper member lists internally scrollable.
- 2026-05-25 JST: Orchestrator also extracted `chat-input-actions-popover`, `chat-input-whisper-popover`, and `chat-input-whisper-list`, allowed action buttons to wrap on narrow widths, and added `aria-controls`, popover focus entry, and Escape focus return.
- 2026-05-25 JST: ChatInput browser smoke used a temporary local-only `/chatinput-popover-smoke` route with 18 members to verify 360px, 390px, 430px, and compressed 360px-high viewport behavior. The temporary route was deleted immediately after verification.
- 2026-05-25 JST: ChatInput validation completed:
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed with 37 routes/static pages after clearing generated `.next`.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
  - Browser smoke check at 360px, 390px, and 430px on `http://127.0.0.1:3001/chatinput-popover-smoke`: no horizontal overflow; actions popover stayed above input; whisper picker stayed inside viewport and above input; whisper list was internally scrollable.
  - Compressed-height smoke at 360px, 390px, and 430px wide by 360px tall: whisper picker remained inside viewport and above input, with internal list scrolling.
  - Clean dev server on port 3001 was stopped after smoke testing.
- 2026-05-25 JST: User requested continuation; Orchestrator selected Phase 4 read-only `/chat` regression audit before more chat UI implementation.
- 2026-05-25 JST: Attempted to dispatch two report-only Phase 4 workers for `/chat` viewport/input and sync/Push audits, but subagent creation was still blocked by `agent thread limit reached`; no worker reports were fabricated.
- 2026-05-25 JST: Orchestrator completed the audit locally and wrote `docs/agent-reports/20260525-phase4-chat-regression-orchestrator.md`.
- 2026-05-25 JST: Orchestrator applied one smallest safe fix from the audit: `/chat?mid=` notification scroll guard in `app/chat/page.tsx` now records the last handled message id instead of a page-lifetime boolean, allowing later different notification targets in the same mounted chat page.
- 2026-05-25 JST: Chat regression `mid` guard validation completed:
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed with 37 routes/static pages.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
  - Manual real Push/PWA validation was not performed locally; it remains a dedicated follow-up task in `TASKS_UI.md`.
- 2026-05-25 JST: User approved continuation; Orchestrator selected Phase 4 P2 `ChatMessage` long text / long address / media / whisper bubble smoke.
- 2026-05-25 JST: Orchestrator created temporary local-only `/chat-message-bubble-smoke` route with real `ChatMessage` cases covering long nicknames, long unbroken text, long location address, private location, private image, long audio, deleted, and system messages.
- 2026-05-25 JST: ChatMessage bubble browser smoke passed at 360px, 390px, and 430px on `http://127.0.0.1:3001/chat-message-bubble-smoke`: no horizontal overflow and no overflowing bubble descendants were observed.
- 2026-05-25 JST: Because no overflow was reproduced, Orchestrator did not modify permanent `ChatMessage` code. The temporary smoke route was deleted, the dev server on port 3001 was stopped, and generated `.next` was cleared before final validation.
- 2026-05-25 JST: Orchestrator wrote `docs/agent-reports/20260525-phase4-chatmessage-bubble-smoke.md` and finalized the corresponding `TASKS_UI.md` item.
- 2026-05-25 JST: ChatMessage bubble smoke final validation completed:
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed with 37 routes/static pages; temporary smoke route was not present in the route table.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: User requested direct continuation without further questions; Orchestrator selected Phase 4 P2 `ChatInput` recording viewport/orientation audit.
- 2026-05-25 JST: Orchestrator chose privacy-cancel instead of safe-rect recompute: active recording now cancels on visual viewport `resize` / `scroll`, window `resize`, and `orientationchange`, using the existing privacy cancel path.
- 2026-05-25 JST: Orchestrator updated `lib/i18n.ts` recording consent/stopped copy in zh/ja/en to mention backgrounding, screen rotation, and viewport changes.
- 2026-05-25 JST: ChatInput recording consent browser smoke used a temporary local-only `/chatinput-recording-consent-smoke` route to verify the longer consent dialog copy at 360px, 390px, and 430px. The temporary route was deleted after verification, the dev server on port 3001 was stopped, and generated `.next` was cleared before final validation.
- 2026-05-25 JST: Orchestrator wrote `docs/agent-reports/20260525-phase4-chatinput-recording-viewport.md`, updated `DESIGN_SYSTEM.md`, and finalized the corresponding `TASKS_UI.md` item.
- 2026-05-25 JST: ChatInput recording viewport/orientation final validation completed:
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed with 37 routes/static pages; temporary smoke route was not present in the route table.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: User approved continuation; Orchestrator selected `/schedule` P0 read-only regression audit progress because real PWA notification/device validation conditions were not available locally.
- 2026-05-25 JST: Orchestrator reviewed W6 schedule layering findings, `app/schedule/page.tsx`, `lib/scheduleService.ts`, Dialog and Sheet baselines, then applied the smallest local fix: `ScheduleDetailPanel` now has modal `role="dialog"`, `aria-modal`, title binding, focus entry/restoration, Tab focus loop, and Escape behavior.
- 2026-05-25 JST: Orchestrator wrote `docs/agent-reports/20260525-phase4-schedule-regression-orchestrator.md` and updated `TASKS_UI.md` with progress while keeping the broader `/schedule` P0 regression item open.
- 2026-05-25 JST: Schedule detail sheet a11y validation completed before final build:
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
- 2026-05-25 JST: Schedule detail sheet a11y final validation completed:
  - `npm run build`: passed with 37 routes/static pages.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: User requested continuation; Orchestrator continued the `/schedule` P0 detail sheet task and added visual viewport-aware overlay height/offset handling without changing schedule RPC, permissions, Push, Service Worker, Realtime, or database behavior.
- 2026-05-25 JST: Browser smoke was attempted on `http://127.0.0.1:3001/schedule`, but the in-app browser had no usable local family session and the real detail sheet could not be opened; no authenticated sheet validation was claimed. The dev server on port 3001 was stopped and temporary logs were removed.
- 2026-05-25 JST: Schedule detail sheet viewport validation completed before final build:
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
- 2026-05-25 JST: Schedule detail sheet viewport final validation completed:
  - `npm run build`: passed with 37 routes/static pages.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: User approved continuation; Orchestrator continued the `/schedule` P0 detail sheet task with a temporary in-page smoke fixture, then removed the fixture before final validation.
- 2026-05-25 JST: The fixture smoke at 360px, 390px, and 430px widths with a 520px compressed viewport reproduced a clipped/unreachable assignee decline control. Orchestrator applied the smallest layout fix: the detail read body now scrolls vertically, and the conversation section has a minimum usable height so assignment controls, comment input, and the final action buttons do not visually overlap.
- 2026-05-25 JST: Temporary smoke fixture and query entry were removed from `app/schedule/page.tsx`; `rg` confirmed no `__smoke`, `ScheduleDetailSmokeFixture`, or smoke data remained.
- 2026-05-25 JST: Schedule detail compressed-height fixture validation completed before fixture removal:
  - Browser smoke on `http://127.0.0.1:3001/schedule?__smoke=detail` at 360px/390px/430px by 520px: no horizontal scroll; dialog stayed inside viewport; decline reason opened and accepted text; comment input/send became reachable; edit save was reachable.
  - Browser console errors/warnings: none.
  - In-app screenshot capture was attempted but timed out; DOM/interaction measurements were used as evidence.
- 2026-05-25 JST: Schedule detail compressed-height final validation after fixture removal completed:
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed with 37 routes/static pages.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: User requested analyzing and executing all provided Markdown files. Orchestrator re-read the governance docs, prompt pack files, phase status, task ledger, and latest iteration log, then selected the next smallest Phase 4 task: `/settings` P1 row/action layout.
- 2026-05-25 JST: Attempted to dispatch Worker W7 for report-only `/me` audit, but subagent creation is still blocked by `agent thread limit reached`; no worker report was fabricated.
- 2026-05-25 JST: Orchestrator completed a small `/settings` implementation locally: added `settings-row-*`, `settings-family-code-*`, and `settings-action-grid`; updated `Row`, `DiagRow`, family code, Push action buttons, Push status row, and reminder health header layout.
- 2026-05-25 JST: `/settings` browser smoke used a temporary local-only `/settings-layout-smoke` route to verify 360px, 390px, and 430px. The temporary route was deleted immediately after verification.
- 2026-05-25 JST: `/settings` layout validation completed:
  - Temporary route smoke at 360px/390px/430px: no horizontal scroll, no overflowing descendants, long family name/code/diagnostic values stayed inside viewport, and console had no errors or warnings.
  - `npm run lint`: passed.
  - `npm run typecheck`: initially hit stale `.next/types` from the deleted temporary smoke route; after clearing generated `.next`, rerun passed.
  - `npm run build`: passed with 37 routes/static pages.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: Orchestrator continued the Markdown-driven Phase 4 execution and selected `/me` P1 long nickname/avatar/personal dashboard/empty-state layout.
- 2026-05-25 JST: Orchestrator completed a small `/me` implementation locally: header and identity long text now wrap, avatar actions use a predictable narrow/mobile grid, personal dashboard headers/meta chips/empty states shrink safely, private lock badges have screen-reader text, and the upcoming schedule link has a 36px touch target.
- 2026-05-25 JST: `/me` browser smoke used a temporary local-only `/me-layout-smoke` route to verify 360px, 390px, and 430px. The temporary route was deleted immediately after verification.
- 2026-05-25 JST: `/me` layout validation completed:
  - Temporary route smoke at 360px/390px/430px: no horizontal scroll, no overflowing descendants, long nickname/family name/assignee text stayed inside viewport, private lock labels were present, minimum interactive target was 36px, and console had no errors or warnings.
  - `npm run lint`: passed.
  - `npm run typecheck`: initially hit stale `.next/types` from the deleted temporary smoke route; after clearing generated `.next`, rerun passed.
  - `npm run build`: passed with 37 routes/static pages.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: Orchestrator continued Phase 4 and selected `/members` P1 member list/role/remove/keeper/long nickname layout.
- 2026-05-25 JST: Orchestrator completed a small `/members` implementation locally: member rows are split into identity and action zones, 360px/390px stay stacked, 430px restores row layout, long names/status text wrap safely, admin/me/keeper use shared status badges, remove button touch target is `min-h-10`, and load-error actions are single-column on narrow widths.
- 2026-05-25 JST: `/members` browser smoke used a temporary local-only `/members-layout-smoke` route to verify 360px, 390px, and 430px. The first 390px smoke exposed over-compression, so the member-row breakpoint was moved from 390px to 430px; the temporary route was deleted after the passing rerun.
- 2026-05-25 JST: `/members` layout validation completed:
  - Temporary route smoke at 360px/390px/430px: no horizontal scroll, no overflowing descendants, long member/keeper names stayed inside viewport, icon-only action labels were present, minimum interactive target was 36px, and console had no errors or warnings.
  - `npm run lint`: passed.
  - `npm run typecheck`: initially hit stale `.next/types` from the deleted temporary smoke route; after clearing generated `.next`, rerun passed.
  - `npm run build`: passed with 37 routes/static pages.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: Orchestrator selected the remaining low-risk Phase 3 P2 `RoleSelect / RoleBadge` task instead of unactionable real PWA/authenticated validation, because local device/session conditions for those higher-risk checks were not available.
- 2026-05-25 JST: Orchestrator completed a small RoleSelect / RoleBadge implementation locally: `RoleSelect` now has radiogroup/radio/aria-checked semantics, a visible non-color check marker for selected state, focus-visible ring, and compact 360px icon sizing; `RoleBadge` uses the shared `tone-chip` base.
- 2026-05-25 JST: RoleSelect / RoleBadge browser smoke used a temporary local-only `/role-select-smoke` route to verify 360px, 390px, and 430px. The temporary route was deleted after validation.
- 2026-05-25 JST: RoleSelect / RoleBadge validation completed:
  - Temporary route smoke at 360px/390px/430px: no horizontal scroll, no overflowing descendants, one radiogroup, three radios, one checked radio, one visible check marker, three role badges, minimum target height 112px, and console had no errors or warnings.
  - `npm run lint`: passed.
  - `npm run typecheck`: initially hit stale `.next/types` from the deleted temporary smoke route; after clearing generated `.next`, rerun passed.
  - `npm run build`: passed with 37 routes/static pages.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: User requested continuation; Orchestrator selected the remaining low-risk Phase 3 P2 `AudioBubble` task for playback state, unplayed state, important highlight, and screen-reader clarity.
- 2026-05-25 JST: Orchestrator completed a small AudioBubble implementation locally: the button now has localized `aria-label` / `title`, `aria-pressed`, a screen-reader unplayed status, decorative icon/waveform hiding, a focus-visible ring, and narrow-width `min-w-0`; no audio upload, send, media URL, RPC, Push, Service Worker, Realtime, Storage, permission, or database logic changed.
- 2026-05-25 JST: AudioBubble browser smoke used a temporary local-only `/audio-bubble-smoke` route to verify 360px, 390px, and 430px. The temporary route was deleted after validation, the dev server on port 3001 was stopped, temporary logs were removed, and generated `.next` was cleared before final validation.
- 2026-05-25 JST: AudioBubble validation completed:
  - Temporary route smoke at 360px/390px/430px: no horizontal scroll, no overflowing descendants, two audio buttons had readable labels/title/pressed state, incoming unplayed audio exposed sr-only text, important highlight rendered once, decorative spans were hidden, minimum button height was 48px, and console had no errors or warnings.
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed with 37 routes/static pages; temporary smoke route was not present in the route table.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.
- 2026-05-25 JST: User confirmed continuation; Orchestrator selected the remaining low-risk Phase 3 P2 `ImportantNoticeBar` task for expanded-state, long-title/read-state, and remove-button stability.
- 2026-05-25 JST: Orchestrator completed a small ImportantNoticeBar implementation locally: the expand control now has `aria-controls` and a readable label, expanded content uses list/listitem semantics, list height is viewport-relative and scrollable, selectable rows have focus-visible rings and stable title-backed truncation, remove buttons use decorative SVG icons, and read-state separators are ASCII-stable; no important notification service, message visibility, RPC, Push, Service Worker, Realtime, Storage, permission, or database logic changed.
- 2026-05-25 JST: ImportantNoticeBar browser smoke used a temporary local-only `/important-notice-smoke` route to verify 360px, 390px, and 430px. The temporary route was deleted after validation, the dev server on port 3001 was stopped, temporary logs were removed, and generated `.next` was cleared before final validation.
- 2026-05-25 JST: ImportantNoticeBar validation completed:
  - Temporary route smoke at 360px/390px/430px: no horizontal scroll, no overflowing descendants, three list items rendered, row heights stayed stable, remove buttons stayed 40px by 40px with label/title and hidden SVGs, long preview/read-state strings stayed inside the viewport with full text in `title`, select interaction updated selected id, remove interaction reduced list items from 3 to 2, and console had no errors or warnings.
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed with 37 routes/static pages; temporary smoke route was not present in the route table.
  - `git diff --check`: passed; only existing LF/CRLF working-copy warnings.

## Validation Policy

- Current orchestration round includes an ImportantNoticeBar component stability/a11y implementation, temporary-route mobile smoke, fixture cleanup, an Orchestrator report update, and governance record updates.
- Required local validation before closing the round: `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- Markdown trailing-whitespace scan for `PHASE_STATUS.md`, `TASKS_UI.md`, `docs/iteration-log/`, and `docs/agent-reports/` passed after cleaning W2 report line endings.
- Code validation commands (`npm run lint`, `npm run typecheck`, `npm run build`) are required for implementation changes and passed for the latest ImportantNoticeBar round.
- Latest full validation run after the user requested "运行": `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check` all passed.
- Latest implementation validation for the Phase 4 ChatInput popover height/placement task passed: `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`, temporary-route browser checks at 360px / 390px / 430px, and compressed 360px-high viewport checks on port 3001.
- Latest implementation validation for the Phase 4 `/chat?mid=` guard fix passed: `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- Latest ChatMessage bubble smoke validation passed: temporary-route browser checks at 360px / 390px / 430px, `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- Latest ChatInput recording viewport/orientation validation passed: temporary-route recording consent Dialog checks at 360px / 390px / 430px, `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- Latest schedule detail sheet viewport/reachability validation passed: compressed-height fixture smoke at 360px/390px/430px by 520px before fixture removal, then `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`; a real authenticated browser smoke remains blocked by missing local family session.
- Latest settings row/action layout validation passed: temporary-route browser smoke at 360px/390px/430px, `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`; real Push permission/test-notification behavior was not changed or validated.
- Latest `/me` layout/a11y validation passed: temporary-route browser smoke at 360px/390px/430px, `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`; real avatar upload/remove and authenticated schedule-item navigation were not changed or validated.
- Latest `/members` layout/a11y validation passed: temporary-route browser smoke at 360px/390px/430px, `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`; real member removal, owner email login, Realtime refresh, and whisper navigation were not changed or validated.
- Latest RoleSelect / RoleBadge validation passed: temporary-route browser smoke at 360px/390px/430px, `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`; real join/create-family submit flows were not changed or validated.
- Latest AudioBubble validation passed: temporary-route browser smoke at 360px/390px/430px, `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`; real authenticated chat playback was not changed or validated.
- Latest ImportantNoticeBar validation passed: temporary-route browser smoke at 360px/390px/430px, select/remove interaction checks, `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`; real authenticated important notification read-state/removal RPC behavior was not changed or validated.

## Current Risks

- The working tree contains many pre-existing modified and untracked files. The Orchestrator must avoid reverting or mixing unrelated changes.
- Phase 1 found no confirmed P0 blocker, but several P1 risks require focused follow-up.
- W2 findings identify P0-risk components for future UI work: `ChatInput`, `ChatMessage`, `Dialog`, `AppPresenceTracker`, and `ServiceWorkerRegister`.
- The latest ChatInput popover smoke check passed at 360px/390px/430px plus compressed 360px-high viewports, and the recording consent copy smoke passed at 360px/390px/430px, but both used temporary local routes; the authenticated real `/chat` path still needs manual keyboard, long-press, recording, whisper, and Push-click regression on real data/dev sessions.
- The `/chat?mid=` guard now allows different later notification targets, but consecutive Push-click behavior still needs real PWA/browser validation because foreground Push postMessage and notification-click navigation can differ by platform.
- The repository contains implementation changes beyond pure Phase 1 reports, including shared UI component and chat list work. These passed local build validation, but should remain candidate work until a dedicated Orchestrator review confirms file scope, UX/mobile checks, and security boundaries.
- Subagent dispatch is currently blocked by the agent thread limit; subsequent multi-agent runs should retry after old agent threads are cleared or run workers in a new session.
- Chat action menu and ChatInput popover placement now avoid the known viewport clamp issues, the `mid` guard no longer blocks all later targets, isolated ChatMessage bubble smoke did not reproduce horizontal overflow, ChatInput recording now privacy-cancels on viewport/orientation changes, schedule detail sheet modal/viewport/compressed-height reachability behavior is improved, settings row/action layout avoids known long-value overflow, `/me` long nickname/avatar/dashboard layout avoids known narrow-width overflow, and `/members` member-row/action layout avoids known narrow-width overflow; the broader `/chat` regression remains open for real keyboard behavior, real device recording/PWA shell behavior, real media data, action-entry polish, and real Push-click return.
- The broader `/schedule` P0 regression remains open: real 360px/390px/430px soft-keyboard behavior, month/week/day switching, private visibility matrix, reminder Push return, and real-data comment/assignee/reminder flows still need validation. The local fixture covered detail-sheet control reachability only, not authenticated permissions or reminder delivery.
- `/settings` real Push permission prompt and test notification behavior were not executed locally. This is acceptable for the completed UI layout task because no Push logic changed, but it remains necessary before release if Push code changes later.
- `/me` real avatar upload/remove and authenticated schedule item navigation were not executed locally. This is acceptable for the completed UI layout task because no avatar service, dashboard RPC, or navigation logic changed.
- `/members` real member removal, owner email login, Realtime refresh, and whisper navigation were not executed locally. This is acceptable for the completed UI layout task because no member service, removal API, auth, Realtime, or navigation logic changed.
- RoleSelect / RoleBadge real `/join` and `/create-family` submit flows were not executed locally. This is acceptable for the completed component task because no form submit, validation, role enum, RPC, auth, or database logic changed.
- AudioBubble real authenticated chat playback was not executed locally. This is acceptable for the completed component semantics task because no audio upload, message send, media URL, playback service, RPC, Push, Service Worker, Realtime, Storage, permission, or database logic changed.
- ImportantNoticeBar real authenticated read-state loading, notification selection scroll, and remove RPC were not executed locally. This is acceptable for the completed component semantics task because no important notification service, message visibility, RPC, Push, Service Worker, Realtime, Storage, permission, or database logic changed.

## Next Safe Task

- Higher-risk remaining task: real authenticated `/schedule` 360px/390px/430px soft-keyboard regression for detail comment input, decline reason, edit save, private visibility, and reminder status flows.
- Alternative safe task: real PWA/manual validation for two consecutive different `/chat?mid=` Push notification clicks when device conditions are available.
- Alternative low-risk page task: account and family flow page audit for `/`, `/verify-family-code`, `/create-family`, `/join`, `/login`, `/register`, `/forgot-password`, and `/reset-password`.
- Alternative authenticated task: `/members` manual smoke for member removal confirmation, owner email login redirect, Realtime refresh, and whisper navigation when a local family session is available.
- Alternative authenticated task: `/me` manual smoke for avatar upload/remove and schedule-item navigation when a local family session is available.
- Scope should remain low-risk and component-focused; do not touch chat/schedule business logic, Push, RPC, Realtime, Storage, or Service Worker without dedicated validation.
