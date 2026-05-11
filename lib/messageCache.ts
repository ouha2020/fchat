"use client";

import type { LocalSession } from "@/lib/authLocal";
import { normalizeMessage } from "@/lib/messageService";
import type { Message } from "@/types/message";

const DB_NAME = "family-chat-cache";
const DB_VERSION = 1;
const MESSAGE_STORE = "messages";
const SYNC_STORE = "sync_state";
const MIN_RETAINED_MESSAGES = 100;
const MAX_RETAINED_MESSAGES = 300;
const OLD_MESSAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface MessageSyncState {
  ownerKey: string;
  familyId: string;
  memberId: string;
  cursorUpdatedAt: string | null;
  cursorId: string | null;
  lastFullRefreshAt: string | null;
  openCount: number;
  isHistoryPartial: boolean;
  updatedAt: string;
}

interface CachedMessageRecord extends Message {
  cacheKey: string;
  ownerKey: string;
}

export interface SyncCursor {
  cursorUpdatedAt: string | null;
  cursorId: string | null;
}

export interface SyncStatePatch extends Partial<SyncCursor> {
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
): Promise<Message[]> {
  const db = await openDb();
  const ownerKey = messageOwnerKey(session);
  const records = await readOwnerMessages(db, ownerKey);
  return records
    .map(recordToMessage)
    .sort(compareCreatedAtAsc)
    .slice(Math.max(0, records.length - limit));
}

export async function getSyncState(session: LocalSession): Promise<MessageSyncState | null> {
  const db = await openDb();
  const tx = db.transaction(SYNC_STORE, "readonly");
  return requestToPromise<MessageSyncState | undefined>(
    tx.objectStore(SYNC_STORE).get(messageOwnerKey(session)),
  ).then((state) => state ?? null);
}

export async function registerCacheOpen(session: LocalSession): Promise<MessageSyncState> {
  const db = await openDb();
  const ownerKey = messageOwnerKey(session);
  let next = defaultSyncState(session);
  await runTransaction(db, [SYNC_STORE], "readwrite", (tx) => {
    const store = tx.objectStore(SYNC_STORE);
    const request = store.get(ownerKey);
    request.onsuccess = () => {
      const existing = request.result as MessageSyncState | undefined;
      next = {
        ...defaultSyncState(session),
        ...existing,
        openCount: (existing?.openCount ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      store.put(next);
    };
  });
  return next;
}

export async function upsertMessagesToCache(
  session: LocalSession,
  messages: Message[],
): Promise<Message[]> {
  return upsertMessagesAndSyncState(session, messages, undefined);
}

export async function upsertMessagesAndSyncState(
  session: LocalSession,
  messages: Message[],
  patch?: SyncStatePatch,
): Promise<Message[]> {
  const db = await openDb();
  const ownerKey = messageOwnerKey(session);
  await runTransaction(db, [MESSAGE_STORE, SYNC_STORE], "readwrite", (tx) => {
    const messageStore = tx.objectStore(MESSAGE_STORE);
    const stateStore = tx.objectStore(SYNC_STORE);

    messages.forEach((message) => {
      const normalized = normalizeMessage(message);
      const record: CachedMessageRecord = {
        ...normalized,
        ownerKey,
        cacheKey: `${ownerKey}:${normalized.id}`,
      };
      messageStore.put(record);
    });

    const prune = () => queuePruneOwnerMessages(messageStore, ownerKey);

    if (patch) {
      const stateRequest = stateStore.get(ownerKey);
      stateRequest.onsuccess = () => {
        const existing = stateRequest.result as MessageSyncState | undefined;
        const next: MessageSyncState = {
          ...defaultSyncState(session),
          ...existing,
          ...patch,
          updatedAt: new Date().toISOString(),
        };
        stateStore.put(next);
        prune();
      };
    } else {
      prune();
    }
  });
  return loadCachedMessages(session);
}

export async function clearMessageCacheForSession(session: LocalSession): Promise<void> {
  const db = await openDb();
  const ownerKey = messageOwnerKey(session);
  await runTransaction(db, [MESSAGE_STORE, SYNC_STORE], "readwrite", (tx) => {
    const messageStore = tx.objectStore(MESSAGE_STORE);
    const request = messageStore.index("ownerKey").getAll(IDBKeyRange.only(ownerKey));
    request.onsuccess = () => {
      (request.result as CachedMessageRecord[]).forEach((record) =>
        messageStore.delete(record.cacheKey),
      );
      tx.objectStore(SYNC_STORE).delete(ownerKey);
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
    lastFullRefreshAt: null,
    openCount: 0,
    isHistoryPartial: false,
    updatedAt: new Date().toISOString(),
  };
}

function recordToMessage(record: CachedMessageRecord): Message {
  const { cacheKey: _cacheKey, ownerKey: _ownerKey, ...message } = record;
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
      request.onerror = () => reject(request.error ?? new Error("indexeddb_open_failed"));
      request.onsuccess = () => resolve(request.result);
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
): void {
  const request = store.index("ownerKey").getAll(IDBKeyRange.only(ownerKey));
  request.onsuccess = () => {
    const records = request.result as CachedMessageRecord[];
    if (records.length <= MAX_RETAINED_MESSAGES) return;

    const cutoff = Date.now() - OLD_MESSAGE_MAX_AGE_MS;
    records
      .sort((a, b) => -compareCreatedAtAsc(a, b))
      .forEach((record, index) => {
        const createdAt = new Date(record.created_at).getTime();
        const keep =
          index < MIN_RETAINED_MESSAGES ||
          (index < MAX_RETAINED_MESSAGES && createdAt >= cutoff);
        if (!keep) store.delete(record.cacheKey);
      });
  };
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
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb_transaction_failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb_transaction_aborted"));
    queue(tx);
  });
}
