import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalSession } from "@/lib/authLocal";
import { checkPushSubscriptionHealth, fetchPushDiagnostics, unsubscribePush } from "@/lib/pushNotificationService";
import { installLocalSession } from "@/tests/helpers/localSession";

const session: LocalSession = {
  family_id: "11111111-1111-4111-8111-111111111111",
  family_name: "Home",
  family_code: "ABC123",
  member_id: "22222222-2222-4222-8222-222222222222",
  member_token: "member-token",
  nickname: "Member",
  role: "father",
  is_admin: false,
};

let local: ReturnType<typeof installLocalSession>;
beforeEach(() => { local = installLocalSession(session); });
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("push subscription health", () => {
  it("keeps diagnostics credentials out of the URL and disables HTTP caching", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, subscriptions: [], presence: null }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("navigator", { userAgent: "test" });
    Object.assign(window, { matchMedia: () => ({ matches: false }) });
    await fetchPushDiagnostics(session);
    expect(fetcher).toHaveBeenCalledWith("/api/push/diagnostics", expect.objectContaining({
      method: "POST", cache: "no-store", body: JSON.stringify({ memberId: session.member_id, memberToken: session.member_token }),
    }));
  });
  it("retries immediately when saving the subscription fails", async () => {
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/current-endpoint",
      expirationTime: null,
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/current-endpoint",
        keys: { p256dh: "p256dh-value", auth: "auth-value" },
      }),
    } as unknown as PushSubscription;
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(subscription),
      },
    } as unknown as ServiceWorkerRegistration;
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true });

    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15)",
      maxTouchPoints: 5,
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkPushSubscriptionHealth(session)).rejects.toThrow("offline");
    await expect(checkPushSubscriptionHealth(session)).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not unsubscribe a new identity after a delayed old browser lookup", async () => {
    let finish!: (registration: unknown) => void;
    const unsubscribe = vi.fn(); const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: () => new Promise((resolve) => { finish = resolve; }) } });
    const result = unsubscribePush(session);
    local.setSession({ ...session, member_id: "another-member" });
    finish({ pushManager: { getSubscription: async () => ({ endpoint: "https://push.example.test/fixture", unsubscribe }) } });
    await expect(result).rejects.toThrow("message_operation_cancelled");
    expect(fetcher).not.toHaveBeenCalled(); expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("reports a failed server unsubscribe instead of claiming Push was disabled", async () => {
    const unsubscribe = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({
      pushManager: { getSubscription: async () => ({ endpoint: "https://push.example.test/fixture", unsubscribe }) },
    }) } });
    await expect(unsubscribePush(session)).rejects.toThrow("push_unsubscribe_failed");
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
