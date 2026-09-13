import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAssistantActionCards } from "@/lib/assistantActionService";
import type { LocalSession } from "@/lib/authLocal";
import type { CreateAssistantActionCardInput } from "@/types/assistant";

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

const drafts: CreateAssistantActionCardInput[] = [
  {
    card_type: "reminder",
    title: " Music ",
    summary: " Batch reminder ",
    payload: { starts_at: "2026-07-17T07:00:00.000Z" },
  },
  {
    card_type: "reminder",
    title: "Music",
    summary: "Batch reminder",
    payload: { starts_at: "2026-07-18T07:00:00.000Z" },
  },
];

describe("assistantActionService batch creation", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("sends every draft through one atomic RPC", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { card_id: "card-1", message_id: "message-1" },
        { card_id: "card-2", message_id: "message-2" },
      ],
      error: null,
    });

    const result = await createAssistantActionCards(session, drafts);

    expect(result).toHaveLength(2);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "create_assistant_action_cards_batch",
      expect.objectContaining({
        p_member_id: session.member_id,
        p_batch_request_id: expect.any(String),
        p_cards: [
          expect.objectContaining({ title: "Music", summary: "Batch reminder" }),
          expect.objectContaining({ title: "Music", summary: "Batch reminder" }),
        ],
      }),
    );
  });

  it("retries once with the same idempotency key", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: "network" } })
      .mockResolvedValueOnce({
        data: [
          { card_id: "card-1", message_id: "message-1" },
          { card_id: "card-2", message_id: "message-2" },
        ],
        error: null,
      });

    await createAssistantActionCards(session, drafts);

    expect(rpcMock).toHaveBeenCalledTimes(2);
    const firstArgs = rpcMock.mock.calls[0]?.[1];
    const secondArgs = rpcMock.mock.calls[1]?.[1];
    expect(secondArgs.p_batch_request_id).toBe(firstArgs.p_batch_request_id);
    expect(secondArgs.p_cards).toEqual(firstArgs.p_cards);
  });

  it("validates the complete batch before calling the RPC", async () => {
    await expect(
      createAssistantActionCards(session, [
        drafts[0],
        { ...drafts[1], title: " " },
      ]),
    ).rejects.toThrow("assistant_card_title_required");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
