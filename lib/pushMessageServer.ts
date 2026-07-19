import type { SupabaseClient } from "@supabase/supabase-js";

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

const ACTIVE_THRESHOLD_MS = 60_000;
const FLUSH_PENDING_AFTER_MS = 30_000;
const MAX_BATCH_SIZE = 100;
const MAX_RETRY_COUNT = 3;

type AttemptSource = "immediate" | "flush_pending" | "retry_failed";
type PushLogStatus = "sent" | "failed" | "gone" | "skipped";

export interface PushBatchStats {
  ok: true;
  scanned: number;
  sent: number;
  gone: number;
  failed: number;
  skipped: number;
}

interface MessageRow {
  id: string;
  family_id: string;
  sender_member_id: string | null;
  recipient_member_id: string | null;
  message_type: MessageType;
  deleted_at: string | null;
  push_requested_at?: string | null;
}

interface MemberRow {
  id: string;
  nickname: string;
  status: string;
}

interface RecipientRow {
  family_id: string;
  message_id: string;
  member_id: string;
  delivery_state: "pending" | "delivered" | "read";
  delivered_at: string | null;
  read_at: string | null;
  notified_at: string | null;
  created_at?: string;
}

interface PushSubscriptionRow extends StoredPushSubscription {
  id: string;
  family_id: string;
  member_id: string;
  endpoint: string;
  platform: string;
  enabled: boolean;
  messages_enabled: boolean;
  location_enabled: boolean;
  important_enabled?: boolean;
  last_notified_at?: string | null;
  disabled_at?: string | null;
  disabled_reason?: string | null;
  updated_at?: string | null;
}

interface PushLogRow {
  id: string;
  family_id: string;
  message_id: string | null;
  subscription_id: string | null;
  member_id: string | null;
  endpoint: string | null;
  status: PushLogStatus;
  attempt_source: string | null;
  skip_reason: string | null;
  retry_count: number;
  error_status: number | null;
  error_message: string | null;
  next_retry_at: string | null;
  last_attempt_at: string | null;
  created_at: string;
}

interface Candidate {
  familyId: string;
  messageId: string;
  memberId: string;
  message: MessageRow;
  sender: MemberRow;
  recipient: MemberRow;
}

interface RecipientSkip {
  familyId: string;
  messageId: string;
  memberId: string;
  message: MessageRow;
  reason: string;
}

interface CandidatePlan {
  candidates: Candidate[];
  recipientSkips: RecipientSkip[];
  scanned: number;
}

interface DirectSender {
  family_id: string;
  member_id: string;
  nickname: string;
}

export async function sendImmediateMessageNotification(
  sender: DirectSender,
  messageId: string,
): Promise<PushBatchStats & { skippedReason?: string }> {
  const sb = getSupabaseAdmin();
  const { data: message, error: messageError } = await sb
    .from("messages")
    .select(
      "id, family_id, sender_member_id, recipient_member_id, message_type, deleted_at, push_requested_at",
    )
    .eq("id", messageId)
    .maybeSingle<MessageRow>();
  if (messageError) throw messageError;
  if (!message) {
    return emptyStats(1, "message_not_found");
  }
  if (message.family_id !== sender.family_id || message.sender_member_id !== sender.member_id) {
    throw new Error("forbidden");
  }

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
    return emptyStats(1, "already_requested");
  }

  const { data: recipients, error: recipientError } = await sb
    .from("message_recipients")
    .select("family_id, message_id, member_id, delivery_state, delivered_at, read_at, notified_at")
    .eq("family_id", message.family_id)
    .eq("message_id", message.id);
  if (recipientError) throw recipientError;

  const plan = await buildCandidatePlan(
    sb,
    (recipients ?? []) as RecipientRow[],
    new Map([[message.id, message]]),
    new Map([[sender.member_id, { id: sender.member_id, nickname: sender.nickname, status: "active" }]]),
    true,
  );
  return sendCandidatePlan(sb, plan, "immediate");
}

export async function flushPendingPushNotifications(): Promise<PushBatchStats> {
  const sb = getSupabaseAdmin();
  const olderThan = new Date(Date.now() - FLUSH_PENDING_AFTER_MS).toISOString();
  const { data: recipients, error } = await sb
    .from("message_recipients")
    .select("family_id, message_id, member_id, delivery_state, delivered_at, read_at, notified_at, created_at")
    .eq("delivery_state", "pending")
    .is("notified_at", null)
    .lt("created_at", olderThan)
    .order("created_at", { ascending: true })
    .limit(MAX_BATCH_SIZE);
  if (error) throw error;

  const plan = await buildCandidatePlan(sb, (recipients ?? []) as RecipientRow[]);
  return sendCandidatePlan(sb, plan, "flush_pending");
}

export async function retryFailedPushNotifications(): Promise<PushBatchStats> {
  const sb = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data: logs, error } = await sb
    .from("push_delivery_logs")
    .select(
      "id, family_id, message_id, subscription_id, member_id, endpoint, status, attempt_source, skip_reason, retry_count, error_status, error_message, next_retry_at, last_attempt_at, created_at",
    )
    .eq("status", "failed")
    .lte("next_retry_at", now)
    .lt("retry_count", MAX_RETRY_COUNT)
    .order("next_retry_at", { ascending: true })
    .limit(MAX_BATCH_SIZE);
  if (error) throw error;

  const rows = ((logs ?? []) as PushLogRow[]).filter(
    (log) => log.message_id && log.member_id && log.subscription_id,
  );
  if (rows.length === 0) {
    return { ok: true, scanned: logs?.length ?? 0, sent: 0, gone: 0, failed: 0, skipped: logs?.length ?? 0 };
  }

  const messageIds = unique(rows.map((log) => log.message_id).filter(isPresent));
  const memberIds = unique(rows.map((log) => log.member_id).filter(isPresent));
  const subscriptionIds = unique(rows.map((log) => log.subscription_id).filter(isPresent));

  const messages = await fetchMessages(sb, messageIds);
  const senderIds = unique([...messages.values()].map((message) => message.sender_member_id).filter(isPresent));

  const [recipients, members, activeMemberIds, subscriptions] = await Promise.all([
    fetchRecipientsForMembers(sb, messageIds, memberIds),
    fetchMembers(sb, unique([...memberIds, ...senderIds])),
    fetchActiveChatMembers(sb, unique(rows.map((log) => log.family_id)), memberIds),
    fetchSubscriptionsByIds(sb, subscriptionIds),
  ]);

  let sent = 0;
  let gone = 0;
  let failed = 0;
  let skipped = 0;

  for (const log of rows) {
      const message = log.message_id ? messages.get(log.message_id) ?? null : null;
      const recipient = log.message_id && log.member_id
        ? recipients.get(recipientKey(log.message_id, log.member_id)) ?? null
        : null;
      const member = log.member_id ? members.get(log.member_id) ?? null : null;
      const sender = message?.sender_member_id ? members.get(message.sender_member_id) ?? null : null;
      const sub = log.subscription_id ? subscriptions.get(log.subscription_id) ?? null : null;
      const skipReason = retrySkipReason({ message, recipient, member, sender, sub, activeMemberIds });

      if (skipReason) {
        const attemptedAt = new Date().toISOString();
        skipped += 1;
        await updateLogStatus(sb, log, {
          status: "skipped",
          retryCount: log.retry_count + 1,
          attemptedAt,
          attemptSource: "retry_failed",
          skipReason,
        });
        if (message && log.member_id) {
          await markRecipientPushHandled(sb, message, [log.member_id], attemptedAt);
        }
        continue;
      }

      const result = await sendOnePush({
        message: message!,
        sender: sender!,
        sub: sub!,
      });
      const attemptedAt = new Date().toISOString();
      if (result.status === "sent") {
        sent += 1;
        await markSubscriptionAndRecipientNotified(sb, message!, [sub!], attemptedAt);
        await updateLogStatus(sb, log, {
          status: "sent",
          retryCount: log.retry_count + 1,
          attemptedAt,
          attemptSource: "retry_failed",
        });
      } else if (result.status === "gone") {
        gone += 1;
        await disableSubscriptions(sb, [sub!.id], attemptedAt, "gone");
        await markRecipientPushHandled(sb, message!, [sub!.member_id], attemptedAt);
        await updateLogStatus(sb, log, {
          status: "gone",
          retryCount: log.retry_count + 1,
          attemptedAt,
          attemptSource: "retry_failed",
          errorStatus: result.errorStatus,
          errorMessage: result.errorMessage,
        });
      } else {
        failed += 1;
        const nextRetryCount = log.retry_count + 1;
        await updateLogStatus(sb, log, {
          status: "failed",
          retryCount: nextRetryCount,
          attemptedAt,
          attemptSource: "retry_failed",
          nextRetryAt:
            nextRetryCount >= MAX_RETRY_COUNT
              ? null
              : new Date(Date.now() + retryDelayMs(nextRetryCount)).toISOString(),
          errorStatus: result.errorStatus,
          errorMessage: result.errorMessage,
        });
      }
  }

  return { ok: true, scanned: logs?.length ?? 0, sent, gone, failed, skipped };
}

async function buildCandidatePlan(
  sb: SupabaseClient,
  recipients: RecipientRow[],
  preloadedMessages?: Map<string, MessageRow>,
  preloadedMembers?: Map<string, MemberRow>,
  excludeActiveChat = true,
): Promise<CandidatePlan> {
  const messageIds = unique(recipients.map((row) => row.message_id));
  const memberIds = unique(recipients.map((row) => row.member_id));
  const messages = preloadedMessages ?? await fetchMessages(sb, messageIds);
  const senderIds = unique(
    [...messages.values()].map((message) => message.sender_member_id).filter(isPresent),
  );
  const members = new Map([
    ...(preloadedMembers ?? new Map<string, MemberRow>()).entries(),
    ...(await fetchMembers(sb, unique([...memberIds, ...senderIds]))).entries(),
  ]);
  const activeMemberIds = excludeActiveChat
    ? await fetchActiveChatMembers(
        sb,
        unique(recipients.map((row) => row.family_id)),
        memberIds,
      )
    : new Set<string>();

  const candidates: Candidate[] = [];
  const recipientSkips: RecipientSkip[] = [];

  recipients.forEach((recipient) => {
    const message = messages.get(recipient.message_id);
    if (!message) return;
    const recipientMember = members.get(recipient.member_id);
    const sender = message.sender_member_id ? members.get(message.sender_member_id) : null;
    const reason = recipientSkipReason({
      message,
      recipient,
      recipientMember,
      sender,
      activeMemberIds,
    });

    if (reason) {
      recipientSkips.push({
        familyId: recipient.family_id,
        messageId: recipient.message_id,
        memberId: recipient.member_id,
        message,
        reason,
      });
      return;
    }

    candidates.push({
      familyId: recipient.family_id,
      messageId: recipient.message_id,
      memberId: recipient.member_id,
      message,
      sender: sender!,
      recipient: recipientMember!,
    });
  });

  return { candidates, recipientSkips, scanned: recipients.length };
}

function recipientSkipReason({
  message,
  recipient,
  recipientMember,
  sender,
  activeMemberIds,
}: {
  message: MessageRow;
  recipient: RecipientRow;
  recipientMember: MemberRow | undefined;
  sender: MemberRow | null | undefined;
  activeMemberIds: Set<string>;
}): string | null {
  if (message.deleted_at) return "message_deleted";
  if (message.message_type === "system") return "system_message";
  if (message.sender_member_id === recipient.member_id) return "sender_self";
  if (recipient.delivery_state !== "pending" || recipient.read_at) {
    return recipient.read_at ? "message_read" : "message_delivered";
  }
  if (!recipientMember || recipientMember.status !== "active") return "member_inactive";
  if (!sender) return "sender_missing";
  if (activeMemberIds.has(recipient.member_id)) return "active_on_chat";
  return null;
}

function retrySkipReason({
  message,
  recipient,
  member,
  sender,
  sub,
  activeMemberIds,
}: {
  message: MessageRow | null;
  recipient: RecipientRow | null;
  member: MemberRow | null;
  sender: MemberRow | null;
  sub: PushSubscriptionRow | null;
  activeMemberIds: Set<string>;
}): string | null {
  if (!message) return "message_not_found";
  if (!recipient) return "recipient_not_found";
  const recipientReason = recipientSkipReason({
    message,
    recipient,
    recipientMember: member ?? undefined,
    sender,
    activeMemberIds,
  });
  if (recipientReason) return recipientReason;
  if (!sub) return "subscription_not_found";
  return subscriptionSkipReason(sub, message.message_type);
}

async function sendCandidatePlan(
  sb: SupabaseClient,
  plan: CandidatePlan,
  attemptSource: AttemptSource,
): Promise<PushBatchStats> {
  if (plan.scanned === 0) {
    return { ok: true, scanned: 0, sent: 0, gone: 0, failed: 0, skipped: 0 };
  }

  const subscriptions = await fetchSubscriptions(
    sb,
    unique([
      ...plan.candidates.map((candidate) => candidate.memberId),
      ...plan.recipientSkips.map((skip) => skip.memberId),
    ]),
  );

  let sent = 0;
  let gone = 0;
  let failed = 0;
  let skipped = 0;

  skipped += await insertRecipientSkipLogs(
    sb,
    plan.recipientSkips,
    subscriptions,
    attemptSource,
  );

  for (const candidate of plan.candidates) {
      const memberSubscriptions = subscriptions.get(candidate.memberId) ?? [];
      if (memberSubscriptions.length === 0) {
        skipped += await insertDeliveryLogs(
          sb,
          candidate.message,
          [
            {
              memberId: candidate.memberId,
              sub: null,
              status: "skipped",
              skipReason: "no_subscription",
            },
          ],
          new Date().toISOString(),
          attemptSource,
        );
        await markRecipientPushHandled(
          sb,
          candidate.message,
          [candidate.memberId],
          new Date().toISOString(),
        );
        continue;
      }

      const sendable: PushSubscriptionRow[] = [];
      const skippedEntries: DeliveryLogEntry[] = [];
      memberSubscriptions.forEach((sub) => {
        const skipReason = subscriptionSkipReason(sub, candidate.message.message_type);
        if (skipReason) {
          skippedEntries.push({
            memberId: candidate.memberId,
            sub,
            status: "skipped",
            skipReason,
          });
        } else {
          sendable.push(sub);
        }
      });

      if (skippedEntries.length > 0) {
        skipped += await insertDeliveryLogs(
          sb,
          candidate.message,
          skippedEntries,
          new Date().toISOString(),
          attemptSource,
        );
      }
      if (sendable.length === 0) {
        await markRecipientPushHandled(
          sb,
          candidate.message,
          [candidate.memberId],
          new Date().toISOString(),
        );
        continue;
      }

      const results = await Promise.all(
        sendable.map((sub) =>
          sendOnePush({
            message: candidate.message,
            sender: candidate.sender,
            sub,
          }),
        ),
      );
      const attemptedAt = new Date().toISOString();
      const sentSubs = sendable.filter((_, index) => results[index]?.status === "sent");
      const goneSubs = sendable.filter((_, index) => results[index]?.status === "gone");
      const failedPairs = sendable
        .map((sub, index) => ({ sub, result: results[index] }))
        .filter((pair) => pair.result?.status === "failed");

      sent += sentSubs.length;
      gone += goneSubs.length;
      failed += failedPairs.length;

      if (sentSubs.length > 0) {
        await markSubscriptionAndRecipientNotified(
          sb,
          candidate.message,
          sentSubs,
          attemptedAt,
        );
      }
      if (goneSubs.length > 0) {
        await disableSubscriptions(sb, goneSubs.map((sub) => sub.id), attemptedAt, "gone");
      }
      if (sentSubs.length === 0 && failedPairs.length === 0 && goneSubs.length > 0) {
        await markRecipientPushHandled(sb, candidate.message, [candidate.memberId], attemptedAt);
      }

      await insertDeliveryLogs(
        sb,
        candidate.message,
        [
          ...sentSubs.map((sub) => ({
            memberId: sub.member_id,
            sub,
            status: "sent" as const,
          })),
          ...goneSubs.map((sub) => ({
            memberId: sub.member_id,
            sub,
            status: "gone" as const,
            result: results[sendable.indexOf(sub)],
          })),
          ...failedPairs.map(({ sub, result }) => ({
            memberId: sub.member_id,
            sub,
            status: "failed" as const,
            result,
          })),
        ],
        attemptedAt,
        attemptSource,
      );
  }

  return { ok: true, scanned: plan.scanned, sent, gone, failed, skipped };
}

async function insertRecipientSkipLogs(
  sb: SupabaseClient,
  skips: RecipientSkip[],
  subscriptions: Map<string, PushSubscriptionRow[]>,
  attemptSource: AttemptSource,
): Promise<number> {
  let inserted = 0;
  for (const skip of skips) {
      const memberSubscriptions = subscriptions.get(skip.memberId) ?? [];
      const entries: DeliveryLogEntry[] =
        memberSubscriptions.length > 0
          ? memberSubscriptions.map((sub) => ({
              memberId: skip.memberId,
              sub,
              status: "skipped",
              skipReason: skip.reason,
            }))
          : [
              {
                memberId: skip.memberId,
                sub: null,
                status: "skipped",
                skipReason: skip.reason,
              },
            ];
      inserted += await insertDeliveryLogs(
        sb,
        skip.message,
        entries,
        new Date().toISOString(),
        attemptSource,
      );
      await markRecipientPushHandled(
        sb,
        skip.message,
        [skip.memberId],
        new Date().toISOString(),
      );
  }
  return inserted;
}

function subscriptionSkipReason(
  sub: PushSubscriptionRow,
  messageType: MessageType,
): string | null {
  if (!sub.enabled) return "subscription_disabled";
  if (!sub.messages_enabled) return "messages_disabled";
  if (messageType === "location" && !sub.location_enabled) return "location_disabled";
  return null;
}

async function sendOnePush({
  message,
  sender,
  sub,
}: {
  message: MessageRow;
  sender: MemberRow;
  sub: PushSubscriptionRow;
}): Promise<{
  status: "sent" | "gone" | "failed";
  errorStatus?: number | null;
  errorMessage?: string | null;
}> {
  const payload = JSON.stringify({
    title: "\u5bb6\u5ead\u804a\u5929",
    body: buildMessagePushBody(
      sender.nickname,
      message.message_type,
      Boolean(message.recipient_member_id),
    ),
    url: "/chat",
    familyId: message.family_id,
    messageId: message.id,
    tag: `family-chat:${message.family_id}:${message.id}`,
  });

  try {
    await getWebPush().sendNotification(toWebPushSubscription(sub), payload, {
      TTL: 60 * 60,
      // High urgency asks the push service (FCM/APNs) to deliver promptly even
      // when the device is in Doze / under battery optimization — normal
      // urgency gets batched or dropped on Android in the background.
      urgency: "high",
    });
    return { status: "sent" };
  } catch (error) {
    return {
      status: isGonePushError(error) ? "gone" : "failed",
      errorStatus: numericPushStatus(error),
      errorMessage: truncateError(error),
    };
  }
}

async function markSubscriptionAndRecipientNotified(
  sb: SupabaseClient,
  message: MessageRow,
  sentSubs: PushSubscriptionRow[],
  notifiedAt: string,
): Promise<void> {
  if (sentSubs.length === 0) return;
  const subscriptionIds = sentSubs.map((sub) => sub.id);
  const memberIds = unique(sentSubs.map((sub) => sub.member_id));
  await Promise.all([
    sb
      .from("push_subscriptions")
      .update({ last_notified_at: notifiedAt, updated_at: notifiedAt })
      .in("id", subscriptionIds),
    sb
      .from("message_recipients")
      .update({ notified_at: notifiedAt })
      .eq("family_id", message.family_id)
      .eq("message_id", message.id)
      .in("member_id", memberIds),
  ]);
}

async function markRecipientPushHandled(
  sb: SupabaseClient,
  message: MessageRow,
  memberIds: string[],
  notifiedAt: string,
): Promise<void> {
  if (memberIds.length === 0) return;
  await sb
    .from("message_recipients")
    .update({ notified_at: notifiedAt })
    .eq("family_id", message.family_id)
    .eq("message_id", message.id)
    .in("member_id", unique(memberIds))
    .is("notified_at", null);
}

async function disableSubscriptions(
  sb: SupabaseClient,
  subscriptionIds: string[],
  updatedAt: string,
  disabledReason: string,
): Promise<void> {
  if (subscriptionIds.length === 0) return;
  await sb
    .from("push_subscriptions")
    .update({
      enabled: false,
      disabled_at: updatedAt,
      disabled_reason: disabledReason,
      updated_at: updatedAt,
    })
    .in("id", unique(subscriptionIds));
}

interface DeliveryLogEntry {
  memberId: string;
  sub: PushSubscriptionRow | null;
  status: PushLogStatus;
  skipReason?: string | null;
  result?: { errorStatus?: number | null; errorMessage?: string | null };
}

async function insertDeliveryLogs(
  sb: SupabaseClient,
  message: MessageRow,
  entries: DeliveryLogEntry[],
  createdAt: string,
  attemptSource: AttemptSource,
): Promise<number> {
  if (entries.length === 0) return 0;
  const { error } = await sb.from("push_delivery_logs").insert(
    entries.map(({ memberId, sub, status, skipReason, result }) => ({
      family_id: message.family_id,
      message_id: message.id,
      subscription_id: sub?.id ?? null,
      member_id: sub?.member_id ?? memberId,
      endpoint: sub?.endpoint ?? null,
      status,
      attempt_source: attemptSource,
      skip_reason: status === "skipped" ? skipReason ?? null : null,
      retry_count: 0,
      error_code: result?.errorStatus ? String(result.errorStatus) : null,
      error_status: result?.errorStatus ?? null,
      error_message: result?.errorMessage ?? null,
      last_attempt_at: createdAt,
      next_retry_at:
        status === "failed"
          ? new Date(Date.now() + retryDelayMs(0)).toISOString()
          : null,
      created_at: createdAt,
    })),
  );
  if (error) throw error;
  return entries.length;
}

async function updateLogStatus(
  sb: SupabaseClient,
  log: PushLogRow,
  input: {
    status: PushLogStatus;
    retryCount: number;
    attemptedAt: string;
    attemptSource: AttemptSource;
    nextRetryAt?: string | null;
    skipReason?: string | null;
    errorStatus?: number | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  await sb
    .from("push_delivery_logs")
    .update({
      status: input.status,
      attempt_source: input.attemptSource,
      skip_reason: input.status === "skipped" ? input.skipReason ?? null : null,
      retry_count: input.retryCount,
      last_attempt_at: input.attemptedAt,
      next_retry_at: input.nextRetryAt ?? null,
      error_code: input.errorStatus ? String(input.errorStatus) : null,
      error_status: input.errorStatus ?? null,
      error_message: input.errorMessage ?? null,
    })
    .eq("id", log.id);
}

async function fetchMessages(
  sb: SupabaseClient,
  messageIds: string[],
): Promise<Map<string, MessageRow>> {
  if (messageIds.length === 0) return new Map();
  const { data, error } = await sb
    .from("messages")
    .select("id, family_id, sender_member_id, recipient_member_id, message_type, deleted_at")
    .in("id", messageIds);
  if (error) throw error;
  return new Map(((data ?? []) as MessageRow[]).map((message) => [message.id, message]));
}

async function fetchMembers(
  sb: SupabaseClient,
  memberIds: string[],
): Promise<Map<string, MemberRow>> {
  if (memberIds.length === 0) return new Map();
  const { data, error } = await sb
    .from("family_members")
    .select("id, nickname, status")
    .in("id", unique(memberIds));
  if (error) throw error;
  return new Map(((data ?? []) as MemberRow[]).map((member) => [member.id, member]));
}

async function fetchRecipientsForMembers(
  sb: SupabaseClient,
  messageIds: string[],
  memberIds: string[],
): Promise<Map<string, RecipientRow>> {
  if (messageIds.length === 0 || memberIds.length === 0) return new Map();
  const { data, error } = await sb
    .from("message_recipients")
    .select("family_id, message_id, member_id, delivery_state, delivered_at, read_at, notified_at")
    .in("message_id", messageIds)
    .in("member_id", memberIds);
  if (error) throw error;
  return new Map(
    ((data ?? []) as RecipientRow[]).map((row) => [recipientKey(row.message_id, row.member_id), row]),
  );
}

async function fetchSubscriptions(
  sb: SupabaseClient,
  memberIds: string[],
): Promise<Map<string, PushSubscriptionRow[]>> {
  if (memberIds.length === 0) return new Map();
  const { data, error } = await sb
    .from("push_subscriptions")
    .select(
      "id, family_id, member_id, endpoint, p256dh, auth, platform, enabled, messages_enabled, location_enabled, important_enabled, last_notified_at, disabled_at, disabled_reason, updated_at",
    )
    .in("member_id", unique(memberIds));
  if (error) throw error;
  const byMember = new Map<string, PushSubscriptionRow[]>();
  ((data ?? []) as PushSubscriptionRow[]).forEach((sub) => {
    const list = byMember.get(sub.member_id) ?? [];
    list.push(sub);
    byMember.set(sub.member_id, list);
  });
  byMember.forEach((list) => {
    list.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  });
  return byMember;
}

async function fetchSubscriptionsByIds(
  sb: SupabaseClient,
  subscriptionIds: string[],
): Promise<Map<string, PushSubscriptionRow>> {
  if (subscriptionIds.length === 0) return new Map();
  const { data, error } = await sb
    .from("push_subscriptions")
    .select(
      "id, family_id, member_id, endpoint, p256dh, auth, platform, enabled, messages_enabled, location_enabled, important_enabled, last_notified_at, disabled_at, disabled_reason, updated_at",
    )
    .in("id", unique(subscriptionIds));
  if (error) throw error;
  return new Map(((data ?? []) as PushSubscriptionRow[]).map((sub) => [sub.id, sub]));
}

async function fetchActiveChatMembers(
  sb: SupabaseClient,
  familyIds: string[],
  memberIds: string[],
): Promise<Set<string>> {
  if (familyIds.length === 0 || memberIds.length === 0) return new Set();
  const { data } = await sb
    .from("user_presence")
    .select("member_id")
    .in("family_id", unique(familyIds))
    .in("member_id", unique(memberIds))
    .eq("current_page", "chat")
    .eq("is_active", true)
    .gt("last_seen_at", new Date(Date.now() - ACTIVE_THRESHOLD_MS).toISOString());
  return new Set((data ?? []).map((row) => row.member_id as string));
}

function recipientKey(messageId: string, memberId: string): string {
  return `${messageId}:${memberId}`;
}

function retryDelayMs(retryCount: number): number {
  if (retryCount <= 0) return 2 * 60 * 1000;
  if (retryCount === 1) return 10 * 60 * 1000;
  return 30 * 60 * 1000;
}

function emptyStats(scanned: number, skippedReason: string): PushBatchStats & { skippedReason: string } {
  return {
    ok: true,
    scanned,
    sent: 0,
    gone: 0,
    failed: 0,
    skipped: scanned,
    skippedReason,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

function numericPushStatus(error: unknown): number | null {
  const status = pushErrorStatus(error);
  return typeof status === "number" ? status : null;
}

function truncateError(error: unknown): string | null {
  if (error instanceof Error) return error.message.slice(0, 300);
  if (typeof error === "string") return error.slice(0, 300);
  return null;
}
