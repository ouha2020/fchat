import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSyncState, loadCachedMessages, upsertMessagesAndSyncState, upsertMessagesToCache } from "@/lib/messageCache";
import { listMessagesAfterSeq, listMessagesDelta } from "@/lib/messageService";
import { mergeRealtimeMessage, mergeRealtimeMessages, syncMessages } from "@/lib/messageSync";
import { makeMessage, makeSession } from "@/tests/helpers/messages";
import type { MessageSyncState } from "@/lib/messageCache";
import type { Message } from "@/types/message";
import { installLocalSession } from "@/tests/helpers/localSession";
import { invalidateMessageCacheContext, captureMessageCacheContext } from "@/lib/messageCacheLifecycle";

vi.mock("@/lib/messageCache", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/messageCache")>(),
  getSyncState: vi.fn(),
  loadCachedMessages: vi.fn(),
  upsertMessagesAndSyncState: vi.fn(),
  upsertMessagesToCache: vi.fn(),
}));
vi.mock("@/lib/messageService", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/messageService")>(),
  listMessagesAfterSeq: vi.fn(),
  listMessagesDelta: vi.fn(),
}));

const session = makeSession();
let state: MessageSyncState;
let cached: Map<string, Message>;
const missing = makeMessage({ id: "missing", family_seq: 2, updated_at: "2026-07-01T00:00:02.000Z" });
const notified = makeMessage({ id: "notified", family_seq: 3, updated_at: "2026-07-01T00:00:03.000Z" });

beforeEach(() => {
  vi.resetAllMocks();
  installLocalSession(session);
  state = {
    ownerKey: "f1:alice", familyId: "f1", memberId: "alice",
    cursorUpdatedAt: new Date().toISOString(), cursorId: "baseline",
    lastSyncedSeq: 1, lastFullRefreshAt: new Date().toISOString(),
    openCount: 0, isHistoryPartial: true, updatedAt: new Date().toISOString(),
  };
  cached = new Map();
  vi.mocked(getSyncState).mockImplementation(async () => ({ ...state }));
  vi.mocked(loadCachedMessages).mockImplementation(async () => [...cached.values()]);
  const saveRows = async (_session: unknown, rows: Message[]) => {
    rows.forEach((row) => cached.set(row.id, row));
    return [...cached.values()];
  };
  vi.mocked(upsertMessagesToCache).mockImplementation(saveRows);
  vi.mocked(upsertMessagesAndSyncState).mockImplementation(async (active, rows, patch) => {
    Object.assign(state, patch);
    return saveRows(active, rows);
  });
  vi.mocked(listMessagesAfterSeq).mockImplementation(async (_active, seq) =>
    [missing, notified].filter((row) => row.family_seq! > seq),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("targeted message fetches preserve the recovery checkpoint", () => {
  it("discards a late seq page after logout without persisting, emitting, or falling back", async () => {
    let finish!: (rows: Message[]) => void;
    const onMessages = vi.fn();
    const arrived = new Promise<void>((resolve) => vi.mocked(listMessagesAfterSeq).mockImplementation(() => {
      resolve(); return new Promise((done) => { finish = done; });
    }));
    const result = syncMessages(session, { onMessages }); await arrived;
    invalidateMessageCacheContext(session); window.localStorage.removeItem("family-chat:session");
    finish([missing]);
    await expect(result).resolves.toEqual({ status: "cancelled", messages: [] });
    expect(upsertMessagesAndSyncState).not.toHaveBeenCalled();
    expect(onMessages).not.toHaveBeenCalled(); expect(listMessagesDelta).not.toHaveBeenCalled();
  });

  it("keeps a newer owner's synchronization lock when the old request finishes", async () => {
    let finish!: (rows: Message[]) => void;
    const arrived = new Promise<void>((resolve) => vi.mocked(listMessagesAfterSeq).mockImplementation(() => {
      resolve(); return new Promise((done) => { finish = done; });
    }));
    const result = syncMessages(session); await arrived;
    const key = `sync_lock:${session.family_id}:${session.member_id}`;
    const replacement = JSON.stringify({ id: "new-operation", version: captureMessageCacheContext(session).version,
      expiresAt: Date.now() + 15000 });
    window.localStorage.setItem(key, replacement); finish([]); await result;
    expect(window.localStorage.getItem(key)).toBe(replacement);
  });

  it("does not emit if the identity expires between cache completion and the UI callback", async () => {
    vi.mocked(upsertMessagesAndSyncState).mockImplementation(async (_active, rows) => {
      queueMicrotask(() => queueMicrotask(() => invalidateMessageCacheContext(session)));
      return rows;
    });
    const onMessages = vi.fn();
    await expect(syncMessages(session, { onMessages })).resolves.toEqual({ status: "cancelled", messages: [] });
    expect(onMessages).not.toHaveBeenCalled(); expect(listMessagesDelta).not.toHaveBeenCalled();
  });

  it("keeps RPC data available when the persistent cache fails", async () => {
    vi.mocked(upsertMessagesAndSyncState).mockRejectedValue(new Error("indexeddb_unavailable"));
    const onMessages = vi.fn(); const result = await syncMessages(session, { onMessages });
    expect(result.status).toBe("synced"); expect(result.messages.map((row) => row.id)).toContain("missing");
    expect(onMessages).toHaveBeenCalled();
  });
  it.each(["single", "batch"])("recovers a gap after a %s realtime fetch arrives first", async (mode) => {
    if (mode === "single") await mergeRealtimeMessage(session, notified);
    else await mergeRealtimeMessages(session, [notified]);

    const result = await syncMessages(session);
    expect(listMessagesAfterSeq).toHaveBeenCalledWith(session, 1, 300);
    expect(result.status).toBe("synced");
    expect(result.messages.map((row) => row.id)).toContain("missing");
    expect(state.lastSyncedSeq).toBe(3);
  });

  it("preserves the timestamp checkpoint for the legacy delta fallback", async () => {
    state.lastSyncedSeq = null;
    const previousCursor = state.cursorUpdatedAt;
    vi.mocked(listMessagesDelta).mockResolvedValue([missing, notified]);
    await mergeRealtimeMessage(session, notified);
    await syncMessages(session);
    expect(listMessagesDelta).toHaveBeenCalledWith(session, previousCursor, "baseline", 300);
  });
});
