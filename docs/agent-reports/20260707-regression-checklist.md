# Regression Checklist - 2026-07-07

## Chat Media Stability

- Send and receive a text message.
- Send an image; confirm the receiver sees it after refresh.
- Send a voice message; confirm the receiver can play it immediately.
- Leave the tab idle for more than 5 minutes, return, and play the same voice message again.
- Refresh the chat page and confirm image/audio messages still resolve.
- Confirm a deleted or inaccessible media ref shows a graceful unavailable state, not an infinite spinner.

## Chat Media Access

- As a family member, open a message image/audio normally from the chat UI.
- As a different family member who is not a whisper recipient, confirm the hidden whisper media is not returned by message RPCs.
- Confirm new image/audio sends use `storage://chat-images/family/...` or `storage://chat-audios/family/...`.
- Confirm sending `https://example.com/file.png` as a new image/audio media URL is rejected.
- Confirm Push payloads do not include message text, media URL, coordinates, family code, or tokens.

## Avatar In Chat

- Upload avatar from `/me`.
- Return to chat and confirm own avatar/initial updates.
- Send a new message and confirm the new avatar is used.
- Open another member session and confirm that member sees the updated avatar after refresh/realtime sync.

## Schedule Reminder Notifications

- Create a schedule item with a reminder due soon.
- Confirm visible foreground app receives in-app reminder handling, not an unnecessary system notification.
- Put app in background/PWA mode and confirm the reminder notification appears.
- Click the reminder notification and confirm it opens `/schedule?item=<itemId>`.
- Confirm notification title/body are safe summaries and do not include schedule title, notes, comments, location, media URL, family code, or tokens.
- Confirm 404/410 push subscription failures disable the bad subscription.

## Schedule Collaboration

- Create a schedule with one assignee and confirm only participants receive action/notification context.
- Confirm accepting an assistant-created schedule sends the final notification.
- Confirm cancelling/rejecting does not send the original user phrase as a chat message.
- Confirm private schedules are visible only to creator and responsible member.
- Confirm comments, status changes, and activity logs still require member token validation.

## Mobile UI

- Check widths: 360px, 390px, 430px.
- Confirm no horizontal scroll on home, chat, schedule, and `/me`.
- Confirm bottom controls respect safe area and remain reachable by thumb.
- Confirm long names, long schedule titles, and long messages do not break layout.
- Confirm chat page still uses dynamic viewport behavior and the input bar does not jump during typing/recording.

## Supabase Security Warnings

- Refresh Supabase Advisors after production migrations.
- Confirm no public table remains accessible without RLS unless intentionally public and documented.
- Confirm `chat-images` and `chat-audios` are private.
- Confirm internal helper functions are not executable by `anon` / `authenticated`.
- Confirm token-validated business RPCs remain callable for anonymous family members.
- Enable leaked password protection in Supabase Auth settings.

## Local Validation

To run before submit:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
git diff --check
```

Manual checks are still required for PWA/background notification behavior because desktop browser validation does not fully cover iOS/Android PWA differences.
