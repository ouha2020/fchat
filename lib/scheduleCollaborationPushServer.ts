import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getWebPush,
  isGonePushError,
  toWebPushSubscription,
  type StoredPushSubscription,
} from "@/lib/webPushServer";

const ACTIVE_THRESHOLD_MS = 60_000;

export type ScheduleCollaborationNotifyType =
  | "assigned"
  | "accepted"
  | "declined"
  | "commented";

interface NotifyInput {
  memberId: string;
  memberToken: string;
  scheduleItemId: string;
  eventType: ScheduleCollaborationNotifyType;
}

interface ScheduleItemRow {
  id: string;
  family_id: string;
  creator_member_id: string;
  assignee_member_id: string;
  visibility: "family" | "private";
  assignee_response?: string | null;
}

interface MemberRow {
  id: string;
  nickname: string;
}

interface PushSubscriptionRow extends StoredPushSubscription {
  id: string;
  family_id: string;
  member_id: string;
  endpoint: string;
  enabled: boolean;
  messages_enabled: boolean;
}

export async function sendScheduleCollaborationPush(input: NotifyInput) {
  const sb = getSupabaseAdmin();
  const actor = await fetchActor(sb, input.memberId);
  const item = await fetchVisibleScheduleItem(sb, input);
  if (!actor || !item) return { ok: true, sent: 0, skipped: 1 };

  if (
    (input.eventType === "accepted" || input.eventType === "declined") &&
    item.assignee_member_id !== actor.id
  ) {
    return { ok: true, sent: 0, skipped: 1 };
  }

  const targetMemberIds = await resolveTargets(sb, item, input.eventType, actor.id);
  const activeMemberIds = await fetchActiveMembers(sb, item.family_id, targetMemberIds);
  const subscriptions = await fetchSubscriptions(
    sb,
    targetMemberIds.filter((memberId) => !activeMemberIds.has(memberId)),
  );
  const body = buildBody(input.eventType, actor.nickname);
  const now = new Date().toISOString();
  let sent = 0;
  let gone = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    try {
      await getWebPush().sendNotification(
        toWebPushSubscription(sub),
        JSON.stringify({
          type: "schedule-collaboration",
          title: "家庭日程",
          body,
          url: `/schedule?item=${encodeURIComponent(item.id)}`,
          familyId: item.family_id,
          scheduleItemId: item.id,
          tag: `family-schedule-collaboration-${item.id}-${input.eventType}`,
        }),
        { TTL: 60 * 60 },
      );
      sent += 1;
    } catch (error) {
      if (isGonePushError(error)) {
        gone += 1;
        await sb
          .from("push_subscriptions")
          .update({
            enabled: false,
            disabled_at: now,
            disabled_reason: "gone",
            updated_at: now,
          })
          .eq("id", sub.id);
      } else {
        failed += 1;
      }
    }
  }

  if (sent > 0) {
    await sb
      .from("push_subscriptions")
      .update({ last_notified_at: now, updated_at: now })
      .in(
        "id",
        subscriptions.map((sub) => sub.id),
      );
  }

  return {
    ok: true,
    sent,
    gone,
    failed,
    skipped: Math.max(0, targetMemberIds.length - subscriptions.length),
  };
}

async function fetchVisibleScheduleItem(
  sb: SupabaseClient,
  input: NotifyInput,
): Promise<ScheduleItemRow | null> {
  const { data, error } = await sb.rpc("get_schedule_item_for_member", {
    p_member_id: input.memberId,
    p_member_token: input.memberToken,
    p_item_id: input.scheduleItemId,
  });
  if (error) return null;
  return ((data ?? []) as ScheduleItemRow[])[0] ?? null;
}

async function fetchActor(
  sb: SupabaseClient,
  memberId: string,
): Promise<MemberRow | null> {
  const { data, error } = await sb
    .from("family_members")
    .select("id, nickname")
    .eq("id", memberId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return null;
  return data as MemberRow | null;
}

async function resolveTargets(
  sb: SupabaseClient,
  item: ScheduleItemRow,
  eventType: ScheduleCollaborationNotifyType,
  actorMemberId: string,
): Promise<string[]> {
  if (eventType === "assigned") {
    return withoutActor([item.assignee_member_id], actorMemberId);
  }
  if (eventType === "accepted" || eventType === "declined") {
    return withoutActor([item.creator_member_id], actorMemberId);
  }
  if (item.visibility === "private") {
    return withoutActor(
      [item.creator_member_id, item.assignee_member_id],
      actorMemberId,
    );
  }

  const { data, error } = await sb
    .from("family_members")
    .select("id")
    .eq("family_id", item.family_id)
    .eq("status", "active");
  if (error) return [];
  return withoutActor(
    (data ?? []).map((row) => row.id as string),
    actorMemberId,
  );
}

async function fetchSubscriptions(
  sb: SupabaseClient,
  memberIds: string[],
): Promise<PushSubscriptionRow[]> {
  if (memberIds.length === 0) return [];
  const { data, error } = await sb
    .from("push_subscriptions")
    .select("id, family_id, member_id, endpoint, p256dh, auth, enabled, messages_enabled")
    .eq("enabled", true)
    .eq("messages_enabled", true)
    .in("member_id", unique(memberIds));
  if (error) return [];
  return (data ?? []) as PushSubscriptionRow[];
}

async function fetchActiveMembers(
  sb: SupabaseClient,
  familyId: string,
  memberIds: string[],
): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  const { data } = await sb
    .from("user_presence")
    .select("member_id")
    .eq("family_id", familyId)
    .in("member_id", unique(memberIds))
    .in("current_page", ["chat", "schedule"])
    .eq("is_active", true)
    .gt("last_seen_at", new Date(Date.now() - ACTIVE_THRESHOLD_MS).toISOString());
  return new Set((data ?? []).map((row) => row.member_id as string));
}

function buildBody(
  eventType: ScheduleCollaborationNotifyType,
  nickname: string,
): string {
  if (eventType === "assigned") return "你被指定负责一个日程";
  if (eventType === "accepted") return `${nickname} 确认负责一个日程`;
  if (eventType === "declined") return `${nickname} 拒绝负责一个日程`;
  return `${nickname} 评论了一个日程`;
}

function withoutActor(memberIds: string[], actorMemberId: string): string[] {
  return unique(memberIds).filter((memberId) => memberId !== actorMemberId);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
