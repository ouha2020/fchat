import { describe, expect, it } from "vitest";

import { shouldClearTextAfterSend } from "@/lib/chatInputDraft";

describe("ChatInput draft clearing", () => {
  it("keeps the typed draft when send returns false", () => {
    expect(shouldClearTextAfterSend(false)).toBe(false);
  });

  it("clears the typed draft for successful legacy send handlers", () => {
    expect(shouldClearTextAfterSend(true)).toBe(true);
    expect(shouldClearTextAfterSend(undefined)).toBe(true);
  });
});
