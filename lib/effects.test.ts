import { describe, expect, it } from "vitest";

import { detectEffect, effectFromColumns, transformForSending } from "@/lib/effects";

describe("detectEffect", () => {
  it("returns null for empty or ordinary text", () => {
    expect(detectEffect(null)).toBeNull();
    expect(detectEffect("")).toBeNull();
    expect(detectEffect("你好")).toBeNull();
    expect(detectEffect("#123")).toBeNull();
    expect(detectEffect("#12345")).toBeNull();
    expect(detectEffect("x #1314")).toBeNull();
  });

  it("maps special codes to their effects", () => {
    expect(detectEffect("#1314")).toEqual({ id: "hearts", caption: "一生一世" });
    expect(detectEffect("#0000")).toEqual({ id: "fireworks", caption: "新年快乐" });
    expect(detectEffect("#9999")).toEqual({ id: "sparkles" });
  });

  it("falls back to confetti for unknown 4-digit codes", () => {
    expect(detectEffect("#4321")).toEqual({ id: "confetti" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(detectEffect("  #1314  ")).toEqual({ id: "hearts", caption: "一生一世" });
  });
});

describe("transformForSending", () => {
  it("passes ordinary text through untouched", () => {
    expect(transformForSending("晚上吃饺子")).toEqual({
      content: "晚上吃饺子",
      effect: null,
    });
  });

  it("replaces effect codes with the caption", () => {
    expect(transformForSending("#1314")).toEqual({
      content: "一生一世",
      effect: { id: "hearts", caption: "一生一世" },
    });
  });

  it("uses the emoji placeholder when the effect has no caption", () => {
    expect(transformForSending("#9999")).toEqual({
      content: "✨",
      effect: { id: "sparkles" },
    });
  });
});

describe("effectFromColumns", () => {
  it("returns null without an effect id", () => {
    expect(effectFromColumns(null, "caption")).toBeNull();
    expect(effectFromColumns("", "caption")).toBeNull();
  });

  it("rejects ids outside the allowlist", () => {
    expect(effectFromColumns("evil", "caption")).toBeNull();
  });

  it("builds effects from valid columns", () => {
    expect(effectFromColumns("hearts", "我爱你")).toEqual({
      id: "hearts",
      caption: "我爱你",
    });
    expect(effectFromColumns("cake", null)).toEqual({
      id: "cake",
      caption: undefined,
    });
  });
});
