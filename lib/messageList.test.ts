import { describe, expect, it } from "vitest";

import {
  filterVisibleMessages,
  hasAssistantCardMessage,
  isMessageVisibleToSession,
  mergeMessagesById,
  sortMessagesByCreatedAt,
} from "@/lib/messageList";
import { makeMessage, makeSession } from "@/tests/helpers/messages";

const alice = makeSession({ member_id: "alice" });
const bob = makeSession({ member_id: "bob" });
const carol = makeSession({ member_id: "carol" });

describe("sortMessagesByCreatedAt", () => {
  it("orders by created_at ascending", () => {
    const a = makeMessage({ id: "a", created_at: "2026-07-01T01:00:00.000Z" });
    const b = makeMessage({ id: "b", created_at: "2026-07-01T02:00:00.000Z" });
    expect(sortMessagesByCreatedAt([b, a]).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("breaks timestamp ties by id so ordering is stable across clients", () => {
    const time = "2026-07-01T01:00:00.000Z";
    const a = makeMessage({ id: "a", created_at: time });
    const b = makeMessage({ id: "b", created_at: time });
    expect(sortMessagesByCreatedAt([b, a]).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const a = makeMessage({ id: "a", created_at: "2026-07-01T01:00:00.000Z" });
    const b = makeMessage({ id: "b", created_at: "2026-07-01T02:00:00.000Z" });
    const input = [b, a];
    sortMessagesByCreatedAt(input);
    expect(input.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("mergeMessagesById", () => {
  it("unions distinct messages and sorts the result", () => {
    const a = makeMessage({ id: "a", created_at: "2026-07-01T01:00:00.000Z" });
    const b = makeMessage({ id: "b", created_at: "2026-07-01T02:00:00.000Z" });
    const c = makeMessage({ id: "c", created_at: "2026-07-01T01:30:00.000Z" });
    expect(mergeMessagesById([a, b], [c]).map((m) => m.id)).toEqual(["a", "c", "b"]);
  });

  it("lets incoming rows replace existing ones (soft-delete update)", () => {
    const original = makeMessage({ id: "a", content: "hello" });
    const deleted = makeMessage({
      id: "a",
      content: "hello",
      deleted_at: "2026-07-01T03:00:00.000Z",
      deleted_by_member_id: "alice",
    });
    const merged = mergeMessagesById([original], [deleted]);
    expect(merged).toHaveLength(1);
    expect(merged[0].deleted_at).toBe("2026-07-01T03:00:00.000Z");
  });

  it("handles empty sides", () => {
    const a = makeMessage({ id: "a" });
    expect(mergeMessagesById([], [a]).map((m) => m.id)).toEqual(["a"]);
    expect(mergeMessagesById([a], []).map((m) => m.id)).toEqual(["a"]);
    expect(mergeMessagesById([], [])).toEqual([]);
  });
});

describe("isMessageVisibleToSession", () => {
  it("shows public messages to everyone", () => {
    const message = makeMessage({ id: "m", sender_member_id: "alice" });
    expect(isMessageVisibleToSession(message, alice)).toBe(true);
    expect(isMessageVisibleToSession(message, bob)).toBe(true);
  });

  it("restricts whispers to sender and recipient", () => {
    const whisper = makeMessage({
      id: "w",
      sender_member_id: "alice",
      recipient_member_id: "bob",
    });
    expect(isMessageVisibleToSession(whisper, alice)).toBe(true);
    expect(isMessageVisibleToSession(whisper, bob)).toBe(true);
    expect(isMessageVisibleToSession(whisper, carol)).toBe(false);
  });

  it("shows assistant cards only to the member who created them", () => {
    const card = makeMessage({
      id: "c",
      message_type: "system",
      sender_member_id: "alice",
      system_event_type: "assistant_card_created",
    });
    expect(isMessageVisibleToSession(card, alice)).toBe(true);
    expect(isMessageVisibleToSession(card, bob)).toBe(false);
  });

  it("shows broadcast assistant action-done notices only to their sender", () => {
    const done = makeMessage({
      id: "d",
      message_type: "system",
      sender_member_id: "alice",
      system_event_type: "assistant_action_done",
      system_event_payload: { actor_type: "assistant", schedule_item_id: "s1" },
    });
    expect(isMessageVisibleToSession(done, alice)).toBe(true);
    expect(isMessageVisibleToSession(done, bob)).toBe(false);
  });

  it("treats addressed assistant action-done notices like whispers", () => {
    const done = makeMessage({
      id: "d",
      message_type: "system",
      sender_member_id: "alice",
      recipient_member_id: "bob",
      system_event_type: "assistant_action_done",
      system_event_payload: { actor_type: "assistant", schedule_item_id: "s1" },
    });
    expect(isMessageVisibleToSession(done, bob)).toBe(true);
    expect(isMessageVisibleToSession(done, carol)).toBe(false);
  });
});

describe("filterVisibleMessages", () => {
  it("drops rows the session must not see", () => {
    const rows = [
      makeMessage({ id: "public" }),
      makeMessage({ id: "whisper", sender_member_id: "alice", recipient_member_id: "bob" }),
      makeMessage({
        id: "card",
        message_type: "system",
        sender_member_id: "bob",
        system_event_type: "assistant_card_created",
      }),
    ];
    expect(filterVisibleMessages(rows, carol).map((m) => m.id)).toEqual(["public"]);
    expect(filterVisibleMessages(rows, bob).map((m) => m.id)).toEqual([
      "public",
      "whisper",
      "card",
    ]);
  });
});

describe("hasAssistantCardMessage", () => {
  it("detects cards by event type and by payload shape", () => {
    const byType = makeMessage({
      id: "t",
      message_type: "system",
      system_event_type: "assistant_card_created",
    });
    const byPayload = makeMessage({
      id: "p",
      message_type: "system",
      system_event_payload: {
        actor_type: "assistant",
        card_id: "c1",
        status: "pending",
      },
    });
    const plain = makeMessage({ id: "x" });
    expect(hasAssistantCardMessage([plain, byType])).toBe(true);
    expect(hasAssistantCardMessage([plain, byPayload])).toBe(true);
    expect(hasAssistantCardMessage([plain])).toBe(false);
  });
});
