import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalSession } from "@/lib/authLocal";
import {
  createScheduleItem,
  replaceScheduleItemRecurrence,
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
        name === "create_schedule_item" ||
        name === "replace_schedule_item_recurrence"
      ) {
        return { data: itemId, error: null };
      }
      return { data: null, error: null };
    });
  });

  it("does not add a second RPC when a new schedule has a single reminder", async () => {
    await createScheduleItem(session, createInput);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "create_schedule_item",
      expect.objectContaining({
        p_remind_at: "2026-07-09T03:00:00.000Z",
        p_recurrence_rule: "none",
      }),
    );
  });

  it("writes explicit reminder rules when a new schedule has multiple reminders", async () => {
    await createScheduleItem(session, {
      ...createInput,
      reminder_offsets: [0, 10],
    });

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenLastCalledWith(
      "set_schedule_reminder_rules",
      expect.objectContaining({
        p_schedule_item_id: itemId,
        p_offsets: [0, 10],
        p_recurrence_scope: "single",
      }),
    );
  });

  it("does not add a second RPC when replacing a recurrence with a single reminder", async () => {
    const updateInput: UpdateScheduleItemInput = {
      ...createInput,
      id: itemId,
      recurrence_scope: "all",
      recurrence_rule: "weekly",
      reminder_offsets: [10],
    };

    await replaceScheduleItemRecurrence(session, updateInput);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "replace_schedule_item_recurrence",
      expect.objectContaining({
        p_item_id: itemId,
        p_recurrence_rule: "weekly",
      }),
    );
  });
});
