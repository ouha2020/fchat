import { describe, expect, it } from "vitest";

import {
  isScheduleCollaborationDeliveryAcknowledged,
  isRecentScheduleCollaborationEvidence,
  resolveScheduleCollaborationAudience,
  resolveScheduleCreationNotification,
} from "@/lib/scheduleCollaborationPolicy";

const familyItem = {
  creator_member_id: "creator",
  assignee_member_id: "assignee",
  visibility: "family" as const,
};

describe("schedule collaboration notification policy", () => {
  it("routes creation notifications by visibility and participation", () => {
    expect(resolveScheduleCreationNotification(familyItem)).toBe("created");
    expect(
      resolveScheduleCreationNotification({
        ...familyItem,
        visibility: "private",
      }),
    ).toBe("assigned");
    expect(
      resolveScheduleCreationNotification({
        ...familyItem,
        assignee_member_id: familyItem.creator_member_id,
        visibility: "private",
      }),
    ).toBeNull();
  });

  it("allows only the creator to announce a family schedule creation", () => {
    expect(
      resolveScheduleCollaborationAudience(familyItem, "created", "creator"),
    ).toEqual({ scope: "family" });
    expect(
      resolveScheduleCollaborationAudience(familyItem, "created", "other"),
    ).toEqual({ scope: "none" });
    expect(
      resolveScheduleCollaborationAudience(
        { ...familyItem, visibility: "private" },
        "created",
        "creator",
      ),
    ).toEqual({ scope: "none" });
  });

  it("sends assignment responses only between the assignee and creator", () => {
    expect(
      resolveScheduleCollaborationAudience(familyItem, "accepted", "assignee"),
    ).toEqual({ scope: "members", memberIds: ["creator"] });
    expect(
      resolveScheduleCollaborationAudience(familyItem, "declined", "other"),
    ).toEqual({ scope: "none" });
  });

  it("sends a private context event only to its explicit recipient", () => {
    expect(
      resolveScheduleCollaborationAudience(familyItem, "commented", "creator", {
        visibility: "private",
        recipient_member_id: "recipient",
      }),
    ).toEqual({ scope: "members", memberIds: ["recipient"] });
  });

  it("keeps family comments family-wide and private schedules participant-only", () => {
    expect(
      resolveScheduleCollaborationAudience(familyItem, "commented", "creator", {
        visibility: "family",
        recipient_member_id: null,
      }),
    ).toEqual({ scope: "family" });
    expect(
      resolveScheduleCollaborationAudience(
        { ...familyItem, visibility: "private" },
        "commented",
        "creator",
        { visibility: "family", recipient_member_id: null },
      ),
    ).toEqual({ scope: "members", memberIds: ["assignee"] });
  });

  it("accepts only fresh evidence timestamps", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    expect(
      isRecentScheduleCollaborationEvidence(
        "2026-07-10T11:58:00.000Z",
        now,
        5 * 60_000,
      ),
    ).toBe(true);
    expect(
      isRecentScheduleCollaborationEvidence(
        "2026-07-10T11:50:00.000Z",
        now,
        5 * 60_000,
      ),
    ).toBe(false);
  });

  it("retries only when every attempted Push failed", () => {
    expect(isScheduleCollaborationDeliveryAcknowledged(0, 1)).toBe(false);
    expect(isScheduleCollaborationDeliveryAcknowledged(1, 1)).toBe(true);
    expect(isScheduleCollaborationDeliveryAcknowledged(0, 0)).toBe(true);
  });
});
