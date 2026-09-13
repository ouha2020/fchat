import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isScheduleCollaborationDeliveryAcknowledged,
  isRecentScheduleCollaborationEvidence,
  resolveScheduleCollaborationAudience,
  type ScheduleCollaborationNotifyType,
} from "@/lib/scheduleCollaborationPolicy";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getWebPush,
  isGonePushError,
  toWebPushSubscription,
  WEB_PUSH_DELIVERY_OPTIONS,
  type StoredPushSubscription,
} from "@/lib/webPushServer";

const ACTIVE_THRESHOLD_MS = 60_000;
const EVIDENCE_WINDOW_MS = 5 * 60_000;

export type { ScheduleCollaborationNotifyType } from "@/lib/scheduleCollaborationPolicy";

interface NotifyInput {
  memberId: string;
  memberToken: string;
  scheduleItemId: string;
  eventType: ScheduleCollaborationNotifyType;
  contextEventId?: string | null;
}

interface ScheduleItemRow {
  id: string;
  family_id: string;
  creator_member_id: string;
  assignee_member_id: string;
  visibility: "family" | "private";
  assignee_response?: string | null;
}

interface ActivityEvidence {
  kind: "activity";
  id: string;
  created_at: string;
}

interface ContextEvidence {
  kind: "context";
  id: string;
  created_at: string;
  visibility: "family" | "private";
  recipient_member_id: string | null;
}

type CollaborationEvidence = ActivityEvidence | ContextEvidence;

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

  const evidence = await fetchCollaborationEvidence(sb, item, input, actor.id);
  if (!evidence) return { ok: true, sent: 0, skipped: 1 };

  const targetMemberIds = await resolveTargets(
    sb,
    item,
    input.eventType,
    actor.id,
    evidence.kind === "context" ? evidence : null,
  );
  if (targetMemberIds.length === 0) {
    return { ok: true, sent: 0, skipped: 1 };
  }
  const activeMemberIds = await fetchActiveMembers(sb, item.family_id, targetMemberIds);
  const inactiveTargetMemberIds = targetMemberIds.filter(
    (memberId) => !activeMemberIds.has(memberId),
  );
  const subscriptions = await fetchSubscriptions(
    sb,
    item.family_id,
    inactiveTargetMemberIds,
  );
  const subscribedMemberIds = new Set(subscriptions.map((sub) => sub.member_id));
  const claimId = await claimCollaborationEvidence(
    sb,
    item,
    input.eventType,
    actor.id,
    evidence,
  );
  if (!claimId) return { ok: true, sent: 0, skipped: targetMemberIds.length };

  const body = buildBody(input.eventType, actor.nickname);
  const now = new Date().toISOString();
  let sent = 0;
  let gone = 0;
  let failed = 0;
  const sentSubscriptionIds: string[] = [];

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
        WEB_PUSH_DELIVERY_OPTIONS,
      );
      sent += 1;
      sentSubscriptionIds.push(sub.id);
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

  if (sentSubscriptionIds.length > 0) {
    await sb
      .from("push_subscriptions")
      .update({ last_notified_at: now, updated_at: now })
      .in("id", sentSubscriptionIds);
  }

  if (sent === 0 && failed > 0) {
    await releaseCollaborationEvidence(sb, claimId);
  }

  return {
    ok: isScheduleCollaborationDeliveryAcknowledged(sent, failed),
    sent,
    gone,
    failed,
    skipped:
      activeMemberIds.size +
      inactiveTargetMemberIds.filter((memberId) => !subscribedMemberIds.has(memberId))
        .length,
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

async function fetchCollaborationEvidence(
  sb: SupabaseClient,
  item: ScheduleItemRow,
  input: NotifyInput,
  actorMemberId: string,
): Promise<CollaborationEvidence | null> {
  const threshold = new Date(Date.now() - EVIDENCE_WINDOW_MS).toISOString();

  if (input.eventType === "commented") {
    if (!input.contextEventId) return null;
    const { data, error } = await sb
      .from("family_context_events")
      .select("id, created_at, visibility, recipient_member_id, event_type")
      .eq("id", input.contextEventId)
      .eq("family_id", item.family_id)
      .eq("schedule_item_id", item.id)
      .eq("sender_member_id", actorMemberId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (!(["text", "audio", "location"] as string[]).includes(data.event_type)) {
      return null;
    }
    if (
      (data.visibility !== "family" && data.visibility !== "private") ||
      !isRecentScheduleCollaborationEvidence(
        data.created_at as string,
        Date.now(),
        EVIDENCE_WINDOW_MS,
      )
    ) {
      return null;
    }
    return {
      kind: "context",
      id: data.id as string,
      created_at: data.created_at as string,
      visibility: data.visibility,
      recipient_member_id: (data.recipient_member_id as string | null) ?? null,
    };
  }

  const { data, error } = await sb
    .from("family_schedule_activity_logs")
    .select("id, created_at")
    .eq("family_id", item.family_id)
    .eq("schedule_item_id", item.id)
    .eq("actor_member_id", actorMemberId)
    .eq("activity_type", input.eventType)
    .gte("created_at", threshold)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (
    !isRecentScheduleCollaborationEvidence(
      data.created_at as string,
      Date.now(),
      EVIDENCE_WINDOW_MS,
    )
  ) {
    return null;
  }
  return {
    kind: "activity",
    id: data.id as string,
    created_at: data.created_at as string,
  };
}

async function resolveTargets(
  sb: SupabaseClient,
  item: ScheduleItemRow,
  eventType: ScheduleCollaborationNotifyType,
  actorMemberId: string,
  commentEvidence: ContextEvidence | null,
): Promise<string[]> {
  const audience = resolveScheduleCollaborationAudience(
    item,
    eventType,
    actorMemberId,
    commentEvidence,
  );
  if (audience.scope === "none") return [];
  if (audience.scope === "members") return audience.memberIds;
  return fetchFamilyMemberIds(sb, item.family_id, actorMemberId);
}

async function claimCollaborationEvidence(
  sb: SupabaseClient,
  item: ScheduleItemRow,
  eventType: ScheduleCollaborationNotifyType,
  actorMemberId: string,
  evidence: CollaborationEvidence,
): Promise<string | null> {
  const { data, error } = await sb
    .from("family_schedule_collaboration_push_claims")
    .insert({
      family_id: item.family_id,
      schedule_item_id: item.id,
      actor_member_id: actorMemberId,
      event_type: eventType,
      activity_log_id: evidence.kind === "activity" ? evidence.id : null,
      context_event_id: evidence.kind === "context" ? evidence.id : null,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return null;
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

async function releaseCollaborationEvidence(
  sb: SupabaseClient,
  claimId: string,
): Promise<void> {
  await sb
    .from("family_schedule_collaboration_push_claims")
    .delete()
    .eq("id", claimId);
}

async function fetchFamilyMemberIds(
  sb: SupabaseClient,
  familyId: string,
  actorMemberId: string,
): Promise<string[]> {
  const { data, error } = await sb
    .from("family_members")
    .select("id")
    .eq("family_id", familyId)
    .eq("status", "active");
  if (error) throw error;
  return withoutActor((data ?? []).map((row) => row.id as string), actorMemberId);
}

async function fetchSubscriptions(
  sb: SupabaseClient,
  familyId: string,
  memberIds: string[],
): Promise<PushSubscriptionRow[]> {
  if (memberIds.length === 0) return [];
  const { data, error } = await sb
    .from("push_subscriptions")
    .select("id, family_id, member_id, endpoint, p256dh, auth, enabled, messages_enabled")
    .eq("family_id", familyId)
    .eq("enabled", true)
    .eq("messages_enabled", true)
    .in("member_id", unique(memberIds));
  if (error) throw error;
  return (data ?? []) as PushSubscriptionRow[];
}

async function fetchActiveMembers(
  sb: SupabaseClient,
  familyId: string,
  memberIds: string[],
): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  const { data, error } = await sb
    .from("user_presence")
    .select("member_id")
    .eq("family_id", familyId)
    .in("member_id", unique(memberIds))
    .in("current_page", ["chat", "schedule"])
    .eq("is_active", true)
    .gt("last_seen_at", new Date(Date.now() - ACTIVE_THRESHOLD_MS).toISOString());
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.member_id as string));
}

function buildBody(
  eventType: ScheduleCollaborationNotifyType,
  nickname: string,
): string {
  if (eventType === "created") return `${nickname} 新建了一个家庭日程`;
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
