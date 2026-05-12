import { NextResponse } from "next/server";

import {
  ApiRequestError,
  badRequest,
  readJsonBody,
  rejectMismatchedOrigin,
} from "@/lib/apiSecurity";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { isUuid } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildMessagePushBody,
  getWebPush,
  isGonePushError,
  pushErrorStatus,
  toWebPushSubscription,
  type StoredPushSubscription,
} from "@/lib/webPushServer";
import type { MessageType } from "@/types/message";

export const runtime = "nodejs";

interface SendPushBody {
  memberId?: unknown;
  memberToken?: unknown;
  messageId?: unknown;
}

interface MessageRow {
  id: string;
  family_id: string;
  sender_member_id: string | null;
  message_type: MessageType;
  deleted_at: string | null;
  push_requested_at: string | null;
}

interface PushSubscriptionRow extends StoredPushSubscription {
  id: string;
  member_id: string;
  messages_enabled: boolean;
  location_enabled: boolean;
  last_notified_at: string | null;
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

    const sb = getSupabaseAdmin();
    const { data: message, error: messageError } = await sb
      .from("messages")
      .select(
        "id, family_id, sender_member_id, message_type, deleted_at, push_requested_at",
      )
      .eq("id", body.messageId)
      .maybeSingle<MessageRow>();
    if (messageError) throw messageError;
    if (!message || message.deleted_at) {
      return NextResponse.json({ ok: true, skipped: "message_not_found" });
    }
    if (
      message.family_id !== sender.family_id ||
      message.sender_member_id !== sender.member_id
    ) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const webPush = getWebPush();
    const requestedAt = new Date().toISOString();
    const { data: marked, error: markError } = await sb
      .from("messages")
      .update({ push_requested_at: requestedAt })
      .eq("id", message.id)
      .is("push_requested_at", null)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (markError) throw markError;
    if (!marked) {
      return NextResponse.json({ ok: true, skipped: "already_requested" });
    }

    const { data: members, error: memberError } = await sb
      .from("family_members")
      .select("id")
      .eq("family_id", message.family_id)
      .eq("status", "active")
      .neq("id", sender.member_id);
    if (memberError) throw memberError;

    const recipientIds = (members ?? []).map((m) => m.id as string);
    if (recipientIds.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    const { data: subscriptions, error: subError } = await sb
      .from("push_subscriptions")
      .select(
        "id, member_id, endpoint, p256dh, auth, messages_enabled, location_enabled, last_notified_at",
      )
      .eq("family_id", message.family_id)
      .eq("enabled", true)
      .in("member_id", recipientIds);
    if (subError) throw subError;

    const targets = ((subscriptions ?? []) as PushSubscriptionRow[]).filter(
      (sub) => shouldNotify(sub, message.message_type),
    );
    if (targets.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, skipped: "preferences" });
    }

    const payload = JSON.stringify({
      title: "\u5bb6\u5ead\u804a\u5929",
      body: buildMessagePushBody(sender.nickname, message.message_type),
      url: "/chat",
      familyId: message.family_id,
      messageId: message.id,
      tag: `family-chat:${message.family_id}:${message.id}`,
    });

    const results = await Promise.allSettled(
      targets.map((sub) =>
        webPush.sendNotification(toWebPushSubscription(sub), payload, {
          TTL: 60 * 60,
        }),
      ),
    );

    const sentIds: string[] = [];
    const goneIds: string[] = [];
    results.forEach((result, index) => {
      const sub = targets[index];
      if (!sub) return;
      if (result.status === "fulfilled") {
        sentIds.push(sub.id);
      } else if (isGonePushError(result.reason)) {
        goneIds.push(sub.id);
      } else {
        console.warn("[push send failed]", pushErrorStatus(result.reason));
      }
    });

    if (sentIds.length > 0) {
      await sb
        .from("push_subscriptions")
        .update({ last_notified_at: requestedAt, updated_at: requestedAt })
        .in("id", sentIds);
    }
    if (goneIds.length > 0) {
      await sb
        .from("push_subscriptions")
        .update({ enabled: false, updated_at: requestedAt })
        .in("id", goneIds);
    }

    return NextResponse.json({
      ok: true,
      sent: sentIds.length,
      disabled: goneIds.length,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return badRequest(error);
    }
    console.warn(
      "[push send-message]",
      error instanceof Error ? error.message : "push_send_failed",
    );
    return NextResponse.json({ ok: false, error: "push_send_failed" });
  }
}

function shouldNotify(
  sub: PushSubscriptionRow,
  messageType: MessageType,
): boolean {
  if (!sub.messages_enabled) return false;
  if (messageType === "location" && !sub.location_enabled) return false;
  if (messageType === "system") return false;
  return true;
}
