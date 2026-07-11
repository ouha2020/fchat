import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalSession } from "@/lib/authLocal";
import { sendScheduleCollaborationNotification } from "@/lib/scheduleCollaborationClient";

const session = {
  member_id: "11111111-1111-4111-8111-111111111111",
  member_token: "22222222-2222-4222-8222-222222222222",
  family_id: "33333333-3333-4333-8333-333333333333",
} as LocalSession;

const scheduleItemId = "44444444-4444-4444-8444-444444444444";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("schedule collaboration notification client", () => {
  it("uses a keepalive request and stops after an acknowledged delivery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendScheduleCollaborationNotification(session, scheduleItemId, "created"),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/schedule/collaboration-notify",
      expect.objectContaining({
        method: "POST",
        keepalive: true,
      }),
    );
  });

  it("retries an unacknowledged request without changing its evidence id", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = sendScheduleCollaborationNotification(
      session,
      scheduleItemId,
      "commented",
      "55555555-5555-4555-8555-555555555555",
    );
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody).toEqual(firstBody);
    expect(firstBody.contextEventId).toBe(
      "55555555-5555-4555-8555-555555555555",
    );
  });
});
