import type { LocalSession } from "@/lib/authLocal";
import type { ScheduleCollaborationNotifyType } from "@/lib/scheduleCollaborationPolicy";

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 300;

interface NotifyResponse {
  ok?: unknown;
}

export async function sendScheduleCollaborationNotification(
  session: LocalSession,
  scheduleItemId: string,
  eventType: ScheduleCollaborationNotifyType,
  contextEventId: string | null = null,
): Promise<boolean> {
  const body = JSON.stringify({
    memberId: session.member_id,
    memberToken: session.member_token,
    scheduleItemId,
    eventType,
    contextEventId,
  });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch("/api/schedule/collaboration-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
      const result = response.ok
        ? ((await response.json().catch(() => null)) as NotifyResponse | null)
        : null;
      if (result?.ok === true) return true;
    } catch {
      // Push is best-effort and must not fail the schedule operation.
    }

    if (attempt + 1 < MAX_ATTEMPTS) {
      await wait(RETRY_DELAY_MS);
    }
  }

  return false;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
