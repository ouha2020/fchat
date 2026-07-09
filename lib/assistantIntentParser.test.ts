import { describe, expect, it } from "vitest";

import {
  isAssistantCreateDraft,
  parseAssistantIntents,
} from "@/lib/assistantIntentParser";
import type { FamilyMember } from "@/types/member";

const me: FamilyMember = {
  id: "m1",
  family_id: "f1",
  nickname: "爸爸",
  role: "father",
  is_admin: true,
  status: "active",
  avatar_url: null,
  last_active_at: "2026-07-08T00:00:00.000Z",
};

function ctx(now: Date) {
  return { members: [me], currentMemberId: "m1", now };
}

function createDraftsOf(text: string, now: Date) {
  return parseAssistantIntents(text, ctx(now)).filter(isAssistantCreateDraft);
}

describe("parseAssistantIntents — day-of-month dates", () => {
  it("creates one reminder per date for a comma-linked day list", () => {
    const now = new Date(2026, 6, 8, 22, 0, 0); // 2026-07-08 22:00 local
    const drafts = createDraftsOf("13，17号提醒英语课", now);
    expect(drafts).toHaveLength(2);
    for (const draft of drafts) {
      expect(draft.card_type).toBe("reminder");
      expect(draft.title).toBe("英语课"); // not "号 英语课"
      expect(draft.reason).toBeUndefined();
    }
    const days = drafts
      .map((d) => new Date(d.payload!.starts_at as string).getDate())
      .sort((a, b) => a - b);
    expect(days).toEqual([13, 17]);
    // No explicit time → default 9:00, and 17 is NOT read as 17:00.
    const first = new Date(drafts[0].payload!.starts_at as string);
    expect(first.getHours()).toBe(9);
    expect(first.getMonth()).toBe(6); // still July
  });

  it("does not misread the day number as a clock time", () => {
    const now = new Date(2026, 6, 8, 22, 0, 0);
    const [draft] = createDraftsOf("17号提醒英语课", now);
    const date = new Date(draft.payload!.starts_at as string);
    expect(date.getDate()).toBe(17);
    expect(date.getHours()).toBe(9);
  });

  it("uses an explicit time when given alongside the date", () => {
    const now = new Date(2026, 6, 8, 22, 0, 0);
    const [draft] = createDraftsOf("13号下午5点提醒英语课", now);
    const date = new Date(draft.payload!.starts_at as string);
    expect(date.getDate()).toBe(13);
    expect(date.getHours()).toBe(17);
  });

  it("honours an explicit month and day", () => {
    const now = new Date(2026, 6, 8, 22, 0, 0);
    const [draft] = createDraftsOf("7月9日17点提醒开会", now);
    const date = new Date(draft.payload!.starts_at as string);
    expect(date.getMonth()).toBe(6); // July
    expect(date.getDate()).toBe(9);
    expect(date.getHours()).toBe(17);
  });

  it("rolls a passed day-of-month to next month", () => {
    const now = new Date(2026, 6, 18, 22, 0, 0); // 18th, so the 17th passed
    const [draft] = createDraftsOf("17号提醒英语课", now);
    const date = new Date(draft.payload!.starts_at as string);
    expect(date.getMonth()).toBe(7); // August
    expect(date.getDate()).toBe(17);
  });
});

describe("parseAssistantIntents — existing behaviour preserved", () => {
  it("still parses relative date + time into one reminder", () => {
    const now = new Date(2026, 6, 8, 10, 0, 0);
    const [draft, ...rest] = createDraftsOf("明天下午3点提醒开会", now);
    expect(rest).toHaveLength(0);
    const date = new Date(draft.payload!.starts_at as string);
    expect(date.getDate()).toBe(9); // tomorrow
    expect(date.getHours()).toBe(15);
  });
});
