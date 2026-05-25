import { NextResponse } from "next/server";

import {
  ApiRequestError,
  readJsonBody,
  rejectMismatchedOrigin,
} from "@/lib/apiSecurity";
import {
  sendScheduleCollaborationPush,
  type ScheduleCollaborationNotifyType,
} from "@/lib/scheduleCollaborationPushServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENTS = new Set(["assigned", "accepted", "declined", "commented"]);

interface NotifyBody {
  memberId?: unknown;
  memberToken?: unknown;
  scheduleItemId?: unknown;
  eventType?: unknown;
}

export async function POST(request: Request) {
  const originError = rejectMismatchedOrigin(request);
  if (originError) return originError;

  try {
    const body = await readJsonBody<NotifyBody>(request);
    if (
      typeof body.memberId !== "string" ||
      typeof body.memberToken !== "string" ||
      typeof body.scheduleItemId !== "string" ||
      typeof body.eventType !== "string" ||
      !EVENTS.has(body.eventType)
    ) {
      return NextResponse.json({ ok: false });
    }

    const result = await sendScheduleCollaborationPush({
      memberId: body.memberId,
      memberToken: body.memberToken,
      scheduleItemId: body.scheduleItemId,
      eventType: body.eventType as ScheduleCollaborationNotifyType,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ ok: false });
    }
    console.warn(
      "[schedule collaboration notify]",
      error instanceof Error ? error.message : "schedule_collaboration_notify_failed",
    );
    return NextResponse.json({ ok: false });
  }
}
