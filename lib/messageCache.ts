"use client";

import type { LocalSession } from "@/lib/authLocal";
import { normalizeMessage } from "@/lib/messageNormalization";
import type { Message } from "@/types/message";
import { mergeMessagesById } from "@/lib/messageList";
import {
  assertMessageContext, captureMessageCacheContext, currentMessageCacheVersion,
  invalidateMessageCacheContext, isMessageContextCurrent, watchMessageContext,
  type MessageCacheContext,
} from "@/lib/messageCacheLifecycle";

const DB_NAME = "family-chat-cache";
const DB_VERSION = 1;
const MESSAGE_STORE = "messages";
const SYNC_STORE = "sync_state";
const MIN_RETAINED_MESSAGES = 100;
const MAX_RETAINED_MESSAGES = 1000;

export interface MessageSyncState {
  cacheVersion?: string;
  ownerKey: string;
  familyId: string;
  memberId: string;
  cursorUpdatedAt: string | null;
  cursorId: string | null;
  lastSyncedSeq: number | null;
  lastFullRefreshAt: string | null;
  openCount: number;
  isHistoryPartial: boolean;
  updatedAt: string;
}

interface CachedMessageRecord extends Message {
  cacheVersion: string;
  cacheKey: string;
  ownerKey: string;
}

export interface SyncCursor {
  cursorUpdatedAt: string | null;
  cursorId: string | null;
}

export interface SyncStatePatch extends Partial<SyncCursor> {
  lastSyncedSeq?: number | null;
  lastFullRefreshAt?: string | null;
  openCount?: number;
  isHistoryPartial?: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function messageOwnerKey(session: Pick<LocalSession, "family_id" | "member_id">): string {
  return `${session.family_id}:${session.member_id}`;
}

export async function loadCachedMessages(
  session: LocalSession,
  limit = MIN_RETAINED_MESSAGES,
  context = captureMessageCacheContext(session),
): Promise<Message[]> {
  assertMessageContext(context);
  if (!context.version) return [];
  const db = await openDb();
  assertMessageContext(context);
  const ownerKey = messageOwnerKey(session);
  const records = await readOwnerMessages(db, ownerKey);
  assertMessageContext(context);
  const current = records.filter((record) => record.cacheVersion === context.version);
  return current
    .map(recordToMessage)
    .sort(compareCreatedAtAsc)
    .slice(Math.max(0, current.length - limit));
}

export async function getSyncState(session: LocalSession, context = captureMessageCacheContext(session)): Promise<MessageSyncState | null> {
  assertMessageContext(context);
  if (!context.version) return null;
  const db = await openDb();
  assertMessageContext(context);
  const tx = db.transaction(SYNC_STORE, "readonly");
  const state = await requestToPromise<MessageSyncState | undefined>(
    tx.objectStore(SYNC_STORE).get(messageOwnerKey(session)),
  );
  assertMessageContext(context);
  return state?.cacheVersion === context.version ? state : null;
}

export async function registerCacheOpen(session: LocalSession, context = captureMessageCacheContext(session)): Promise<MessageSyncState> {
  assertMessageContext(context);
  if (!context.version) return defaultSyncState(session);
  const db = await openDb();
  assertMessageContext(context);
  const ownerKey = messageOwnerKey(session);
  let next = defaultSyncState(session);
  await runTransaction(db, [SYNC_STORE], "readwrite", (tx) => {
    const store = tx.objectStore(SYNC_STORE);
    const request = store.get(ownerKey);
    request.onsuccess = () => {
      if (!guardTransaction(tx, context)) return;
      const raw = request.result as MessageSyncState | undefined;
      const existing = raw?.cacheVersion === context.version ? raw : undefined;
      next = {
        ...defaultSyncState(session),
        ...existing,
        cacheVersion: context.version!,
        openCount: (existing?.openCount ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      store.put(next);
    };
  }, context);
  return next;
}

export async function upsertMessagesToCache(
  session: LocalSession,
  messages: Message[],
  context = captureMessageCacheContext(session),
): Promise<Message[]> {
  return upsertMessagesAndSyncState(session, messages, undefined, context);
}

export async function upsertMessagesAndSyncState(
  session: LocalSession,
  messages: Message[],
  patch?: SyncStatePatch,
  context = captureMessageCacheContext(session),
): Promise<Message[]> {
  assertMessageContext(context);
  if (!context.version) return [];
  const db = await openDb();
  assertMessageContext(context);
  const ownerKey = messageOwnerKey(session);
  await runTransaction(db, [MESSAGE_STORE, SYNC_STORE], "readwrite", (tx) => {
    const messageStore = tx.objectStore(MESSAGE_STORE);
    const stateStore = tx.objectStore(SYNC_STORE);

    const finishWrites = () => {
      const prune = () => queuePruneOwnerMessages(messageStore, ownerKey, tx, context);
      if (!patch) { prune(); return; }
      const stateRequest = stateStore.get(ownerKey);
      stateRequest.onsuccess = () => {
        if (!guardTransaction(tx, context)) return;
        const raw = stateRequest.result as MessageSyncState | undefined;
        const existing = raw?.cacheVersion === context.version ? raw : undefined;
        const patchedLastSyncedSeq =
          patch.lastSyncedSeq === undefined
            ? existing?.lastSyncedSeq ?? null
            : maxSeq(existing?.lastSyncedSeq ?? null, patch.lastSyncedSeq);
        const next: MessageSyncState = {
          ...defaultSyncState(session),
          ...existing,
          ...patch,
          cacheVersion: context.version!,
          lastSyncedSeq: patchedLastSyncedSeq,
          updatedAt: new Date().toISOString(),
        };
        stateStore.put(next);
        prune();
      };
    };
    let pending = messages.length;
    if (!pending) finishWrites();
    messages.forEach((message) => {
      const normalized = normalizeMessage(message);
      const cacheKey = `${ownerKey}:${normalized.id}`;
      const request = messageStore.get(cacheKey);
      request.onsuccess = () => {
        if (!guardTransaction(tx, context)) return;
        const current = request.result as CachedMessageRecord | undefined;
        const merged = current?.cacheVersion === context.version
          ? mergeMessagesById([current], [normalized])[0] : normalized;
        const { local_preview_url: _preview, upload_status: _status, upload_progress: _progress, ...persisted } = merged;
        messageStore.put({ ...persisted, ownerKey, cacheKey, cacheVersion: context.version! } satisfies CachedMessageRecord);
        pending -= 1;
        if (!pending) finishWrites();
      };
    });
  }, context);
  return loadCachedMessages(session, MIN_RETAINED_MESSAGES, context);
}

export async function clearMessageCacheForSession(session: LocalSession, alreadyInvalidated = false): Promise<void> {
  if (!alreadyInvalidated) invalidateMessageCacheContext(session);
  const db = await openDb();
  const ownerKey = messageOwnerKey(session);
  await runTransaction(db, [MESSAGE_STORE, SYNC_STORE], "readwrite", (tx) => {
    const messageStore = tx.objectStore(MESSAGE_STORE);
    const request = messageStore.index("ownerKey").getAll(IDBKeyRange.only(ownerKey));
    request.onsuccess = () => {
      const version = currentMessageCacheVersion(session);
      (request.result as CachedMessageRecord[]).forEach((record) =>
        { if (!version || record.cacheVersion !== version) messageStore.delete(record.cacheKey); },
      );
      const stateStore = tx.objectStore(SYNC_STORE);
      const stateRequest = stateStore.get(ownerKey);
      stateRequest.onsuccess = () => {
        const state = stateRequest.result as MessageSyncState | undefined;
        if (state && state.cacheVersion !== currentMessageCacheVersion(session)) stateStore.delete(ownerKey);
      };
    };
  });
}

export function cursorFromMessages(messages: Message[]): SyncCursor {
  const latest = [...messages].map(normalizeMessage).sort(compareUpdatedCursorAsc).at(-1);
  return {
    cursorUpdatedAt: latest?.updated_at ?? null,
    cursorId: latest?.id ?? null,
  };
}

export function seqFromMessages(messages: Message[]): number | null {
  return messages.reduce<number | null>((latest, message) => {
    const normalized = normalizeMessage(message);
    return maxSeq(latest, normalized.family_seq);
  }, null);
}

export function compareCreatedAtAsc(a: Message, b: Message): number {
  const byTime = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  return byTime || a.id.localeCompare(b.id);
}

export function compareUpdatedCursorAsc(a: Message, b: Message): number {
  const left = normalizeMessage(a);
  const right = normalizeMessage(b);
  const byTime =
    new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
  return byTime || left.id.localeCompare(right.id);
}

function defaultSyncState(session: LocalSession): MessageSyncState {
  return {
    ownerKey: messageOwnerKey(session),
    familyId: session.family_id,
    memberId: session.member_id,
    cursorUpdatedAt: null,
    cursorId: null,
    lastSyncedSeq: null,
    lastFullRefreshAt: null,
    openCount: 0,
    isHistoryPartial: false,
    updatedAt: new Date().toISOString(),
  };
}

function recordToMessage(record: CachedMessageRecord): Message {
  const { cacheKey: _cacheKey, ownerKey: _ownerKey, cacheVersion: _version, ...message } = record;
  return normalizeMessage(message);
}

async function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("indexeddb_unavailable");
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MESSAGE_STORE)) {
          const store = db.createObjectStore(MESSAGE_STORE, { keyPath: "cacheKey" });
          store.createIndex("ownerKey", "ownerKey", { unique: false });
          store.createIndex("ownerCreatedAt", ["ownerKey", "created_at"], {
            unique: false,
          });
        }
        if (!db.objectStoreNames.contains(SYNC_STORE)) {
          db.createObjectStore(SYNC_STORE, { keyPath: "ownerKey" });
        }
      };
      request.onerror = () => { dbPromise = null; reject(request.error ?? new Error("indexeddb_open_failed")); };
      request.onblocked = () => { dbPromise = null; reject(new Error("indexeddb_open_blocked")); };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
        resolve(request.result);
      };
    });
  }
  return dbPromise;
}

async function readOwnerMessages(
  db: IDBDatabase,
  ownerKey: string,
): Promise<CachedMessageRecord[]> {
  const tx = db.transaction(MESSAGE_STORE, "readonly");
  return readOwnerMessagesFromStore(tx.objectStore(MESSAGE_STORE), ownerKey);
}

async function readOwnerMessagesFromStore(
  store: IDBObjectStore,
  ownerKey: string,
): Promise<CachedMessageRecord[]> {
  const index = store.index("ownerKey");
  const range = IDBKeyRange.only(ownerKey);
  return requestToPromise<CachedMessageRecord[]>(index.getAll(range));
}

function queuePruneOwnerMessages(
  store: IDBObjectStore,
  ownerKey: string,
  tx: IDBTransaction,
  context: MessageCacheContext,
): void {
  const request = store.index("ownerKey").getAll(IDBKeyRange.only(ownerKey));
  request.onsuccess = () => {
    if (!guardTransaction(tx, context)) return;
    const records = (request.result as CachedMessageRecord[]).filter((record) => {
      if (record.cacheVersion === context.version) return true;
      store.delete(record.cacheKey);
      return false;
    });
    if (records.length <= MAX_RETAINED_MESSAGES) return;

    records
      .sort((a, b) => -compareCreatedAtAsc(a, b))
      .forEach((record, index) => {
        if (index >= MAX_RETAINED_MESSAGES) store.delete(record.cacheKey);
      });
  };
}

function maxSeq(left: number | null, right: number | null): number | null {
  if (typeof left !== "number") return typeof right === "number" ? right : null;
  if (typeof right !== "number") return left;
  return Math.max(left, right);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb_request_failed"));
  });
}

function runTransaction(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  queue: (tx: IDBTransaction) => void,
  context?: MessageCacheContext,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (context) assertMessageContext(context);
    const tx = db.transaction(stores, mode);
    const unwatch = context ? watchMessageContext(context, () => { try { tx.abort(); } catch { /* already settled */ } }) : () => {};
    tx.oncomplete = () => { unwatch(); if (context && !isMessageContextCurrent(context)) reject(new Error("message_operation_cancelled")); else resolve(); };
    tx.onerror = () => { unwatch(); reject(tx.error ?? new Error("indexeddb_transaction_failed")); };
    tx.onabort = () => { unwatch(); reject(new Error(context && !isMessageContextCurrent(context) ? "message_operation_cancelled" : "indexeddb_transaction_aborted")); };
    try { queue(tx); } catch (error) { unwatch(); tx.abort(); reject(error); }
  });
}

function guardTransaction(tx: IDBTransaction, context: MessageCacheContext): boolean {
  if (isMessageContextCurrent(context)) return true;
  try { tx.abort(); } catch { /* An invalidation listener may already have aborted it. */ }
  return false;
}
