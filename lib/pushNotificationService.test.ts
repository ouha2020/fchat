import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalSession } from "@/lib/authLocal";
import { checkPushSubscriptionHealth } from "@/lib/pushNotificationService";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("push subscription health", () => {
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
    vi.stubGlobal("window", {
      localStorage: { getItem: vi.fn().mockReturnValue(null) },
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkPushSubscriptionHealth(session)).rejects.toThrow("offline");
    await expect(checkPushSubscriptionHealth(session)).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
