import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSyncState, loadCachedMessages, upsertMessagesAndSyncState, upsertMessagesToCache } from "@/lib/messageCache";
import { listMessagesAfterSeq, listMessagesDelta } from "@/lib/messageService";
import { mergeRealtimeMessage, mergeRealtimeMessages, syncMessages } from "@/lib/messageSync";
import { makeMessage, makeSession } from "@/tests/helpers/messages";
import type { MessageSyncState } from "@/lib/messageCache";
import type { Message } from "@/types/message";

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
  vi.stubGlobal("window", { localStorage: {
    getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), removeItem: vi.fn(),
  } });
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
