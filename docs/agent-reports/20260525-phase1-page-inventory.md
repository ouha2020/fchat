# Phase 1 Page Inventory - Worker W1

Date: 2026-05-25 JST
Worker: W1
Scope: report-only page inventory for HomeTree / FamilyChat UI refactor.

## Scope And Files Reviewed

Governance and phase files reviewed:

- `AGENTS.md`
- `UI_RULES.md`
- `DESIGN_SYSTEM.md`
- `TASKS_UI.md`
- `CODEX_UI_LOOP.md`
- `PHASE_STATUS.md`
- `docs/iteration-log/_latest.md`
- `docs/agent-reports/README.md`

Route and architecture files reviewed or statically sampled:

- App pages: `app/page.tsx`, `app/chat/page.tsx`, `app/schedule/page.tsx`, `app/me/page.tsx`, `app/members/page.tsx`, `app/settings/page.tsx`, `app/admin/system-health/page.tsx`, `app/create-family/page.tsx`, `app/join/page.tsx`, `app/login/page.tsx`, `app/register/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`, `app/verify-family-code/page.tsx`, `app/image-preview/page.tsx`, `app/offline/page.tsx`, `app/mood-tree/page.tsx`, `app/layout.tsx`.
- Global support: `components/ServiceWorkerRegister.tsx`, `components/AppPresenceTracker.tsx`, `components/LanguageProvider.tsx`, `public/sw.js`.
- Key page dependencies: `lib/authLocal.ts`, `lib/accountClient.ts`, `lib/familyService.ts`, `lib/memberService.ts`, `lib/messageService.ts`, `lib/messageSync.ts`, `lib/importantNotificationService.ts`, `lib/scheduleService.ts`, `lib/personalDashboardService.ts`, `lib/avatarService.ts`, `lib/pushNotificationService.ts`, `lib/usePushNotificationControls.ts`, `lib/keeperService.ts`.
- API route inventory: `app/api/auth/**/route.ts`, `app/api/push/**/route.ts`, `app/api/schedule/**/route.ts`, `app/api/upload/**/route.ts`, `app/api/admin/**/route.ts`.

I did not edit `app/**`, `components/**`, `lib/**`, `public/**`, `supabase/**`, `types/**`, `TASKS_UI.md`, `PHASE_STATUS.md`, or `docs/iteration-log/_latest.md`.

## Page Inventory

| Priority | Route | Key User Paths | Data Dependencies | Sensitive Boundaries | Manual Validation Points |
| --- | --- | --- | --- | --- | --- |
| P1 | `/` | Restore existing local member session; choose create family or join family; navigate to login/forgot password. | `loadSession`, `safeRestoreSession`, `clearSession`, `ensureFamilyCode`, Supabase Auth session. | Local `member_id + member_token`; owner account path must stay separate from anonymous join path. | 360/390/430: entry action cards, long family-copy text, disabled busy state, no horizontal scroll. |
| P2 | `/register` | Register email/password; sign in; send family code; continue to verification. | `/api/auth/register`, Supabase Auth sign-in, `/api/auth/family-code` through `ensureFamilyCode`. | Password handling, account email, family-code issuance. | 360/390/430: password error copy, two-button registered-email fallback, keyboard layout. |
| P2 | `/login` | Sign in owner account; resume owner rejoin; resume create-family flow. | Supabase Auth `signInWithPassword`, owner rejoin pending local storage, `ensureFamilyCode`, `/api/auth/owner-admin`. | Auth token used only in Authorization header; owner rejoin must not expose member token in URL. | 360/390/430: query `next=owner-rejoin`, error states, links to register/forgot. |
| P2 | `/forgot-password` | Request reset email. | Supabase Auth `resetPasswordForEmail`. | Email enumeration should stay generic. | 360/390/430: success/error notes, keyboard does not hide submit. |
| P2 | `/reset-password` | Set new password from Supabase recovery session. | Supabase Auth `updateUser`. | Password only in Auth client call, never logged or displayed. | 360/390/430: two password fields, error note, post-reset redirect. |
| P2 | `/verify-family-code` | Authenticated owner verifies emailed family code; resend code; continue to create family. | Supabase Auth session, `ensureFamilyCode`, `/api/auth/verify-family-code`. | Family code is sensitive onboarding material; should not be logged or copied into unrelated URLs beyond route status flags. | 360/390/430: code input, resend button, status/notice blocks. |
| P2 | `/create-family` | Authenticated owner completes family creation with verified code, family name, nickname, role. | Supabase Auth session, `ensureFamilyCode`, `/api/auth/create-family`, `saveSession`. | Creates owner-bound family and local member session; must preserve hybrid identity model. | 360/390/430: form grids, role selector, long family name/nickname, loading state. |
| P2 | `/join` | Anonymous member joins with family code, nickname, role; owner rejoin flow if nickname exists; recover family code email. | `validateMember`, `resolveJoinFamilyState`, `joinFamily`, `rejoinFamilyMemberWithAccount`, `/api/auth/resend-existing-family-code`. | Family code, member token, owner account fallback, join-enabled state and nickname collision handling. | 360/390/430: recover-code panel, role selector, owner-rejoin warning, keyboard with code/name inputs. |
| P0 | `/chat` | Primary chat; restore session; list/sync messages; send text/image/audio/location; whisper; Keeper requests; important notices; message actions; push toggle; schedule dot; notification deep link via `?mid=`. | `safeRestoreSession`, `listMembers`, `messageSync`, `messageCache`, `sendMessage`, `uploadChatImage`, `uploadChatAudio`, location service, important notification RPCs, assistant/Keeper services, push controls. | Message visibility from `message_recipients`; whisper visibility; `family_seq` delta sync; Realtime events are signals only; Push payload must stay content-free; Storage URLs public-once-leaked; local member token in browser only. | 360/390/430: `100dvh` viewport, iOS keyboard stability, input bar, recording, toolbar, whisper/Keeper banners, important notice bar, message action menu, long names, media bubbles, `?mid` scroll/highlight, no horizontal scroll. |
| P0 | `/schedule` | Primary schedule; month/week/day; filters/search; create/edit/delete; recurrence; private/family visibility; detail panel; comments/context events; assignee response; reminder status/snooze; notification deep link via `?item=`. | `validateMember`, `listMembers`, `listScheduleItems`, `searchScheduleItems`, create/update/delete schedule RPCs, collaboration/context/reminder RPCs, `/api/schedule/collaboration-notify`, Realtime `family_schedule_events`. | Private schedule visibility must come from RPC/RLS, not UI filtering; reminder Push must not include title/note/comment/location/media; context private recipient must stay permission-checked by RPC. | 360/390/430: range controls, filter panel, form grids, month/week/day stability, detail sheet `92dvh`, edit mode, comment composer with keyboard, private recipient select, reminder deliveries list, long title/note wrapping. |
| P1 | `/me` | View personal dashboard; refresh; upload/remove avatar; open schedule item; navigate to settings/members/schedule. | `validateMember`, `getPersonalDashboard`, `/api/upload/avatar`, `update_member_avatar` RPC. | Avatar upload validates member credentials and writes public Storage URL; dashboard visibility depends on RPC. | 360/390/430: avatar buttons, `min-[420px]` link grid, long nickname/family name, schedule cards. |
| P1 | `/members` | List family members; live refresh; whisper entry; admin remove member. | `validateMember`, `listMembers`, Realtime `family_members`, Supabase Auth owner session, `/api/auth/owner-admin` remove action. | Removed members must lose access; admin action requires owner account plus member token; whisper links must not imply admin can read private messages. | 360/390/430: long nicknames, role/admin/me badges, whisper icon button labels, remove button fit. |
| P1 | `/settings` | View family/session info; language; Push enable/disable/diagnostics/test; admin rename/reset code/join toggle/password; reminder health; leave/switch family. | `validateMember`, `fetchFamilySettings`, owner account APIs, Push subscription APIs, diagnostics API, `getScheduleReminderHealth`, Supabase Auth sign-out. | Family code reveal/copy is sensitive; Push endpoint diagnostics must stay summarized; admin actions require owner Auth; leave/switch clears local token and Auth. | 360/390/430: family code row, language 3-column buttons, Push buttons and diagnostics rows, admin actions, reminder health panel, danger buttons. |
| P2 | `/admin/system-health` | Run system health report with maintenance secret/admin permission; copy JSON report. | `/api/admin/system-health`, `buildSystemHealthReport`, health catalog RPCs. | Maintenance secret/admin guard; page must not display tokens, hashes, family codes, Push endpoints, message bodies. | 360/390/430: secret input, run/copy buttons, report rows, long check labels, no dashboard sprawl. |
| P3 | `/image-preview` | Full-screen media preview from `src`; set chat background; open original; back to chat. | URL search param `src`, `safeHttpUrl`, `loadSession`, local chat background storage. | Public media URL may be exposed in URL by design; must remain safe-URL checked and not treated as private boundary. | 360/390/430: top overlay buttons fit, invalid src fallback, image containment, double-tap background action. |
| P3 | `/offline` | Static PWA offline fallback. | No Supabase data; linked from Service Worker cache/fallback behavior. | Must not imply offline edits are persisted. | 360/390/430: centered card and return button. |
| P3 | `/mood-tree` | Local/prototype mood tree interaction. | Static in-page mock data and local state only. | No current Supabase/Auth boundary observed; future persistence would need new RPC/RLS review. | 360/390/430: dense interactive content, long labels, button wrapping. |

## API And Support Surface

- Auth APIs: `/api/auth/register`, `/api/auth/family-code`, `/api/auth/verify-family-code`, `/api/auth/create-family`, `/api/auth/member-session`, `/api/auth/owner-admin`, `/api/auth/reset-admin-password`, `/api/auth/resend-existing-family-code`. These bridge Supabase Auth owner identity with local member sessions.
- Upload APIs: `/api/upload/image`, `/api/upload/audio`, `/api/upload/avatar`. These validate origin, member credentials, MIME/size, safe public URL, and family/member pathing before returning Storage URLs.
- Push APIs: `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/presence`, `/api/push/send-message-notification`, `/api/push/diagnostics`, `/api/push/flush-pending`, `/api/push/retry-failed`. Some require member credentials; flush/retry require server secret.
- Schedule APIs: `/api/schedule/collaboration-notify`, `/api/schedule/flush-reminders`, `/api/schedule/retry-reminders`. Reminder flush/retry require `SCHEDULE_REMINDER_SECRET` or `CRON_SECRET`.
- Admin APIs: `/api/admin/system-health`, `/api/admin/session`, `/api/admin/dashboard`, `/api/admin/audit`. These are operational surfaces and should not be pulled into normal family UI.
- Global support: `app/layout.tsx` wraps pages in Language/Dialog/Toast and globally mounts presence tracking plus service worker registration. A visual refactor can accidentally affect all pages through global CSS/container changes even when only one route is touched.

## Findings By Priority

### P0

- `/chat` and `/schedule` are the highest-risk UI routes. Both combine local member session, RPC-backed permissions, Realtime signal tables, Push/SW callbacks, and mobile fixed/dynamic viewport behavior. UI changes here need route-specific regression, not just lint/build.
- Push and Realtime are architecture boundaries, not decorative UI. Chat subscribes to `message_realtime_events`, `important_notification_realtime_events`, `family_schedule_events`, and `family_members`; schedule subscribes to `family_schedule_events`. In all cases, detail data must continue to be fetched through RPC.
- Whisper messages and private schedule/context events must remain permission-backed by RPC/RLS. UI badges and filters are only presentation and must not become the enforcement layer.
- Local member session contains `member_token` in browser storage/cookies. Any page that reads `loadSession` must continue validating with server/RPC before showing family data.

### P1

- `/settings`, `/members`, and `/me` are high-frequency secondary routes with sensitive actions: family code reveal/copy, owner-only admin actions, Push subscription diagnostics, member removal, and avatar upload.
- Global providers and support components mean page UI changes should be checked with `AppPresenceTracker` and `ServiceWorkerRegister` still mounted. Presence updates run on every route, so navigation and visibility events are part of the page inventory.
- Long family names, nicknames, schedule titles, notes, diagnostics labels, and member badges appear across P1 pages and should be included in mobile width validation.

### P2

- Account and family onboarding routes are visually simpler but identity-sensitive. `/register`, `/login`, `/verify-family-code`, `/create-family`, and `/join` must preserve the owner Auth path versus anonymous member path.
- `/admin/system-health` is operational UI, not a family dashboard. It should stay compact and secret-protected; UI work should not expand it into a broad SaaS admin surface.

### P3

- `/image-preview`, `/offline`, and `/mood-tree` are lower-risk UI surfaces. `/image-preview` still touches public media URLs and local background settings, so safe URL validation should remain in place.
- `/mood-tree` currently appears local/static; any future persistence would raise it out of P3 and require Auth/RPC/RLS design first.

## Risk Notes

- Data flow: UI should keep calling existing services/RPCs. Do not replace service calls with direct Supabase table reads from pages.
- Permissions: member access must validate `member_id + member_token`; owner/admin actions must preserve Supabase Auth checks plus member membership checks.
- Push: payloads must stay safe summaries. Message Push targets must derive from recipients and exclude sender; schedule reminders must not include title, note, comments, location, or media URL.
- Realtime: events are lightweight invalidation signals. Pages must keep follow-up RPC fetches for message/schedule details and fallback refresh paths for missed events.
- Storage: image/audio/avatar uploads use public buckets. UI can show returned URLs only after credential-checked upload/RPC access; leaked public URLs are not a privacy boundary.
- Auth: hybrid identity is load-bearing. Family creator uses Supabase Auth; normal members use local member session. UI copy and routes should not blur these identities.
- RPC/RLS: private chat/schedule visibility, removed-member lockout, admin abilities, and reminder delivery state must remain enforced by SECURITY DEFINER RPC/RLS, not frontend conditions.

## Minimal Next Tasks

1. Orchestrator reviews this report together with W2-W6 reports before updating `TASKS_UI.md`.
2. Turn the P0 route inventory into dedicated manual regression checklists for `/chat` and `/schedule`.
3. For P1 pages, add focused audit tasks for long-text behavior, icon/button labels, and sensitive-action confirmation states.
4. For P2 onboarding, add a small form-state audit that preserves Auth/member-session flow and checks mobile keyboard behavior.
5. Keep `/admin/system-health`, Push, Service Worker, API, RPC, schema, and Storage changes out of UI-only tasks unless a separate architecture/security task is explicitly selected.

## Suggested Mobile Validation Matrix

- 360px: minimum target width. Check `/chat` input/toolbar/notice/action menu, `/schedule` filter/detail/comment composer, `/settings` diagnostics/admin rows, `/members` row actions, onboarding form buttons.
- 390px: common iPhone width. Check dynamic viewport with keyboard, safe-area bottom padding, chat scroll-to-bottom, schedule detail sheet height, and language/family-code rows.
- 430px: larger mobile width. Check responsive branches such as `/me` link grid, schedule two-column form fields, settings language grid, and image-preview top controls.
- Across all three widths: no horizontal scroll, no clipped button text, no inaccessible icon-only buttons, no modal/sheet overflow, and no critical action hidden behind the keyboard.

## Modification Statement

I modified exactly one file: `docs/agent-reports/20260525-phase1-page-inventory.md`.

I did not modify any other file.
