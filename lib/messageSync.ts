"use client";

import type { LocalSession } from "@/lib/authLocal";
import {
  compareCreatedAtAsc,
  cursorFromMessages,
  getSyncState,
  loadCachedMessages,
  registerCacheOpen,
  upsertMessagesAndSyncState,
  upsertMessagesToCache,
} from "@/lib/messageCache";
import { listMessages, listMessagesDelta } from "@/lib/messageService";
import type { Message } from "@/types/message";

const FULL_REFRESH_LIMIT = 100;
const DELTA_LIMIT = 300;
const MAX_DELTA_PAGES = 5;
const LOCK_TTL_MS = 15_000;
const FULL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STALE_CURSOR_MS = 7 * 24 * 60 * 60 * 1000;
const FULL_REFRESH_OPEN_COUNT = 10;

interface SyncOptions {
  forceFullRefresh?: boolean;
  onMessages?: (messages: Message[]) => void;
}

export interface MessageSyncResult {
  status: "synced" | "locked" | "failed";
  messages: Message[];
  isHistoryPartial?: boolean;
}

export async function loadCachedMessagesForSession(
  session: LocalSession,
): Promise<Message[]> {
  return loadCachedMessages(session, FULL_REFRESH_LIMIT);
}

export async function syncMessages(
  session: LocalSession,
  options: SyncOptions = {},
): Promise<MessageSyncResult> {
  const locked = !acquireSyncLock(session);
  const cached = await loadCachedMessagesForSession(session).catch(() => []);
  if (locked) {
    return { status: "locked", messages: cached };
  }

  try {
    const state = await getSyncState(session);
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
      ? await runFullRefresh(session, true, options.onMessages)
      : await runDeltaSync(session, options.onMessages);
    return result;
  } catch {
    return { status: "failed", messages: cached };
  } finally {
    releaseSyncLock(session);
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
): Promise<Message[]> {
  const messages = await upsertMessagesToCache(session, [message]);
  return messages.sort(compareCreatedAtAsc);
}

async function runDeltaSync(
  session: LocalSession,
  onMessages?: (messages: Message[]) => void,
): Promise<MessageSyncResult> {
  let state = await getSyncState(session);
  if (!state?.cursorUpdatedAt || !state.cursorId) {
    return runFullRefresh(session, true, onMessages);
  }

  let pages = 0;
  let didHitPageLimit = false;
  let latestMessages = await loadCachedMessagesForSession(session);

  try {
    while (pages < MAX_DELTA_PAGES) {
      const rows = await listMessagesDelta(
        session,
        state.cursorUpdatedAt,
        state.cursorId,
        DELTA_LIMIT,
      );
      if (rows.length === 0) break;

      const cursor = cursorFromMessages(rows);
      latestMessages = await upsertMessagesAndSyncState(session, rows, cursor);
      latestMessages = latestMessages.sort(compareCreatedAtAsc);
      onMessages?.(latestMessages);

      state = {
        ...state,
        cursorUpdatedAt: cursor.cursorUpdatedAt,
        cursorId: cursor.cursorId,
      };
      pages += 1;
      if (rows.length < DELTA_LIMIT) break;
      if (pages >= MAX_DELTA_PAGES) didHitPageLimit = true;
    }
  } catch {
    // Delta RPC can be temporarily unavailable during deploy/migration drift.
    // Fall back to the existing recent-window refresh so users still see chat.
    return runFullRefresh(session, true, onMessages);
  }

  if (didHitPageLimit) {
    return runFullRefresh(session, true, onMessages);
  }

  if (latestMessages.length > 0) onMessages?.(latestMessages);
  return { status: "synced", messages: latestMessages };
}

async function runFullRefresh(
  session: LocalSession,
  isHistoryPartial: boolean,
  onMessages?: (messages: Message[]) => void,
): Promise<MessageSyncResult> {
  const rows = await listMessages(session, FULL_REFRESH_LIMIT);
  const cursor = cursorFromMessages(rows);
  const messages = await upsertMessagesAndSyncState(session, rows, {
    ...cursor,
    lastFullRefreshAt: new Date().toISOString(),
    openCount: 0,
    isHistoryPartial,
  });
  const sorted = messages.sort(compareCreatedAtAsc);
  onMessages?.(sorted);
  return { status: "synced", messages: sorted, isHistoryPartial };
}

function syncLockKey(session: LocalSession): string {
  return `sync_lock:${session.family_id}:${session.member_id}`;
}

function acquireSyncLock(session: LocalSession): boolean {
  if (typeof window === "undefined") return false;
  const key = syncLockKey(session);
  const now = Date.now();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as { expiresAt?: number };
      if (parsed.expiresAt && parsed.expiresAt > now) return false;
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({
        id: crypto.randomUUID(),
        expiresAt: now + LOCK_TTL_MS,
      }),
    );
    return true;
  } catch {
    return true;
  }
}

function releaseSyncLock(session: LocalSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(syncLockKey(session));
  } catch {
    // Best effort only.
  }
}
