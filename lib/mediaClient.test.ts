import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalSession } from "@/lib/authLocal";
import { installLocalSession } from "@/tests/helpers/localSession";

const session: LocalSession = {
  family_id: "family", member_id: "one", member_token: "synthetic-test-credential",
  family_name: "test", family_code: "test", nickname: "test", role: "father", is_admin: false,
};
const ref = "storage://chat-images/family/a.jpg";
const signed = () => Response.json({ url: "https://example.test/signed-image" });

let local: ReturnType<typeof installLocalSession>;
beforeEach(() => { vi.resetModules(); local = installLocalSession(session); vi.stubGlobal("caches", undefined); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("member media signing", () => {
  it("shares concurrent signing reads but keeps member and message authorization contexts separate", async () => {
    const fetcher = vi.fn(async () => signed());
    vi.stubGlobal("fetch", fetcher);
    const { resolveMediaUrl } = await import("@/lib/mediaClient");
    await Promise.all([
      resolveMediaUrl(session, ref, { messageId: "message-one" }),
      resolveMediaUrl(session, ref, { messageId: "message-one" }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await resolveMediaUrl(session, ref, { messageId: "message-two" });
    local.setSession({ ...session, member_id: "two" });
    await resolveMediaUrl({ ...session, member_id: "two" }, ref, { messageId: "message-one" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not reuse or persist an old-tab signature after the same identity logs in again", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }))
      .mockImplementation(async () => signed());
    vi.stubGlobal("fetch", fetcher);
    const { resolveMediaUrl } = await import("@/lib/mediaClient");
    const old = resolveMediaUrl(session, ref);
    local.data.set(`family-chat:message-cache-version:${session.family_id}:${session.member_id}`, "new-tab-login");
    const current = await resolveMediaUrl(session, ref);
    expect(current).toBe("https://example.test/signed-image");
    finish(signed());
    expect(await old).toBeNull();
    expect(await resolveMediaUrl(session, ref)).toBe(current);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("cannot cache a signature that completes after sign-out", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }))
      .mockImplementation(async () => signed());
    vi.stubGlobal("fetch", fetcher);
    const { resolveMediaUrl } = await import("@/lib/mediaClient");
    const { clearImageCacheForSession } = await import("@/lib/mediaCacheStore");
    const request = resolveMediaUrl(session, ref);
    await clearImageCacheForSession(session);
    finish(signed());
    await expect(request).resolves.toBeNull();
    await resolveMediaUrl(session, ref);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("bounds stalled signing requests", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")));
    })));
    const { resolveMediaUrl } = await import("@/lib/mediaClient");
    const failure = expect(resolveMediaUrl(session, ref)).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
  });

  it("does not cache revoked access and refreshes expired signatures", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: "forbidden" }, { status: 403 }))
      .mockImplementation(async () => signed());
    vi.stubGlobal("fetch", fetcher);
    const { resolveMediaUrl } = await import("@/lib/mediaClient");
    expect(await resolveMediaUrl(session, ref)).toBeNull();
    await resolveMediaUrl(session, ref);
    await resolveMediaUrl(session, ref);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    await resolveMediaUrl(session, ref);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
