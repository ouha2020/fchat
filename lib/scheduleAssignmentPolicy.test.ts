import { describe, expect, it } from "vitest";

import {
  canManageScheduleItem,
  canReceiveScheduleReminder,
  canRespondScheduleAssignment,
  canSetScheduleItemStatus,
  isConfirmedScheduleAssignee,
} from "@/lib/scheduleAssignmentPolicy";

const familyItem = {
  creator_member_id: "creator",
  assignee_member_id: "assignee",
  assignee_response: "pending" as const,
  visibility: "family" as const,
};

describe("schedule assignment policy", () => {
  it("does not treat pending or declined assignments as responsibility", () => {
    expect(isConfirmedScheduleAssignee(familyItem, "assignee")).toBe(false);
    expect(
      isConfirmedScheduleAssignee(
        { ...familyItem, assignee_response: "declined" },
        "assignee",
      ),
    ).toBe(false);
  });

  it("lets an accepted assignee manage and complete the schedule", () => {
    const acceptedItem = {
      ...familyItem,
      assignee_response: "accepted" as const,
    };
    const assignee = { member_id: "assignee", is_admin: false };

    expect(isConfirmedScheduleAssignee(acceptedItem, assignee.member_id)).toBe(
      true,
    );
    expect(canSetScheduleItemStatus(acceptedItem, assignee)).toBe(true);
    expect(canManageScheduleItem(acceptedItem, assignee)).toBe(true);
  });

  it("keeps creator management independent of assignment response", () => {
    const creator = { member_id: "creator", is_admin: false };
    expect(canSetScheduleItemStatus(familyItem, creator)).toBe(true);
    expect(canManageScheduleItem(familyItem, creator)).toBe(true);
    expect(canRespondScheduleAssignment(familyItem, creator)).toBe(false);
  });

  it("offers assignment response only to a distinct assignee", () => {
    const assignee = { member_id: "assignee", is_admin: false };
    expect(canRespondScheduleAssignment(familyItem, assignee)).toBe(true);
    expect(
      canRespondScheduleAssignment(
        {
          ...familyItem,
          creator_member_id: "assignee",
          assignee_response: "accepted",
        },
        assignee,
      ),
    ).toBe(false);
  });

  it("blocks stale private reminders until the assignee accepts", () => {
    expect(
      canReceiveScheduleReminder(
        { ...familyItem, visibility: "private" },
        "assignee",
      ),
    ).toBe(false);
    expect(
      canReceiveScheduleReminder(
        {
          ...familyItem,
          visibility: "private",
          assignee_response: "accepted",
        },
        "assignee",
      ),
    ).toBe(true);
    expect(
      canReceiveScheduleReminder(
        { ...familyItem, visibility: "private" },
        "creator",
      ),
    ).toBe(true);
    expect(canReceiveScheduleReminder(familyItem, "other-family-member")).toBe(
      true,
    );
  });

  it("lets admins manage only family-visible schedules without completing them", () => {
    const admin = { member_id: "admin", is_admin: true };

    expect(canManageScheduleItem(familyItem, admin)).toBe(true);
    expect(canSetScheduleItemStatus(familyItem, admin)).toBe(false);
    expect(
      canManageScheduleItem(
        { ...familyItem, visibility: "private" },
        admin,
      ),
    ).toBe(false);
  });
});
