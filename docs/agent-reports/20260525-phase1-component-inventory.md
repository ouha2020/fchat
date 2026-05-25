# Phase 1 Component Inventory - Worker W2

Date: 2026-05-25 JST
Scope: report-only component inventory for HomeTree / FamilyChat UI refactor.
Write scope used: this file only.

## Scope And Files Reviewed

Governance and phase control:

- `AGENTS.md`
- `UI_RULES.md`
- `DESIGN_SYSTEM.md`
- `TASKS_UI.md`
- `CODEX_UI_LOOP.md`
- `PHASE_STATUS.md`
- `docs/iteration-log/_latest.md`
- `docs/agent-reports/README.md`

Component inventory source:

- `components/AppPresenceTracker.tsx`
- `components/AssistantActionCard.tsx`
- `components/AudioBubble.tsx`
- `components/ChatInput.tsx`
- `components/ChatMessage.tsx`
- `components/Dialog.tsx`
- `components/EffectOverlay.tsx`
- `components/EnvWarning.tsx`
- `components/ImportantNoticeBar.tsx`
- `components/KeeperRequestSheet.tsx`
- `components/LanguageProvider.tsx`
- `components/RoleBadge.tsx`
- `components/RoleSelect.tsx`
- `components/ServiceWorkerRegister.tsx`
- `components/Toast.tsx`
- `components/ui/BottomTabBar.tsx`
- `components/ui/Button.tsx`
- `components/ui/Card.tsx`
- `components/ui/TextField.tsx`
- `components/ui/classNames.ts`

Supporting files reviewed for ownership and dependencies:

- `public/ui-icons/*.png`
- `app/globals.css`
- `app/layout.tsx`
- `app/chat/page.tsx`
- `app/schedule/page.tsx`
- `app/settings/page.tsx`
- `app/me/page.tsx`
- `app/members/page.tsx`
- `app/page.tsx`
- `app/create-family/page.tsx`
- `app/join/page.tsx`
- `app/login/page.tsx`
- `app/register/page.tsx`
- `app/forgot-password/page.tsx`
- `app/reset-password/page.tsx`
- `app/verify-family-code/page.tsx`
- `app/image-preview/page.tsx`
- `public/sw.js`
- `lib/authLocal.ts`
- `lib/messageRepository.ts`
- `lib/messageService.ts`
- `lib/scheduleService.ts`
- `lib/pushNotificationService.ts`
- `lib/assistantActionService.ts`
- `lib/keeperService.ts`
- `lib/importantNotificationService.ts`
- `lib/locationService.ts`
- `lib/security.ts`
- `types/assistant.ts`
- `types/family.ts`
- `types/importantNotification.ts`
- `types/keeper.ts`
- `types/member.ts`
- `types/message.ts`
- `types/schedule.ts`

## Classification Legend

- Display: primarily renders data or state.
- Interaction: owns user input, gestures, form controls, modal actions, or navigation.
- Business-sensitive: touches message visibility, schedule privacy, auth/admin password, member identity, uploads, assistant/keeper actions, or other permission-sensitive data.
- PWA/Push support: directly participates in Service Worker, Push, foreground/background presence, notification click handoff, or push-related UI.

## Inventory

| Component | Classification | Owner / main call sites | Depends on | UI risks and concerns |
| --- | --- | --- | --- | --- |
| `ChatInput.tsx` | Interaction; business-sensitive; Storage-adjacent | Chat feature; used by `app/chat/page.tsx` | `LanguageProvider`, `Dialog`, `Toast`, `lib/recordingService`, `lib/errors`, `types/member`, `public/ui-icons/image.png`, `location.png`, `plus.png`, `voice.png`, `whisper-lock.png`, global `native-input-bar`, `field`, `btn-*` classes | P0 risk. Bottom safe-area, keyboard stability, voice recording pointer lifecycle, consent in localStorage, image/audio/location/whisper/keeper entry points. Long member names in whisper picker rely on `truncate`; keep active-member filtering. Icon buttons have labels/titles; any UI change must not alter send/upload/location/whisper callbacks. |
| `ChatMessage.tsx` | Display; interaction; business-sensitive; Storage-adjacent | Chat feature; used by `app/chat/page.tsx` | `AssistantActionCard`, `AudioBubble`, `LanguageProvider`, `lib/format`, `lib/locationService`, `lib/security`, `lib/systemMessage`, `types/message`, `types/member`, `types/family`, `types/assistant`, `public/ui-icons/whisper-lock.png` | P0 risk. Renders message visibility surfaces: text, image, audio, location, system, deleted, whisper, assistant, keeper. Uses `safeHttpUrl` and `safeGoogleMapsUrl`; do not bypass. Long-press action menu hooks are caller-owned but gesture timing is here. Long nicknames/content use `truncate`, `break-words`, `max-w`; must be preserved. |
| `AudioBubble.tsx` | Display; interaction; business-sensitive; Storage-adjacent | Nested in `ChatMessage` | `lib/recordingService`, browser `Audio`, localStorage key `family-chat:played-audio:*` | P1 risk. Audio URL must stay sanitized by parent before reaching this component. Fixed waveform width is capped but needs 360px checks. Play button is a real button but icon-only SVG lacks an explicit readable text; parent context may not be enough for screen readers. |
| `AssistantActionCard.tsx` | Display; interaction; business-sensitive | Nested in assistant system messages via `ChatMessage`; actions owned by `app/chat/page.tsx` and `lib/assistantActionService.ts` | `LanguageProvider`, `types/assistant` | P1 risk. Confirm/cancel/modify/open-schedule/task actions mutate schedule/assistant state through caller RPCs. Uses role/button keyboard handling for whole-card open; preserve nested button event stop logic. Long title/summary use `truncate`/`break-words`; action row can crowd at 360px. |
| `ImportantNoticeBar.tsx` | Display; interaction; business-sensitive; Realtime-adjacent | Chat feature; used by `app/chat/page.tsx` | `next/image`, `LanguageProvider`, `lib/format`, `lib/recordingService`, `lib/security`, `lib/systemMessage`, `types/importantNotification`, `types/member`, `types/message`, icons `voice.png`, `location.png` | P1 risk. Important message preview can expose text/media-derived summaries inside chat top bar; keep tied to messages already fetched through member-visible RPCs. Expanded list max-height is 120px; good for chat vertical budget but needs 360px long-name review. Remove button has label/title. |
| `KeeperRequestSheet.tsx` | Interaction; business-sensitive; schedule-sensitive | Chat feature; used by `app/chat/page.tsx`, submits through `lib/keeperService.ts` | `LanguageProvider`, `types/keeper`, `types/member`, `types/schedule`, global `field`, `btn-*` classes | P1 risk. Creates schedule/reminder/todo-like requests with visibility, assignee, reminder, note. Sheet uses `fixed inset-0`, `z-[70]`, `max-h-[min(78dvh,680px)]`; needs safe-area and keyboard validation. Labels exist, but two-column grids may be tight at 360px. |
| `Dialog.tsx` | Interaction; business-sensitive; Auth/admin-sensitive | Global provider in `app/layout.tsx`; used by chat, schedule, settings, members, image preview | React context; global `field`, `label`, `btn-*`, `animate-dialog-in`; callers in `app/settings/page.tsx`, `app/schedule/page.tsx`, `app/chat/page.tsx`, `app/members/page.tsx`, `app/image-preview/page.tsx` | P0 risk. Used for destructive confirms and admin/account password prompts. Backdrop tracks `visualViewport` and `100dvh`; preserve for iOS keyboard. Password visibility toggles are buttons with text but `tabIndex={-1}`, which reduces keyboard access. Dialog containers need long-message scroll review. |
| `Toast.tsx` | Display; interaction | Global provider in `app/layout.tsx`; used by multiple pages/components | React context; global `animate-toast-in` | P1 risk. Fixed `bottom-20 z-[9999]` can cover chat input, bottom sheets, and safe-area controls. `role=status`/`aria-live=polite` exists. Toast button dismiss action has no explicit label beyond message content. |
| `EffectOverlay.tsx` | Display; interaction | Chat effects; used by `app/chat/page.tsx` | `LanguageProvider`, `lib/effects`, global `effect-float`, `effect-pop` animations | P2 risk. Full-screen `z-[60]` can cover chat; click-to-dismiss has aria label. Heavy emoji/animation use should respect reduced-motion in future audit. Caption can be very large; long caption wrapping/overflow should be checked. |
| `RoleSelect.tsx` | Interaction; display | Account/family join/create flows; used by `app/create-family/page.tsx`, `app/join/page.tsx` | `next/image`, `LanguageProvider`, `types/family`, `public/ui-icons/role-father.png`, `role-mother.png`, `role-child.png` | P2 risk. Three-column role picker can crowd at 360px if localized labels grow. Buttons do not expose `aria-pressed` for selected state. |
| `RoleBadge.tsx` | Display | Members page; used by `app/members/page.tsx` | `LanguageProvider`, `types/family` | P3 risk. Simple visual badge. Ensure role is not conveyed by color only where it matters; text is present. |
| `EnvWarning.tsx` | Display | Entry/auth/setup pages and chat fallback | `LanguageProvider`, `lib/supabaseClient` | P3 risk. Only displays missing Supabase config. Long body copy wraps. No data mutation. |
| `LanguageProvider.tsx` | Interaction support; display support | Global provider in `app/layout.tsx`; consumed broadly | `lib/i18n`, localStorage language preference | P1 risk. All text sizing/length risks vary by locale. Any refactor must preserve provider placement above `Toast`/`Dialog` children. |
| `AppPresenceTracker.tsx` | PWA/Push support; business-sensitive | Global shell; used by `app/layout.tsx` | `next/navigation`, `lib/authLocal`, `lib/pushNotificationService` | P0 risk. Sends member presence with `member_id + member_token` to `/api/push/presence`. It is not visual-only. Do not move under conditional UI where it might unmount on route changes incorrectly. |
| `ServiceWorkerRegister.tsx` | PWA/Push support | Global shell; used by `app/layout.tsx`; paired with `public/sw.js` | browser Service Worker API, sessionStorage key `family-chat:sw-refreshed-v6`, `public/sw.js` | P0 risk. Registers `/sw.js` in production and reloads on controller change once per session. Must be audited together with `public/sw.js` and Push subscription behavior. |
| `BottomTabBar.tsx` | Display; interaction; navigation support | Shared UI component, currently no direct app call site found in static search | `next/image`, `next/link`, `next/navigation`, `classNames.ts`, `public/ui-icons/*` by item props, global `bottom-tab-*` classes | P2 risk. Good aria labels/current state, but disabled links use `aria-disabled` plus prevented click. Needs bottom safe-area check if adopted because global class owns fixed bottom behavior. |
| `Button.tsx` | Interaction support | Shared UI wrapper, currently no direct app call site found in static search | `classNames.ts`, global `btn-*` classes | P2 risk. Supports loading/disabled with `aria-busy`. Does not enforce label for `size="icon"`; future usage must add `aria-label`/`title`. |
| `Card.tsx` | Display support | Shared UI wrapper, currently no direct app call site found in static search | `classNames.ts`, global `card`, `section-card`, `action-card`, `empty-state` classes | P3 risk. Low business risk. Main risk is overusing card wrappers and drifting toward SaaS/dashboard visual language. |
| `TextField.tsx` | Interaction support; a11y support | Shared UI wrapper, currently no direct app call site found in static search | `classNames.ts`, global `field`, `label`, `field-*` classes | P2 risk. Strong label/error wiring via `useId`, `aria-describedby`, `role=alert`. Future select/textarea variants are not covered. |
| `classNames.ts` | Utility support | Shared by `components/ui/*` | none | P3 risk. Low. No UI/data behavior. |

## Findings By Priority

### P0

- `ChatInput`, `ChatMessage`, `Dialog`, `AppPresenceTracker`, and `ServiceWorkerRegister` are P0-risk components for future UI work, even if no confirmed P0 defect was introduced in this report-only pass.
- `ChatInput` and `ChatMessage` are directly on the message send/render path. They must not be visually refactored in a way that changes image/audio/location upload callbacks, whisper selection, recipient visibility, safe URL checks, long-press actions, or bottom input safe-area behavior.
- `Dialog` carries admin/account password and destructive confirmation flows. Its `visualViewport` handling is part of keyboard safety and should be preserved.
- `AppPresenceTracker` and `ServiceWorkerRegister` are support components, not visual decoration. They touch presence and service worker registration and must be reviewed with Push/server routes and `public/sw.js`.

### P1

- `KeeperRequestSheet` and `AssistantActionCard` are business-sensitive schedule/assistant surfaces. UI polish must not weaken RPC-owned permission checks for schedule visibility, assignee actions, or assistant card ownership.
- `ImportantNoticeBar` previews message-derived content. It must stay fed only by RPC-visible messages and must not become a backdoor for whisper/private content.
- `Toast` can overlap bottom chat input or sheets because it uses fixed bottom positioning. This deserves a focused layering audit before any broad toast redesign.
- `LanguageProvider` makes long-text risk cross-cutting: all inventory rows should be checked under Chinese, Japanese, and English strings where practical.

### P2

- Shared UI primitives under `components/ui/*` exist but are not widely adopted yet. They can become Phase 2/3 extraction anchors, but introducing them into sensitive chat/schedule paths should be incremental.
- `RoleSelect` needs selected-state a11y (`aria-pressed`) and 360px label crowding review before reuse.
- `EffectOverlay` uses full-screen animation and high z-index. It should be checked for reduced-motion and caption overflow.
- `BottomTabBar` appears ready but unused; any adoption must verify safe-area, active state, and disabled navigation behavior.

### P3

- `RoleBadge`, `EnvWarning`, `Card`, and `classNames` are low-risk display/support pieces.
- `Card` should remain a semantic helper, not a license to make every page section a floating card.

## Cross-Cutting Risk Notes

Data flow:

- Components mostly receive data from page-level services; they should remain render/input boundaries. Chat and schedule data flows are owned by `app/chat/page.tsx`, `app/schedule/page.tsx`, and `lib/*Service.ts`.
- Do not move RPC calls into display components unless a later task explicitly scopes that architecture change.

Permissions:

- Message visibility must remain sourced from `message_recipients` and member-token RPCs. `ChatMessage` may show/hide UI affordances, but it must not decide server visibility.
- Schedule visibility and collaboration permissions must remain in `lib/scheduleService.ts` RPC calls and database functions, not in `KeeperRequestSheet` or assistant card UI.

Push and PWA:

- `ServiceWorkerRegister`, `AppPresenceTracker`, `ChatInput`/chat header push controls, and `public/sw.js` form one behavior chain. Future UI changes must check foreground suppression, notification click routing, presence, and 404/410 subscription disablement.
- Push payload safety is not enforced by the visual components; do not add message body, media URL, coordinates, family code, member token, or auth token to Push-related UI/API handoff.

Realtime:

- `ChatMessage`, `ImportantNoticeBar`, and assistant/keeper UI render results of Realtime-triggered refreshes, but they should continue to rely on page/service refetches for full data.
- Do not assume Realtime event payloads contain complete message/schedule content.

Storage:

- `ChatInput` initiates file/audio selection and recording, while uploads are caller-owned through `uploadChatImage`/`uploadChatAudio`.
- `ChatMessage` and `ImportantNoticeBar` render media only after URL sanitization (`safeHttpUrl`). Keep this guard in place because public bucket URLs are not a strong privacy boundary once leaked.

Auth:

- `LanguageProvider`, `Toast`, and display primitives are auth-neutral.
- `Dialog` is auth/admin-sensitive because settings and account flows collect admin/current/new passwords through it. It must not log or surface password values.
- `AppPresenceTracker` loads local session credentials. It must not expose `member_token` in UI, URL, logs, or Push payload.

RPC/RLS:

- The inventory found component dependencies on RPC client services for messages, schedule, assistant cards, keeper requests, important notifications, and member validation.
- UI tasks must not replace RPC/RLS checks with front-end filtering. New or changed RPC behavior remains outside this worker scope and must follow `AGENTS.md`.

## Minimal Next Tasks

- P1: Focused `ChatInput` visual audit at 360/390/430px for safe-area, keyboard, recording, action menu, whisper picker, and keeper button crowding.
- P1: Focused `ChatMessage` visual audit for long nicknames, long text, image/audio/location bubbles, whisper labels, assistant card action rows, and long-press menu entry stability.
- P1: Dialog and Toast layering audit against chat input, schedule detail sheet, keyboard, and bottom safe area.
- P1: Keeper/Assistant business-sensitive UI audit to confirm action buttons remain tied to caller RPCs and do not imply permissions the server does not grant.
- P2: Decide whether `components/ui/Button`, `TextField`, `Card`, and `BottomTabBar` are approved extraction targets before applying them to existing pages.
- P2: Add an a11y task candidate for `RoleSelect` selected-state semantics and for icon/visual-only controls in shared primitives.

## Validation Suggestions

For this report-only task:

- Run `git diff --check`.

For future implementation tasks touching these components:

- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run build`.
- Run `git diff --check`.
- Browser/manual check 360px, 390px, and 430px.
- For chat changes: send text, image, audio, location, whisper; long-press copy/important/recall; Push click to `/chat?mid=...`; foreground/background presence.
- For schedule/keeper/assistant changes: create/edit/delete schedule, private/family visibility, assignee accept/decline/done/snooze, reminder status, Push click to `/schedule?item=...`.
- For PWA/Push support changes: check `public/sw.js`, `ServiceWorkerRegister`, Push subscribe/unsubscribe/presence API routes, Android/iOS PWA behavior.

## Modification Statement

I modified exactly one file: `docs/agent-reports/20260525-phase1-component-inventory.md`.

I did not modify any file under `components/**`, `app/**`, `lib/**`, `public/**`, `supabase/**`, `types/**`, `TASKS_UI.md`, `PHASE_STATUS.md`, or `docs/iteration-log/_latest.md`.
