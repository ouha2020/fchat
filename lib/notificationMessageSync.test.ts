import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMessageById } from "@/lib/messageService";
import { mergeRealtimeMessage } from "@/lib/messageSync";
import { createNotificationMessageLoader } from "@/lib/notificationMessageSync";
import { makeMessage, makeSession } from "@/tests/helpers/messages";
import type { LocalSession } from "@/lib/authLocal";
import type { Message } from "@/types/message";
import { installLocalSession } from "@/tests/helpers/localSession";
import { invalidateMessageCacheContext } from "@/lib/messageCacheLifecycle";

vi.mock("@/lib/messageService", () => ({ getMessageById: vi.fn() }));
vi.mock("@/lib/messageSync", () => ({ mergeRealtimeMessage: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  installLocalSession(makeSession());
  vi.mocked(mergeRealtimeMessage).mockResolvedValue([]);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup() {
  let session: LocalSession | null = makeSession();
  const onMessage = vi.fn();
  const load = createNotificationMessageLoader({
    getSession: () => session,
    onMessage,
  });
  return { load, onMessage, setSession: (next: LocalSession | null) => {
    session = next;
    if (next) window.localStorage.setItem("family-chat:session", JSON.stringify(next));
    else window.localStorage.removeItem("family-chat:session");
  } };
}

describe("notification message recovery", () => {
  it("starts fresh recovery after logout/relogin and discards the earlier response", async () => {
    let finish!: (message: Message) => void;
    const message = makeMessage({ id: "same-identity-target" });
    vi.mocked(getMessageById).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(message);
    const { load, onMessage, setSession } = setup();
    const earlier = load(message.id);
    invalidateMessageCacheContext(makeSession()); setSession(null); setSession(makeSession());
    const current = load(message.id); expect(current).not.toBe(earlier);
    await expect(current).resolves.toBe(true); finish(message);
    await expect(earlier).resolves.toBe(false);
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(message);
  });
  it("retries a temporary miss and a network error before the polling interval", async () => {
    const message = makeMessage({ id: "notification" });
    vi.mocked(getMessageById)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("waking connection"))
      .mockResolvedValueOnce(message);
    const { load, onMessage } = setup();
    const result = load(message.id);
    await vi.advanceTimersByTimeAsync(1600);
    await expect(result).resolves.toBe(true);
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(message);
    expect(getMessageById).toHaveBeenCalledTimes(3);
  });

  it("shares an in-flight fetch for duplicate wake-up events", async () => {
    const message = makeMessage({ id: "notification" });
    vi.mocked(getMessageById).mockResolvedValue(message);
    const { load, onMessage } = setup();
    const first = load(message.id);
    expect(load(message.id)).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(getMessageById).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledOnce();
  });

  it("renders immediately when the cache write is still pending", async () => {
    const message = makeMessage({ id: "old-target" });
    vi.mocked(getMessageById).mockResolvedValue(message);
    vi.mocked(mergeRealtimeMessage).mockReturnValue(new Promise(() => {}));
    const { load, onMessage } = setup();
    await expect(load(message.id)).resolves.toBe(true);
    expect(onMessage).toHaveBeenCalledWith(message);
  });

  it("keeps the message visible when IndexedDB is unavailable", async () => {
    const message = makeMessage({ id: "notification" });
    vi.mocked(getMessageById).mockResolvedValue(message);
    vi.mocked(mergeRealtimeMessage).mockRejectedValue(new Error("indexeddb_unavailable"));
    const { load, onMessage } = setup();
    await expect(load(message.id)).resolves.toBe(true);
    expect(onMessage).toHaveBeenCalledWith(message);
  });

  it("bounds a hung request and ignores its late response", async () => {
    let finishFirst!: (message: Message) => void;
    const latest = makeMessage({ id: "notification", content: "current" });
    vi.mocked(getMessageById)
      .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(latest);
    const { load, onMessage } = setup();
    const result = load(latest.id);
    await vi.advanceTimersByTimeAsync(3400);
    await expect(result).resolves.toBe(true);
    finishFirst(makeMessage({ id: latest.id, content: "stale" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(latest);
  });

  it("allows another recovery after bounded retries are exhausted", async () => {
    const message = makeMessage({ id: "notification" });
    vi.mocked(getMessageById).mockResolvedValue(null);
    const { load, onMessage } = setup();
    const first = load(message.id);
    await vi.advanceTimersByTimeAsync(1600);
    await expect(first).resolves.toBe(false);
    expect(getMessageById).toHaveBeenCalledTimes(3);
    expect(onMessage).not.toHaveBeenCalled();
    vi.mocked(getMessageById).mockResolvedValue(message);
    await expect(load(message.id)).resolves.toBe(true);
  });

  it("can fetch once identity becomes available with no cached messages", async () => {
    const message = makeMessage({ id: "notification" });
    vi.mocked(getMessageById).mockResolvedValue(message);
    const { load, setSession, onMessage } = setup();
    setSession(null);
    await expect(load(message.id)).resolves.toBe(false);
    expect(getMessageById).not.toHaveBeenCalled();
    setSession(makeSession());
    await expect(load(message.id)).resolves.toBe(true);
    expect(onMessage).toHaveBeenCalledWith(message);
  });

  it("discards a response after the member changes", async () => {
    const message = makeMessage({ id: "notification" });
    let finish!: (message: Message) => void;
    vi.mocked(getMessageById).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { load, setSession, onMessage } = setup();
    const result = load(message.id);
    setSession(makeSession({ member_id: "bob" }));
    finish(message);
    await expect(result).resolves.toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
    expect(mergeRealtimeMessage).not.toHaveBeenCalled();
  });

  it.each([
    makeMessage({ id: "other-family", family_id: "f2" }),
    makeMessage({ id: "private", sender_member_id: "bob", recipient_member_id: "charlie" }),
  ])("rejects an unrelated message: $id", async (message) => {
    vi.mocked(getMessageById).mockResolvedValue(message);
    const { load, onMessage } = setup();
    await expect(load(message.id)).resolves.toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
    expect(mergeRealtimeMessage).not.toHaveBeenCalled();
  });
});
