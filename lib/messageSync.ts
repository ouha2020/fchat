"use client";

import type { LocalSession } from "@/lib/authLocal";
import {
  compareCreatedAtAsc,
  cursorFromMessages,
  getSyncState,
  loadCachedMessages,
  registerCacheOpen,
  seqFromMessages,
  upsertMessagesAndSyncState,
  upsertMessagesToCache,
} from "@/lib/messageCache";
import {
  listMessages,
  listMessagesAfterSeq,
  listMessagesDelta,
} from "@/lib/messageService";
import type { Message } from "@/types/message";
import { mergeMessagesById } from "@/lib/messageList";
import { assertMessageContext, captureMessageCacheContext, isMessageContextCurrent, type MessageCacheContext } from "@/lib/messageCacheLifecycle";

const FULL_REFRESH_LIMIT = 100;
const DELTA_LIMIT = 300;
const MAX_DELTA_PAGES = 5;
const LOCK_TTL_MS = 15_000;
const LOCK_RETRY_DELAYS_MS = [140, 360, 720] as const;
const FULL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STALE_CURSOR_MS = 7 * 24 * 60 * 60 * 1000;
const FULL_REFRESH_OPEN_COUNT = 10;

interface SyncOptions {
  forceFullRefresh?: boolean;
  onMessages?: (messages: Message[]) => void;
}

export interface MessageSyncResult {
  status: "synced" | "locked" | "failed" | "cancelled";
  messages: Message[];
  isHistoryPartial?: boolean;
}

export async function loadCachedMessagesForSession(
  session: LocalSession,
  limit = FULL_REFRESH_LIMIT,
  context = captureMessageCacheContext(session),
): Promise<Message[]> {
  return loadCachedMessages(session, limit, context);
}

export async function syncMessages(
  session: LocalSession,
  options: SyncOptions = {},
): Promise<MessageSyncResult> {
  const context = captureMessageCacheContext(session);
  if (!isMessageContextCurrent(context)) return { status: "cancelled", messages: [] };
  const cached = await loadCachedMessagesForSession(session, FULL_REFRESH_LIMIT, context).catch(() => []);
  if (!isMessageContextCurrent(context)) return { status: "cancelled", messages: [] };
  let lock = acquireSyncLock(session, context);
  for (const delayMs of LOCK_RETRY_DELAYS_MS) {
    if (lock) break;
    await sleep(delayMs);
    if (!isMessageContextCurrent(context)) return { status: "cancelled", messages: [] };
    lock = acquireSyncLock(session, context);
  }
  if (!lock) {
    return { status: "locked", messages: cached };
  }

  try {
    const state = await getSyncState(session, context).catch(() => null);
    assertMessageContext(context);
    const shouldFullRefresh =
      options.forceFullRefresh ||
      !state?.cursorUpdatedAt ||
      !state.cursorId ||
      !state.lastFullRefreshAt ||
      state.openCount >= FULL_REFRESH_OPEN_COUNT ||
      Date.now() - new Date(state.lastFullRefreshAt).getTime() >
        FULL_REFRESH_INTERVAL_MS ||
      Date.now() - new Date(state.cursorUpdatedAt).getTime() > STALE_CURSOR_MS;

    const result = shouldFullRefresh
      ? await runFullRefresh(session, true, context, options.onMessages)
      : await runDeltaSync(session, context, options.onMessages);
    return result;
  } catch {
    if (!isMessageContextCurrent(context)) return { status: "cancelled", messages: [] };
    return { status: "failed", messages: cached };
  } finally {
    releaseSyncLock(session, lock);
  }
}

export async function noteMessageCacheOpen(session: LocalSession): Promise<void> {
  await registerCacheOpen(session);
}

export async function forceRefreshMessages(
  session: LocalSession,
  onMessages?: (messages: Message[]) => void,
): Promise<MessageSyncResult> {
  return syncMessages(session, { forceFullRefresh: true, onMessages });
}

export async function mergeRealtimeMessage(
  session: LocalSession,
  message: Message,
  context = captureMessageCacheContext(session),
): Promise<Message[]> {
  // A targeted fetch can arrive ahead of missing rows. Only an ordered sync
  // page may advance the checkpoint used to recover those rows.
  assertMessageContext(context);
  const messages = await upsertMessagesToCache(session, [message], context).catch(() => {
    assertMessageContext(context);
    return [message];
  });
  assertMessageContext(context);
  return mergeMessagesById(messages, [message]);
}

export async function mergeRealtimeMessages(
  session: LocalSession,
  incoming: Message[],
  context = captureMessageCacheContext(session),
): Promise<Message[]> {
  assertMessageContext(context);
  if (incoming.length === 0) {
    return loadCachedMessagesForSession(session, FULL_REFRESH_LIMIT, context);
  }
  const messages = await upsertMessagesToCache(session, incoming, context).catch(() => {
    assertMessageContext(context);
    return incoming;
  });
  assertMessageContext(context);
  return mergeMessagesById(messages, incoming);
}

async function runDeltaSync(
  session: LocalSession,
  context: MessageCacheContext,
  onMessages?: (messages: Message[]) => void,
): Promise<MessageSyncResult> {
  let state = await getSyncState(session, context).catch(() => null);
  assertMessageContext(context);
  if (!state?.cursorUpdatedAt || !state.cursorId) {
    return runFullRefresh(session, true, context, onMessages);
  }
  if (typeof state.lastSyncedSeq === "number") {
    try {
      return await runSeqSync(session, state.lastSyncedSeq, context, onMessages);
    } catch {
      assertMessageContext(context);
      // Keep the pre-seq cursor path as a deploy-drift fallback.
    }
  }

  let pages = 0;
  let didHitPageLimit = false;
  let latestMessages = await loadCachedMessagesForSession(session, FULL_REFRESH_LIMIT, context).catch(() => []);

  try {
    while (pages < MAX_DELTA_PAGES) {
      assertMessageContext(context);
      const rows = await listMessagesDelta(
        session,
        state.cursorUpdatedAt,
        state.cursorId,
        DELTA_LIMIT,
      );
      assertMessageContext(context);
      if (rows.length === 0) break;

      const cursor = cursorFromMessages(rows);
      latestMessages = await persistSyncPage(session, rows, {
        ...cursor,
        lastSyncedSeq: seqFromMessages(rows),
      }, context, latestMessages);
      assertMessageContext(context);
      latestMessages = latestMessages.sort(compareCreatedAtAsc);
      onMessages?.(latestMessages);

      state = {
        ...state,
        cursorUpdatedAt: cursor.cursorUpdatedAt,
        cursorId: cursor.cursorId,
        lastSyncedSeq: seqFromMessages(rows) ?? state.lastSyncedSeq,
      };
      pages += 1;
      if (rows.length < DELTA_LIMIT) break;
      if (pages >= MAX_DELTA_PAGES) didHitPageLimit = true;
    }
  } catch {
    assertMessageContext(context);
    // Delta RPC can be temporarily unavailable during deploy/migration drift.
    // Fall back to the existing recent-window refresh so users still see chat.
    return runFullRefresh(session, true, context, onMessages);
  }

  if (didHitPageLimit) {
    return runFullRefresh(session, true, context, onMessages);
  }

  assertMessageContext(context);
  if (latestMessages.length > 0) onMessages?.(latestMessages);
  return { status: "synced", messages: latestMessages };
}

async function runSeqSync(
  session: LocalSession,
  afterSeq: number,
  context: MessageCacheContext,
  onMessages?: (messages: Message[]) => void,
): Promise<MessageSyncResult> {
  let currentSeq = afterSeq;
  let pages = 0;
  let didHitPageLimit = false;
  let latestMessages = await loadCachedMessagesForSession(session, FULL_REFRESH_LIMIT, context).catch(() => []);

  while (pages < MAX_DELTA_PAGES) {
    assertMessageContext(context);
    const rows = await listMessagesAfterSeq(session, currentSeq, DELTA_LIMIT);
    assertMessageContext(context);
    if (rows.length === 0) break;

    const cursor = cursorFromMessages(rows);
    const latestSeq = seqFromMessages(rows);
    latestMessages = await persistSyncPage(session, rows, {
      ...cursor,
      lastSyncedSeq: latestSeq,
    }, context, latestMessages);
    assertMessageContext(context);
    latestMessages = latestMessages.sort(compareCreatedAtAsc);
    onMessages?.(latestMessages);

    if (typeof latestSeq === "number") currentSeq = Math.max(currentSeq, latestSeq);
    pages += 1;
    if (rows.length < DELTA_LIMIT) break;
    if (pages >= MAX_DELTA_PAGES) didHitPageLimit = true;
  }

  if (didHitPageLimit) {
    return runFullRefresh(session, true, context, onMessages);
  }

  assertMessageContext(context);
  if (latestMessages.length > 0) onMessages?.(latestMessages);
  return { status: "synced", messages: latestMessages };
}

async function runFullRefresh(
  session: LocalSession,
  isHistoryPartial: boolean,
  context: MessageCacheContext,
  onMessages?: (messages: Message[]) => void,
): Promise<MessageSyncResult> {
  assertMessageContext(context);
  const rows = await listMessages(session, FULL_REFRESH_LIMIT);
  assertMessageContext(context);
  const cursor = cursorFromMessages(rows);
  const latestSeq = seqFromMessages(rows);
  const messages = await persistSyncPage(session, rows, {
    ...cursor,
    lastSyncedSeq: latestSeq,
    lastFullRefreshAt: new Date().toISOString(),
    openCount: 0,
    isHistoryPartial,
  }, context, []);
  assertMessageContext(context);
  const sorted = messages.sort(compareCreatedAtAsc);
  onMessages?.(sorted);
  return { status: "synced", messages: sorted, isHistoryPartial };
}

function syncLockKey(session: LocalSession): string {
  return `sync_lock:${session.family_id}:${session.member_id}`;
}

function acquireSyncLock(session: LocalSession, context: MessageCacheContext): string | null {
  if (!isMessageContextCurrent(context)) return null;
  const id = crypto.randomUUID();
  const key = syncLockKey(session);
  const now = Date.now();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as { expiresAt?: number; version?: string };
      if (parsed.expiresAt && parsed.expiresAt > now && parsed.version === context.version) return null;
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({
        id,
        version: context.version,
        expiresAt: now + LOCK_TTL_MS,
      }),
    );
    return id;
  } catch {
    return id;
  }
}

function releaseSyncLock(session: LocalSession, id: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = syncLockKey(session);
    const raw = window.localStorage.getItem(key);
    if (raw && JSON.parse(raw).id === id) window.localStorage.removeItem(key);
  } catch {
    // Best effort only.
  }
}

async function persistSyncPage(
  session: LocalSession, rows: Message[], patch: Parameters<typeof upsertMessagesAndSyncState>[2],
  context: MessageCacheContext, previous: Message[],
): Promise<Message[]> {
  const cached = await upsertMessagesAndSyncState(session, rows, patch, context).catch(() => []);
  assertMessageContext(context);
  return mergeMessagesById(cached.length ? cached : previous, rows);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
