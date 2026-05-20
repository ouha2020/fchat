import { NextResponse } from "next/server";

import { rejectMismatchedOrigin } from "@/lib/apiSecurity";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { getPushMessageStatusForMember } from "@/lib/pushMessageServer";
import { isUuid } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const originError = rejectMismatchedOrigin(request);
  if (originError) return originError;

  const url = new URL(request.url);
  const memberId = url.searchParams.get("memberId");
  const memberToken = url.searchParams.get("memberToken");
  const messageId = url.searchParams.get("messageId");

  if (!isUuid(messageId)) {
    return NextResponse.json({ error: "invalid_message_id" }, { status: 400 });
  }

  const member = await validateMemberCredentials(memberId, memberToken);
  if (!member) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const recipients = await getPushMessageStatusForMember(member, messageId);
    if (!recipients) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      messageId,
      recipients,
    });
  } catch (error) {
    console.warn(
      "[push message-status]",
      error instanceof Error ? error.message : "message_status_failed",
    );
    return NextResponse.json({ error: "message_status_failed" }, { status: 500 });
  }
}
