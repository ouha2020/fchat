# 2026-05-25 Phase 1 Style Semantics Audit - W3

## Scope / files reviewed

- Governance docs read: `AGENTS.md`, `UI_RULES.md`, `DESIGN_SYSTEM.md`, `TASKS_UI.md`, `CODEX_UI_LOOP.md`, `PHASE_STATUS.md`, `docs/iteration-log/_latest.md`.
- Style base reviewed: `app/globals.css`, `tailwind.config.ts`.
- App UI reviewed by static scan and spot reads: `app/layout.tsx`, `app/page.tsx`, `app/chat/page.tsx`, `app/schedule/page.tsx`, `app/me/page.tsx`, `app/members/page.tsx`, `app/settings/page.tsx`, `app/admin/system-health/page.tsx`, account/family flow pages, `app/image-preview/page.tsx`, `app/offline/page.tsx`, `app/mood-tree/page.tsx`.
- Components reviewed by static scan and spot reads: `components/*.tsx`, `components/ui/*.tsx`.
- Out of scope by assignment: no edits to global CSS, Tailwind config, app pages, components, lib, public, supabase, types, task/status docs, or iteration log.

## Summary

`app/globals.css` already has a useful semantic base: page shells, buttons, fields, cards, bottom tab bar, notes, chips, native press/scroll helpers, chat paper, dialog/toast animations, and mood-tree feature classes. The main gap is not lack of primitives, but uneven adoption and missing semantic names for patterns now repeated in high-risk UI areas.

The highest-value future extractions are Dialog/Sheet shells, tonal chips/status badges, soft note panels, repeated white/slate surfaces, chat icon buttons, and small pill actions. These should be introduced incrementally with no visual deltas, then adopted one page/component at a time.

## Findings

### P0

- No P0 style-semantics issue found in this static audit. I did not see an immediate style abstraction problem that by itself blocks users, exposes permissions, or forces a chat/schedule architecture change.

### P1

- Global semantics exist but are only partially connected to the emerging component wrapper layer. `components/ui/Button.tsx`, `Card.tsx`, `TextField.tsx`, and `BottomTabBar.tsx` map to semantic classes, but I found no external imports of `components/ui/*` from app pages/components. Direct `className` usage remains the real source of truth. Risk: future refactors may update wrappers while the product still renders old direct classes.
- Dialog panel styling is repeated verbatim six times in `components/Dialog.tsx` (`mx-4 rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200 sm:mx-0`). This is a good P1 extraction because dialog a11y, keyboard behavior, mobile max height, and safe-area behavior need to stay consistent.
- Chat icon button styling is duplicated as local constants in `app/chat/page.tsx` and `components/ChatInput.tsx`, with only size/opacity differences. It currently depends on `.native-icon-button` and `.native-press`. This should be treated as chat-specific and changed only after W5's layering audit because these buttons sit near notification, toolbar, recording, whisper, and input controls.
- Tonal status chips are repeated across schedule, assistant cards, mood tree, members, and system health. Examples include `rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100` and rose/amber/slate variants. Risk: semantic meaning of green/amber/rose/violet drifts per feature, especially around schedule privacy, reminder delivery, assistant action status, and health status.
- `app/schedule/page.tsx` introduces local tone colors including `fuchsia` and `cyan` in `scheduleToneClasses`, while `DESIGN_SYSTEM.md` documents `brand`, `slate`, `rose`, `emerald`, `amber`, `sky/blue/violet`. This is not a breakage, but it needs design-system approval before extraction to global semantics.

### P2

- Soft surface patterns are repeated outside `section-card`: `rounded-2xl bg-white p-3 ring-1 ring-slate-100`, `rounded-2xl bg-slate-50 p-3`, and `rounded-xl bg-slate-50 p-3 text-sm ...` appear in schedule detail, settings, me, join, mood tree, and admin health. Candidate: a small family of `surface-*` / `note-*` classes or a component-level primitive.
- Existing `status-note`, `error-note`, and `success-note` cover only slate/rose/emerald. Sky info and amber warning notes are manually repeated in create/join/verify/settings/schedule. Candidate: `info-note` and `warning-note`, or a documented tone matrix.
- Existing `meta-chip` is useful but narrow: it has slate-only color and no ring. Most real chip usage needs tone variants, truncation, or ring. Candidate: `chip`, `chip-muted`, `chip-info`, `chip-success`, `chip-warning`, `chip-danger`, `chip-private`, with explicit text overflow rules.
- `icon-action` is only used on the landing page, while many icon-only actions hand-roll size, focus ring, hover, and tone. Candidate: extend icon action semantics or introduce scoped variants such as `icon-action-soft`, `icon-action-danger`, `icon-action-brand`.
- Small pill actions are repeated in `AssistantActionCard`, `mood-tree`, `image-preview`, and chat/schedule micro-actions. Current `.btn` variants are rounded-xl and heavier; forcing those onto pill controls may change feel. Candidate: `pill-action`, `pill-action-primary`, `pill-action-muted`, preferably as component-level constants first.
- Safe-area bottom padding appears inline in chat input states and schedule detail body. This should remain behavior-preserving, but a future `safe-bottom-panel`/`safe-bottom-bar` semantic could reduce drift.

### P3

- Mood-tree global classes (`mood-*`) are intentionally feature-specific and include reduced-motion handling. They do not need immediate deprecation, but they are not reusable global semantics. Future cleanup could move them behind a feature namespace/module if the repo adopts CSS modules or a feature CSS file.
- `.card` and `.card-compact` are generic and under-adopted compared with `section-card` and direct `rounded-2xl bg-white ...` patterns. Keep for compatibility, but avoid broad new usage until the card taxonomy is clarified.
- `.native-*` names describe feel/implementation rather than role. They are acceptable as low-level helpers today, but should not become the public design-system vocabulary for every new pattern.

## Extraction candidates

| Candidate | Suggested priority | Source examples | Notes / guardrails |
| --- | --- | --- | --- |
| `dialog-panel` | P1 | `components/Dialog.tsx` repeated panel class | Extract inside Dialog first; preserve keyboard, focus, and mobile scroll behavior. |
| `sheet-backdrop`, `sheet-panel`, `sheet-body-safe` | P1 | `components/KeeperRequestSheet.tsx`, `app/schedule/page.tsx` detail sheet | Coordinate with W6; safe-area and max-height must be validated at 360/390/430px. |
| `tone-chip-*` / `status-badge-*` | P1 | schedule badges, assistant status, health status, member role chips | Define tone meanings before CSS. Avoid mixing privacy, health, and action status without labels. |
| `surface-soft`, `surface-card`, `surface-muted` | P2 | schedule subpanels, settings/me notes, mood tree panels | Keep page sections unframed where the design rules require it; do not turn every band into a card. |
| `info-note`, `warning-note` | P2 | sky/amber note blocks in account/family flows and schedule | Complements existing `status-note`, `error-note`, `success-note`. |
| `icon-action-*` variants | P2 | settings copy, schedule nav/new, members whisper/keeper, notice remove | Must keep `aria-label`/`title` checks attached to usage. |
| `chat-icon-button` with size modifiers | P1/P2 | `chatHeaderIconClass`, `ChatInput` `iconButtonClass` | Chat-specific; wait for layering audit before touching. |
| `pill-action-*` | P2 | assistant card buttons, mood tree choices, image preview controls | Prefer local/component constants first to avoid global bloat. |
| `avatar-token-*` | P2 | chat, members, schedule comments, notice avatars | Could normalize size/tone, but keep sender/role/private semantics explicit. |
| `chat-mode-bar` | P2 | keeper request bar and whisper bar in chat | Only after W5 confirms z-index/input/keyboard layering. |

## Deprecation planning candidates

- `.card`: too generic next to `section-card`, `action-card`, `empty-state`, and the new `Card` wrapper. Plan: freeze new direct uses, document intended scope, then migrate to more specific variants if needed.
- `.native-icon-button`: currently useful for chat toolbar/header image-background buttons, but the name is not semantic. Plan: keep alias, introduce `chat-icon-button` or `tool-icon-button`, then migrate chat-only usages carefully.
- `.native-input-bar`: currently appears chat-specific. Plan: keep behavior and alias, but eventually expose a role-based name such as `chat-input-shell`.
- `.meta-chip`: narrow slate chip. Plan: either keep as muted chip only or replace with a tonal chip family; do not silently change its color/ring.
- Feature-specific `mood-*` globals: no immediate deprecation. Plan: mark as feature-owned, not reusable design-system classes.

## Risks

- Most high-value candidates touch chat or schedule surfaces. A "semantic only" class replacement can still break mobile keyboard, scroll, safe-area, z-index, or message/menu positioning.
- Global CSS changes have wide blast radius because pages still rely heavily on direct Tailwind strings and wrappers are not broadly adopted.
- Color semantics are not fully normalized. Extracting tone classes before defining the color matrix can make privacy, warning, success, and assistant states visually inconsistent.
- The current working tree already contains many unrelated modified/untracked files. Any implementation phase must avoid mixing worker report changes with those edits.

## Minimal next tasks

1. Orchestrator reviews W1-W6 reports together before changing `TASKS_UI.md`.
2. Add a Phase 2 design-system task to classify existing `app/globals.css` classes into: keep, keep but narrow scope, candidate extraction, deprecation-plan only.
3. Start implementation with a low-risk, contained extraction: `components/Dialog.tsx` `dialog-panel`, or `info-note`/`warning-note` on account/family flow pages.
4. For schedule tones, first document the accepted tone matrix, including whether `fuchsia` and `cyan` remain allowed.
5. For chat toolbar/input classes, wait for W5 layering findings before any class replacement.

## Validation suggestions

- Documentation-only closure: run `git diff --check`.
- Before any style extraction: run `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- For UI implementation tasks: manually check 360px, 390px, and 430px widths, no horizontal scrolling, no button text overflow, and no sheet/dialog overflow.
- For chat-related classes: manually verify dynamic viewport (`100dvh`/custom chat viewport), input bar, recording, toolbar, whisper bar, important notice bar, message action menu, and notification click positioning.
- For schedule-related classes: manually verify month/week/day switching, detail sheet scrolling, comment input, assignee response controls, reminder delivery/status chips, and keyboard overlap.
- For a11y: re-check icon-only controls for `aria-label` or `title`, focus-visible state, and keyboard completion for Dialog/Sheet/action menus.

## Modification statement

W3 modified exactly one file for this task: `docs/agent-reports/20260525-phase1-style-semantics.md`. I did not modify any file besides this report.
