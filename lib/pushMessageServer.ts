import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendResult } from "web-push";

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

export interface PushBatchStats {
  ok: true;
  scanned: number;
  sent: number;
  gone: number;
  failed: number;
  skipped: number;
}

export interface MessageStatusRecipient {
  memberId: string;
  nickname: string;
  deliveryState: "pending" | "delivered" | "read";
  deliveredAt: string | null;
  readAt: string | null;
  notifiedAt: string | null;
  lastPushStatus: "sent" | "failed" | "gone" | "skipped" | null;
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
  messages_enabled: boolean;
  location_enabled: boolean;
  enabled: boolean;
}

interface PushLogRow {
  id: string;
  family_id: string;
  message_id: string | null;
  subscription_id: string | null;
  member_id: string | null;
  endpoint: string | null;
  retry_count: number;
}

interface Candidate {
  familyId: string;
  messageId: string;
  memberId: string;
  message: MessageRow;
  sender: MemberRow;
  recipient: MemberRow;
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
  if (!message || message.deleted_at || message.message_type === "system") {
    return {
      ok: true,
      scanned: 0,
      sent: 0,
      gone: 0,
      failed: 0,
      skipped: 1,
      skippedReason: "message_not_found",
    };
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
    return {
      ok: true,
      scanned: 0,
      sent: 0,
      gone: 0,
      failed: 0,
      skipped: 1,
      skippedReason: "already_requested",
    };
  }

  const { data: recipients, error: recipientError } = await sb
    .from("message_recipients")
    .select("family_id, message_id, member_id, delivery_state, delivered_at, read_at, notified_at")
    .eq("family_id", message.family_id)
    .eq("message_id", message.id)
    .eq("delivery_state", "pending")
    .neq("member_id", sender.member_id);
  if (recipientError) throw recipientError;

  const candidates = await buildCandidates(
    sb,
    (recipients ?? []) as RecipientRow[],
    new Map([[message.id, message]]),
    new Map([[sender.member_id, { id: sender.member_id, nickname: sender.nickname, status: "active" }]]),
    true,
  );
  return sendCandidates(sb, collapseCandidatesByMember(candidates));
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

  const rows = (recipients ?? []) as RecipientRow[];
  const candidates = await buildCandidates(sb, rows, undefined, undefined, true);
  return sendCandidates(sb, collapseCandidatesByMember(candidates), rows.length);
}

export async function retryFailedPushNotifications(): Promise<PushBatchStats> {
  const sb = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data: logs, error } = await sb
    .from("push_delivery_logs")
    .select("id, family_id, message_id, subscription_id, member_id, endpoint, retry_count")
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

  const [messages, recipients, members, activeMemberIds, subscriptions] = await Promise.all([
    fetchMessages(sb, messageIds),
    fetchRecipientsForMembers(sb, messageIds, memberIds),
    fetchMembers(sb, memberIds),
    fetchActiveChatMembers(sb, unique(rows.map((log) => log.family_id)), memberIds),
    fetchSubscriptionsByIds(sb, subscriptionIds),
  ]);

  let sent = 0;
  let gone = 0;
  let failed = 0;
  let skipped = 0;

  await Promise.all(
    rows.map(async (log) => {
      const message = log.message_id ? messages.get(log.message_id) : null;
      const recipient = log.message_id && log.member_id
        ? recipients.get(recipientKey(log.message_id, log.member_id))
        : null;
      const member = log.member_id ? members.get(log.member_id) : null;
      const sender = message?.sender_member_id ? members.get(message.sender_member_id) : null;
      const sub = log.subscription_id ? subscriptions.get(log.subscription_id) : null;

      if (
        !message ||
        !recipient ||
        !member ||
        !sender ||
        !sub ||
        !sub.enabled ||
        message.deleted_at ||
        message.message_type === "system" ||
        message.sender_member_id === log.member_id ||
        recipient.delivery_state !== "pending" ||
        recipient.read_at ||
        activeMemberIds.has(log.member_id ?? "") ||
        !shouldNotify(sub, message.message_type)
      ) {
        skipped += 1;
        return;
      }

      const result = await sendOnePush({
        message,
        sender,
        sub,
      });
      const attemptedAt = new Date().toISOString();
      if (result.status === "sent") {
        sent += 1;
        await markSubscriptionAndRecipientNotified(sb, message, [sub], attemptedAt);
        await updateLogStatus(sb, log, {
          status: "sent",
          retryCount: log.retry_count + 1,
          attemptedAt,
        });
      } else if (result.status === "gone") {
        gone += 1;
        await disableSubscriptions(sb, [sub.id], attemptedAt);
        await updateLogStatus(sb, log, {
          status: "gone",
          retryCount: log.retry_count + 1,
          attemptedAt,
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
          nextRetryAt:
            nextRetryCount >= MAX_RETRY_COUNT
              ? null
              : new Date(Date.now() + retryDelayMs(nextRetryCount)).toISOString(),
          errorStatus: result.errorStatus,
          errorMessage: result.errorMessage,
        });
      }
    }),
  );

  return { ok: true, scanned: logs?.length ?? 0, sent, gone, failed, skipped };
}

export async function getPushMessageStatusForMember(
  member: { family_id: string; member_id: string; is_admin: boolean },
  messageId: string,
): Promise<MessageStatusRecipient[] | null> {
  const sb = getSupabaseAdmin();
  const { data: message, error: messageError } = await sb
    .from("messages")
    .select("id, family_id, sender_member_id, recipient_member_id, message_type, deleted_at")
    .eq("id", messageId)
    .maybeSingle<MessageRow>();
  if (messageError) throw messageError;
  if (!message || message.family_id !== member.family_id) return null;

  const isWhisper = Boolean(message.recipient_member_id);
  const isWhisperParty =
    message.sender_member_id === member.member_id ||
    message.recipient_member_id === member.member_id;
  if (isWhisper && !isWhisperParty) return null;

  let query = sb
    .from("message_recipients")
    .select("family_id, message_id, member_id, delivery_state, delivered_at, read_at, notified_at")
    .eq("family_id", member.family_id)
    .eq("message_id", message.id);

  if (!member.is_admin || isWhisper) {
    query = query.eq("member_id", member.member_id);
  }

  const { data: recipients, error: recipientError } = await query;
  if (recipientError) throw recipientError;
  const recipientRows = (recipients ?? []) as RecipientRow[];
  if (recipientRows.length === 0) return [];

  const memberIds = recipientRows.map((row) => row.member_id);
  const [members, logs] = await Promise.all([
    fetchMembers(sb, memberIds),
    fetchLatestLogs(sb, message.id, memberIds),
  ]);

  return recipientRows.map((row) => ({
    memberId: row.member_id,
    nickname: members.get(row.member_id)?.nickname ?? "",
    deliveryState: row.delivery_state,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    notifiedAt: row.notified_at,
    lastPushStatus: logs.get(row.member_id) ?? null,
  }));
}

async function buildCandidates(
  sb: SupabaseClient,
  recipients: RecipientRow[],
  preloadedMessages?: Map<string, MessageRow>,
  preloadedMembers?: Map<string, MemberRow>,
  excludeActiveChat = true,
): Promise<Candidate[]> {
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
  recipients.forEach((recipient) => {
    const message = messages.get(recipient.message_id);
    const recipientMember = members.get(recipient.member_id);
    const sender = message?.sender_member_id ? members.get(message.sender_member_id) : null;
    if (!message || !recipientMember || !sender) return;
    if (message.deleted_at || message.message_type === "system") return;
    if (message.sender_member_id === recipient.member_id) return;
    if (recipient.delivery_state !== "pending" || recipient.read_at) return;
    if (recipientMember.status !== "active") return;
    if (activeMemberIds.has(recipient.member_id)) return;
    candidates.push({
      familyId: recipient.family_id,
      messageId: recipient.message_id,
      memberId: recipient.member_id,
      message,
      sender,
      recipient: recipientMember,
    });
  });
  return candidates;
}

function collapseCandidatesByMember(candidates: Candidate[]): Candidate[] {
  const byFamilyMember = new Map<string, Candidate>();
  candidates.forEach((candidate) => {
    const key = `${candidate.familyId}:${candidate.memberId}`;
    if (!byFamilyMember.has(key)) byFamilyMember.set(key, candidate);
  });
  return [...byFamilyMember.values()];
}

async function sendCandidates(
  sb: SupabaseClient,
  candidates: Candidate[],
  scanned = candidates.length,
): Promise<PushBatchStats> {
  if (candidates.length === 0) {
    return { ok: true, scanned, sent: 0, gone: 0, failed: 0, skipped: scanned };
  }

  const subscriptions = await fetchSubscriptions(
    sb,
    unique(candidates.map((candidate) => candidate.memberId)),
  );

  let sent = 0;
  let gone = 0;
  let failed = 0;
  let skipped = Math.max(0, scanned - candidates.length);

  await Promise.all(
    candidates.map(async (candidate) => {
      const targets = (subscriptions.get(candidate.memberId) ?? []).filter((sub) =>
        shouldNotify(sub, candidate.message.message_type),
      );
      if (targets.length === 0) {
        skipped += 1;
        return;
      }

      const results = await Promise.all(
        targets.map((sub) =>
          sendOnePush({
            message: candidate.message,
            sender: candidate.sender,
            sub,
          }),
        ),
      );
      const attemptedAt = new Date().toISOString();
      const sentSubs = targets.filter((_, index) => results[index]?.status === "sent");
      const goneSubs = targets.filter((_, index) => results[index]?.status === "gone");
      const failedPairs = targets
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
        await disableSubscriptions(sb, goneSubs.map((sub) => sub.id), attemptedAt);
      }

      await insertDeliveryLogs(
        sb,
        candidate.message,
        [
          ...sentSubs.map((sub) => ({ sub, status: "sent" as const })),
          ...goneSubs.map((sub, index) => ({
            sub,
            status: "gone" as const,
            result: results[targets.indexOf(sub)],
            index,
          })),
          ...failedPairs.map(({ sub, result }) => ({
            sub,
            status: "failed" as const,
            result,
          })),
        ],
        attemptedAt,
      );
    }),
  );

  return { ok: true, scanned, sent, gone, failed, skipped };
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

function shouldNotify(sub: PushSubscriptionRow, messageType: MessageType): boolean {
  if (!sub.enabled) return false;
  if (!sub.messages_enabled) return false;
  if (messageType === "location" && !sub.location_enabled) return false;
  if (messageType === "system") return false;
  return true;
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

async function disableSubscriptions(
  sb: SupabaseClient,
  subscriptionIds: string[],
  updatedAt: string,
): Promise<void> {
  if (subscriptionIds.length === 0) return;
  await sb
    .from("push_subscriptions")
    .update({ enabled: false, updated_at: updatedAt })
    .in("id", subscriptionIds);
}

async function insertDeliveryLogs(
  sb: SupabaseClient,
  message: MessageRow,
  entries: Array<{
    sub: PushSubscriptionRow;
    status: "sent" | "gone" | "failed";
    result?: { errorStatus?: number | null; errorMessage?: string | null };
  }>,
  createdAt: string,
): Promise<void> {
  if (entries.length === 0) return;
  await sb.from("push_delivery_logs").insert(
    entries.map(({ sub, status, result }) => ({
      family_id: message.family_id,
      message_id: message.id,
      subscription_id: sub.id,
      member_id: sub.member_id,
      endpoint: sub.endpoint,
      status,
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
}

async function updateLogStatus(
  sb: SupabaseClient,
  log: PushLogRow,
  input: {
    status: "sent" | "gone" | "failed";
    retryCount: number;
    attemptedAt: string;
    nextRetryAt?: string | null;
    errorStatus?: number | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  await sb
    .from("push_delivery_logs")
    .update({
      status: input.status,
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
      "id, family_id, member_id, endpoint, p256dh, auth, enabled, messages_enabled, location_enabled",
    )
    .eq("enabled", true)
    .in("member_id", unique(memberIds));
  if (error) throw error;
  const byMember = new Map<string, PushSubscriptionRow[]>();
  ((data ?? []) as PushSubscriptionRow[]).forEach((sub) => {
    const list = byMember.get(sub.member_id) ?? [];
    list.push(sub);
    byMember.set(sub.member_id, list);
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
      "id, family_id, member_id, endpoint, p256dh, auth, enabled, messages_enabled, location_enabled",
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

async function fetchLatestLogs(
  sb: SupabaseClient,
  messageId: string,
  memberIds: string[],
): Promise<Map<string, "sent" | "failed" | "gone" | "skipped">> {
  if (memberIds.length === 0) return new Map();
  const { data, error } = await sb
    .from("push_delivery_logs")
    .select("member_id, status, created_at")
    .eq("message_id", messageId)
    .in("member_id", unique(memberIds))
    .order("created_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<string, "sent" | "failed" | "gone" | "skipped">();
  ((data ?? []) as Array<{ member_id: string | null; status: "sent" | "failed" | "gone" | "skipped" }>).forEach((log) => {
    if (log.member_id && !latest.has(log.member_id)) latest.set(log.member_id, log.status);
  });
  return latest;
}

function recipientKey(messageId: string, memberId: string): string {
  return `${messageId}:${memberId}`;
}

function retryDelayMs(retryCount: number): number {
  if (retryCount <= 0) return 2 * 60 * 1000;
  if (retryCount === 1) return 10 * 60 * 1000;
  return 30 * 60 * 1000;
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
