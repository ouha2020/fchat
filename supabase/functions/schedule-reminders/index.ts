import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  getServiceClient,
  jsonResponse,
  readMode,
  requireCronSecret,
  unique,
} from "../_shared/runtime.ts";
import {
  getWebPush,
  isGonePushError,
  pushErrorStatus,
  toWebPushSubscription,
  truncateError,
  type StoredPushSubscription,
} from "../_shared/web-push.ts";

const MAX_BATCH_SIZE = 100;
const ACTIVE_THRESHOLD_MS = 60_000;
const MAX_RETRY_COUNT = 3;

interface ScheduleReminderStats {
  ok: true;
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
  gone: number;
}

interface ReminderDeliveryRow {
  id: string;
  family_id: string;
  schedule_item_id: string;
  member_id: string;
  scheduled_for: string;
  reminder_kind: ScheduleReminderKind;
  status: "pending" | "sent" | "skipped" | "failed" | "gone";
  attempt_count: number;
}

type ScheduleReminderKind = "before_start" | "snooze" | "overdue";

interface ScheduleReminderRow {
  id: string;
  family_id: string;
  creator_member_id: string;
  assignee_member_id: string;
  visibility: "family" | "private";
  status: "active" | "done" | "cancelled";
  deleted_at: string | null;
  remind_at: string | null;
  starts_at: string;
}

interface MemberRow {
  id: string;
  family_id: string;
  status: string;
}

interface PushSubscriptionRow extends StoredPushSubscription {
  id: string;
  family_id: string;
  member_id: string;
  endpoint: string;
  enabled: boolean;
  messages_enabled: boolean;
}

type DeliveryOutcome = "sent" | "gone" | "skipped" | "failed";

Deno.serve(async (request) => {
  const authError = requireCronSecret(request, [
    "SCHEDULE_REMINDER_SECRET",
    "CRON_SECRET",
  ]);
  if (authError) return authError;

  const mode = await readMode(request, ["flush", "retry"], "flush");

  try {
    const sb = getServiceClient();
    const result =
      mode === "retry"
        ? await retryFailedScheduleReminders(sb)
        : await flushDueScheduleReminders(sb);

    return jsonResponse(result);
  } catch (error) {
    console.warn(
      "[schedule-reminders]",
      error instanceof Error ? error.message : "schedule_reminder_failed",
    );
    return jsonResponse(
      {
        ok: false,
        error:
          mode === "retry"
            ? "schedule_reminder_retry_failed"
            : "schedule_reminder_failed",
      },
      500,
    );
  }
});

async function flushDueScheduleReminders(
  sb: SupabaseClient,
): Promise<ScheduleReminderStats> {
  await sb.rpc("ensure_overdue_schedule_reminders");
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("family_schedule_reminder_deliveries")
    .select(
      "id, family_id, schedule_item_id, member_id, scheduled_for, reminder_kind, status, attempt_count",
    )
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(MAX_BATCH_SIZE);
  if (error) throw error;

  return processDeliveries(sb, (data ?? []) as ReminderDeliveryRow[]);
}

async function retryFailedScheduleReminders(
  sb: SupabaseClient,
): Promise<ScheduleReminderStats> {
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("family_schedule_reminder_deliveries")
    .select(
      "id, family_id, schedule_item_id, member_id, scheduled_for, reminder_kind, status, attempt_count",
    )
    .eq("status", "failed")
    .lte("next_retry_at", now)
    .lt("attempt_count", MAX_RETRY_COUNT)
    .order("next_retry_at", { ascending: true })
    .limit(MAX_BATCH_SIZE);
  if (error) throw error;

  return processDeliveries(sb, (data ?? []) as ReminderDeliveryRow[]);
}

async function processDeliveries(
  sb: SupabaseClient,
  deliveries: ReminderDeliveryRow[],
): Promise<ScheduleReminderStats> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let gone = 0;

  for (const delivery of deliveries) {
    const outcome = await processDelivery(sb, delivery);
    if (outcome === "sent") sent += 1;
    if (outcome === "skipped") skipped += 1;
    if (outcome === "failed") failed += 1;
    if (outcome === "gone") gone += 1;
  }

  return {
    ok: true,
    scanned: deliveries.length,
    sent,
    skipped,
    failed,
    gone,
  };
}

async function processDelivery(
  sb: SupabaseClient,
  delivery: ReminderDeliveryRow,
): Promise<DeliveryOutcome> {
  const now = new Date().toISOString();

  try {
    const [item, member] = await Promise.all([
      fetchScheduleItem(sb, delivery.schedule_item_id),
      fetchMember(sb, delivery.member_id),
    ]);

    if (!item || !isDeliveryStillDue(delivery, item)) {
      await markDeliverySkipped(sb, delivery.id, "schedule_not_active", now);
      return "skipped";
    }
    if (!member || member.family_id !== item.family_id || member.status !== "active") {
      await markDeliverySkipped(sb, delivery.id, "member_not_active", now);
      return "skipped";
    }
    if (!memberCanViewItem(member.id, item)) {
      await markDeliverySkipped(sb, delivery.id, "not_visible", now);
      return "skipped";
    }
    if (await isMemberRecentlyActive(sb, item.family_id, member.id)) {
      await markDeliverySkipped(sb, delivery.id, "active_recently", now);
      return "skipped";
    }

    const subscriptions = await fetchSubscriptions(sb, member.id);
    if (subscriptions.length === 0) {
      await markDeliverySkipped(sb, delivery.id, "no_subscription", now);
      return "skipped";
    }

    const sendResults = await Promise.all(
      subscriptions.map((sub) =>
        sendSchedulePush(item, sub, delivery.reminder_kind),
      ),
    );
    const sentSubscriptionIds = subscriptions
      .filter((_, index) => sendResults[index].status === "sent")
      .map((sub) => sub.id);
    const goneSubscriptionIds = subscriptions
      .filter((_, index) => sendResults[index].status === "gone")
      .map((sub) => sub.id);
    const failedResult = sendResults.find((result) => result.status === "failed");

    if (goneSubscriptionIds.length > 0) {
      await disableSubscriptions(sb, goneSubscriptionIds, now);
    }

    if (sentSubscriptionIds.length > 0) {
      await Promise.all([
        markDeliverySent(sb, delivery, now),
        markSubscriptionsNotified(sb, sentSubscriptionIds, now),
        markScheduleReminded(sb, item.id, now),
      ]);
      return "sent";
    }

    if (goneSubscriptionIds.length === subscriptions.length) {
      await markDeliveryGone(sb, delivery.id, now);
      return "gone";
    }

    await markDeliveryFailed(
      sb,
      delivery,
      failedResult?.errorStatus ?? null,
      failedResult?.errorMessage ?? "schedule_push_failed",
      now,
    );
    return "failed";
  } catch (error) {
    await markDeliveryFailed(
      sb,
      delivery,
      null,
      truncateError(error) ?? "schedule_push_failed",
      now,
    );
    return "failed";
  }
}

async function fetchScheduleItem(
  sb: SupabaseClient,
  scheduleItemId: string,
): Promise<ScheduleReminderRow | null> {
  const { data, error } = await sb
    .from("family_schedule_items")
    .select(
      "id, family_id, creator_member_id, assignee_member_id, visibility, status, deleted_at, remind_at, starts_at",
    )
    .eq("id", scheduleItemId)
    .maybeSingle();
  if (error) throw error;
  return data as ScheduleReminderRow | null;
}

async function fetchMember(
  sb: SupabaseClient,
  memberId: string,
): Promise<MemberRow | null> {
  const { data, error } = await sb
    .from("family_members")
    .select("id, family_id, status")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw error;
  return data as MemberRow | null;
}

function isDeliveryStillDue(
  delivery: ReminderDeliveryRow,
  item: ScheduleReminderRow,
): boolean {
  if (item.status !== "active" || item.deleted_at !== null) return false;
  if (delivery.reminder_kind === "snooze") return true;
  if (delivery.reminder_kind === "overdue") {
    return item.starts_at <= new Date().toISOString();
  }
  return true;
}

function memberCanViewItem(memberId: string, item: ScheduleReminderRow): boolean {
  return (
    item.visibility === "family" ||
    item.creator_member_id === memberId ||
    item.assignee_member_id === memberId
  );
}

async function fetchSubscriptions(
  sb: SupabaseClient,
  memberId: string,
): Promise<PushSubscriptionRow[]> {
  const { data, error } = await sb
    .from("push_subscriptions")
    .select("id, family_id, member_id, endpoint, p256dh, auth, enabled, messages_enabled")
    .eq("member_id", memberId)
    .eq("enabled", true)
    .eq("messages_enabled", true);
  if (error) throw error;
  return (data ?? []) as PushSubscriptionRow[];
}

async function isMemberRecentlyActive(
  sb: SupabaseClient,
  familyId: string,
  memberId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("user_presence")
    .select("member_id")
    .eq("family_id", familyId)
    .eq("member_id", memberId)
    .in("current_page", ["chat", "schedule"])
    .eq("is_active", true)
    .gt("last_seen_at", new Date(Date.now() - ACTIVE_THRESHOLD_MS).toISOString())
    .maybeSingle();
  return Boolean(data);
}

async function sendSchedulePush(
  item: ScheduleReminderRow,
  sub: PushSubscriptionRow,
  reminderKind: ScheduleReminderKind,
): Promise<{
  status: "sent" | "gone" | "failed";
  errorStatus?: number | null;
  errorMessage?: string | null;
}> {
  const url = `/schedule?item=${encodeURIComponent(item.id)}`;
  const payload = JSON.stringify({
    type: "schedule-reminder",
    title: "\u5bb6\u5ead\u65e5\u7a0b\u63d0\u9192",
    body: buildScheduleReminderBody(item, reminderKind),
    url,
    familyId: item.family_id,
    scheduleItemId: item.id,
    tag: `family-schedule-reminder-${item.id}`,
  });

  try {
    await getWebPush().sendNotification(toWebPushSubscription(sub), payload, {
      TTL: 60 * 60,
    });
    return { status: "sent" };
  } catch (error) {
    if (isGonePushError(error)) return { status: "gone" };
    const rawStatus = pushErrorStatus(error);
    const errorStatus = typeof rawStatus === "number" ? rawStatus : null;
    return {
      status: "failed",
      errorStatus,
      errorMessage:
        typeof rawStatus === "number"
          ? `push_failed_${rawStatus}`
          : truncateError(error) ?? "schedule_push_failed",
    };
  }
}

function buildScheduleReminderBody(
  item: ScheduleReminderRow,
  reminderKind: ScheduleReminderKind,
): string {
  if (reminderKind === "overdue") {
    return item.visibility === "private"
      ? "\u6709\u4e00\u9879\u79c1\u4eba\u65e5\u7a0b\u8fd8\u672a\u5b8c\u6210"
      : "\u6709\u4e00\u9879\u5bb6\u5ead\u65e5\u7a0b\u8fd8\u672a\u5b8c\u6210";
  }
  return item.visibility === "private"
    ? "\u6709\u4e00\u9879\u79c1\u4eba\u65e5\u7a0b\u9700\u8981\u67e5\u770b"
    : "\u6709\u4e00\u9879\u5bb6\u5ead\u65e5\u7a0b\u9700\u8981\u67e5\u770b";
}

async function markDeliverySent(
  sb: SupabaseClient,
  delivery: ReminderDeliveryRow,
  timestamp: string,
): Promise<void> {
  await sb
    .from("family_schedule_reminder_deliveries")
    .update({
      status: "sent",
      attempt_count: delivery.attempt_count + 1,
      delivered_at: timestamp,
      last_attempt_at: timestamp,
      next_retry_at: null,
      skipped_reason: null,
      error_status: null,
      error_message: null,
      updated_at: timestamp,
    })
    .eq("id", delivery.id);
}

async function markDeliverySkipped(
  sb: SupabaseClient,
  deliveryId: string,
  reason: string,
  timestamp: string,
): Promise<void> {
  await sb
    .from("family_schedule_reminder_deliveries")
    .update({
      status: "skipped",
      skipped_reason: reason,
      last_attempt_at: timestamp,
      next_retry_at: null,
      updated_at: timestamp,
    })
    .eq("id", deliveryId);
}

async function markDeliveryGone(
  sb: SupabaseClient,
  deliveryId: string,
  timestamp: string,
): Promise<void> {
  await sb
    .from("family_schedule_reminder_deliveries")
    .update({
      status: "gone",
      last_attempt_at: timestamp,
      next_retry_at: null,
      error_status: 410,
      error_message: "push_subscription_gone",
      updated_at: timestamp,
    })
    .eq("id", deliveryId);
}

async function markDeliveryFailed(
  sb: SupabaseClient,
  delivery: ReminderDeliveryRow,
  errorStatus: number | null,
  errorMessage: string,
  timestamp: string,
): Promise<void> {
  const attemptCount = delivery.attempt_count + 1;
  await sb
    .from("family_schedule_reminder_deliveries")
    .update({
      status: "failed",
      attempt_count: attemptCount,
      last_attempt_at: timestamp,
      next_retry_at:
        attemptCount >= MAX_RETRY_COUNT
          ? null
          : new Date(Date.now() + retryDelayMs(attemptCount)).toISOString(),
      error_status: errorStatus,
      error_message: errorMessage.slice(0, 300),
      updated_at: timestamp,
    })
    .eq("id", delivery.id);
}

async function disableSubscriptions(
  sb: SupabaseClient,
  subscriptionIds: string[],
  timestamp: string,
): Promise<void> {
  if (subscriptionIds.length === 0) return;
  await sb
    .from("push_subscriptions")
    .update({
      enabled: false,
      disabled_at: timestamp,
      disabled_reason: "gone",
      updated_at: timestamp,
    })
    .in("id", unique(subscriptionIds));
}

async function markSubscriptionsNotified(
  sb: SupabaseClient,
  subscriptionIds: string[],
  notifiedAt: string,
): Promise<void> {
  if (subscriptionIds.length === 0) return;
  await sb
    .from("push_subscriptions")
    .update({ last_notified_at: notifiedAt, updated_at: notifiedAt })
    .in("id", unique(subscriptionIds));
}

async function markScheduleReminded(
  sb: SupabaseClient,
  scheduleItemId: string,
  remindedAt: string,
): Promise<void> {
  await sb
    .from("family_schedule_items")
    .update({
      reminded_at: remindedAt,
      reminder_push_attempted_at: remindedAt,
      reminder_push_error: null,
      updated_at: remindedAt,
    })
    .eq("id", scheduleItemId)
    .is("reminded_at", null);
}

function retryDelayMs(attemptCount: number): number {
  if (attemptCount <= 1) return 2 * 60_000;
  if (attemptCount === 2) return 10 * 60_000;
  return 30 * 60_000;
}
