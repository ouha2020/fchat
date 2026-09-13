import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ rpc: rpcMock }),
}));

vi.mock("@/lib/webPushServer", () => ({
  getWebPush: vi.fn(),
  isGonePushError: vi.fn(),
  pushErrorStatus: vi.fn(),
  toWebPushSubscription: vi.fn(),
}));

import {
  flushDueScheduleReminders,
  retryFailedScheduleReminders,
  scheduleReminderSkipReason,
} from "@/lib/scheduleReminderServer";

describe("schedule reminder server claims", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: [], error: null });
  });

  it("atomically claims due deliveries after creating overdue records", async () => {
    await expect(flushDueScheduleReminders()).resolves.toEqual({
      ok: true,
      scanned: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      gone: 0,
    });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "ensure_overdue_schedule_reminders");
    expect(rpcMock).toHaveBeenNthCalledWith(
      2,
      "claim_schedule_reminder_deliveries",
      { p_mode: "due", p_limit: 100 },
    );
  });

  it("atomically claims retryable deliveries", async () => {
    await expect(retryFailedScheduleReminders()).resolves.toMatchObject({
      ok: true,
      scanned: 0,
    });

    expect(rpcMock).toHaveBeenCalledOnce();
    expect(rpcMock).toHaveBeenCalledWith(
      "claim_schedule_reminder_deliveries",
      { p_mode: "retry", p_limit: 100 },
    );
  });

  it("does not process deliveries when the atomic claim fails", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: new Error("claim_failed"),
    });

    await expect(retryFailedScheduleReminders()).rejects.toThrow("claim_failed");
  });
});

describe("schedule reminder freshness", () => {
  const now = Date.parse("2026-07-11T08:00:00.000Z");
  const item = {
    id: "item",
    family_id: "family",
    creator_member_id: "creator",
    assignee_member_id: "assignee",
    assignee_response: "accepted" as const,
    visibility: "family" as const,
    status: "active" as const,
    deleted_at: null,
    remind_at: "2026-07-10T08:00:00.000Z",
    starts_at: "2026-07-12T08:00:00.000Z",
  };
  const delivery = {
    id: "delivery",
    family_id: "family",
    schedule_item_id: "item",
    member_id: "member",
    scheduled_for: "2026-07-10T08:00:00.000Z",
    reminder_kind: "before_start" as const,
    status: "processing" as const,
    attempt_count: 1,
  };

  it("still sends a missed advance reminder while the event is in the future", () => {
    expect(scheduleReminderSkipReason(delivery, item, now)).toBeNull();
  });

  it("drops a start reminder more than five minutes after the event begins", () => {
    expect(
      scheduleReminderSkipReason(
        delivery,
        { ...item, starts_at: "2026-07-11T07:54:59.000Z" },
        now,
      ),
    ).toBe("reminder_stale");
  });

  it("drops snoozes delayed by more than thirty minutes", () => {
    expect(
      scheduleReminderSkipReason(
        {
          ...delivery,
          reminder_kind: "snooze",
          scheduled_for: "2026-07-11T07:29:59.000Z",
        },
        item,
        now,
      ),
    ).toBe("reminder_stale");
  });

  it("drops overdue reminders older than one day", () => {
    expect(
      scheduleReminderSkipReason(
        {
          ...delivery,
          reminder_kind: "overdue",
          scheduled_for: "2026-07-10T07:59:59.000Z",
        },
        { ...item, starts_at: "2026-07-10T07:49:59.000Z" },
        now,
      ),
    ).toBe("reminder_stale");
  });
});
