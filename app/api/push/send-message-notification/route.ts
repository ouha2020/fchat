import { NextResponse } from "next/server";

import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildMessagePushBody,
  getWebPush,
  isGonePushError,
  toWebPushSubscription,
  type StoredPushSubscription,
} from "@/lib/webPushServer";
import type { MessageType } from "@/types/message";

export const runtime = "nodejs";

const ACTIVE_WINDOW_MS = 60_000;
const DEDUPE_WINDOW_MS = 30_000;

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
  important_enabled: boolean;
  last_notified_at: string | null;
}

interface PresenceRow {
  member_id: string;
  current_page: string | null;
  is_active: boolean;
  last_seen_at: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SendPushBody;
    if (typeof body.messageId !== "string") {
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

    const activeCutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
    const { data: presenceRows, error: presenceError } = await sb
      .from("user_presence")
      .select("member_id, current_page, is_active, last_seen_at")
      .eq("family_id", message.family_id)
      .eq("is_active", true)
      .in("member_id", recipientIds);
    if (presenceError) throw presenceError;

    const activeMemberIds = new Set(
      ((presenceRows ?? []) as PresenceRow[])
        .filter((row) => {
          if (row.current_page === "chat") return true;
          return row.last_seen_at > activeCutoff;
        })
        .map((row) => row.member_id),
    );
    const targetMemberIds = recipientIds.filter((id) => !activeMemberIds.has(id));
    if (targetMemberIds.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, skipped: "active_app" });
    }

    const { data: subscriptions, error: subError } = await sb
      .from("push_subscriptions")
      .select(
        "id, member_id, endpoint, p256dh, auth, messages_enabled, location_enabled, important_enabled, last_notified_at",
      )
      .eq("family_id", message.family_id)
      .eq("enabled", true)
      .in("member_id", targetMemberIds);
    if (subError) throw subError;

    const dedupeCutoff = Date.now() - DEDUPE_WINDOW_MS;
    const targets = ((subscriptions ?? []) as PushSubscriptionRow[]).filter(
      (sub) => shouldNotify(sub, message.message_type, dedupeCutoff),
    );
    if (targets.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, skipped: "deduped" });
    }

    const payload = JSON.stringify({
      title: "家族チャット",
      body: buildMessagePushBody(sender.nickname, message.message_type),
      url: "/chat",
      tag: `family-chat:${message.family_id}`,
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
        console.warn("[push send failed]", result.reason);
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
    console.warn("[push send-message]", error);
    return NextResponse.json({ ok: false, error: "push_send_failed" });
  }
}

function shouldNotify(
  sub: PushSubscriptionRow,
  messageType: MessageType,
  dedupeCutoff: number,
): boolean {
  if (messageType === "location" && !sub.location_enabled) return false;
  if (messageType !== "location" && !sub.messages_enabled) return false;
  if (
    sub.last_notified_at &&
    new Date(sub.last_notified_at).getTime() > dedupeCutoff
  ) {
    return false;
  }
  return true;
}
