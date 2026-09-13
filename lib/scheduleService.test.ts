import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalSession } from "@/lib/authLocal";
import {
  createScheduleItem,
  replaceScheduleItemRecurrence,
  updateScheduleItem,
} from "@/lib/scheduleService";
import type { CreateScheduleItemInput, UpdateScheduleItemInput } from "@/types/schedule";

const rpcMock = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({
  getSupabase: () => ({
    rpc: rpcMock,
  }),
}));

const session: LocalSession = {
  family_id: "00000000-0000-4000-8000-000000000010",
  family_name: "Test Family",
  family_code: "ABC123",
  member_id: "00000000-0000-4000-8000-000000000011",
  member_token: "00000000-0000-4000-8000-000000000012",
  nickname: "Tester",
  role: "father",
  is_admin: true,
};

const itemId = "00000000-0000-4000-8000-000000000021";

const createInput: CreateScheduleItemInput = {
  title: "Schedule save",
  note: null,
  item_type: "schedule",
  visibility: "family",
  starts_at: "2026-07-09T03:00:00.000Z",
  ends_at: null,
  remind_at: "2026-07-09T03:00:00.000Z",
  reminder_offsets: [0],
  recurrence_rule: "none",
  assignee_member_id: session.member_id,
};

describe("scheduleService reminder rule writes", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (name: string) => {
      if (
        name === "create_schedule_item_with_reminder_rules" ||
        name === "replace_schedule_item_recurrence_with_reminder_rules"
      ) {
        return { data: itemId, error: null };
      }
      return { data: null, error: null };
    });
  });

  it("creates a single-reminder schedule with one transactional RPC", async () => {
    await createScheduleItem(session, createInput);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "create_schedule_item_with_reminder_rules",
      expect.objectContaining({
        p_remind_at: "2026-07-09T03:00:00.000Z",
        p_recurrence_rule: "none",
        p_reminder_offsets: [0],
      }),
    );
  });

  it("creates a multi-reminder schedule with one transactional RPC", async () => {
    await createScheduleItem(session, {
      ...createInput,
      reminder_offsets: [0, 10],
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "create_schedule_item_with_reminder_rules",
      expect.objectContaining({
        p_reminder_offsets: [0, 10],
      }),
    );
  });

  it("updates an item and its reminder rules with one transactional RPC", async () => {
    const updateInput: UpdateScheduleItemInput = {
      ...createInput,
      id: itemId,
      recurrence_scope: "future",
      reminder_offsets: [0, 30],
    };

    await updateScheduleItem(session, updateInput);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "update_schedule_item_with_reminder_rules",
      expect.objectContaining({
        p_item_id: itemId,
        p_recurrence_scope: "future",
        p_reminder_offsets: [0, 30],
      }),
    );
  });

  it("replaces recurrence and reminder rules with one transactional RPC", async () => {
    const updateInput: UpdateScheduleItemInput = {
      ...createInput,
      id: itemId,
      recurrence_scope: "all",
      recurrence_rule: "weekly",
      reminder_offsets: [10, 60],
    };

    await replaceScheduleItemRecurrence(session, updateInput);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "replace_schedule_item_recurrence_with_reminder_rules",
      expect.objectContaining({
        p_item_id: itemId,
        p_recurrence_rule: "weekly",
        p_reminder_offsets: [10, 60],
      }),
    );
  });
});
