import { NextResponse } from "next/server";

import {
  ApiRequestError,
  badRequest,
  readJsonBody,
  rejectMismatchedOrigin,
} from "@/lib/apiSecurity";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { sendImmediateMessageNotification } from "@/lib/pushMessageServer";
import { isUuid } from "@/lib/security";

export const runtime = "nodejs";

interface SendPushBody {
  memberId?: unknown;
  memberToken?: unknown;
  messageId?: unknown;
}

export async function POST(request: Request) {
  try {
    const originError = rejectMismatchedOrigin(request);
    if (originError) return originError;

    const body = await readJsonBody<SendPushBody>(request);
    if (!isUuid(body.messageId)) {
      return NextResponse.json({ error: "invalid_message_id" }, { status: 400 });
    }

    const sender = await validateMemberCredentials(
      body.memberId,
      body.memberToken,
    );
    if (!sender) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const result = await sendImmediateMessageNotification(sender, body.messageId);
    return NextResponse.json({
      ok: true,
      sent: result.sent,
      disabled: result.gone,
      failed: result.failed,
      skipped: result.skippedReason,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return badRequest(error);
    }
    if (error instanceof Error && error.message === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    console.warn(
      "[push send-message]",
      error instanceof Error ? error.message : "push_send_failed",
    );
    return NextResponse.json({ ok: false, error: "push_send_failed" });
  }
}
