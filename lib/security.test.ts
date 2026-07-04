import { describe, expect, it } from "vitest";

import {
  isBase64UrlLike,
  isUuid,
  safeGoogleMapsUrl,
  safeHttpUrl,
} from "@/lib/security";

describe("safeHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(safeHttpUrl("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
    expect(safeHttpUrl("http://192.168.1.1:3000")).toBe("http://192.168.1.1:3000");
  });

  it("rejects other schemes", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("ftp://example.com")).toBeNull();
  });

  it("rejects non-strings, garbage, and oversized values", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl(`https://example.com/${"a".repeat(2050)}`)).toBeNull();
  });
});

describe("safeGoogleMapsUrl", () => {
  it("accepts https Google Maps hosts", () => {
    expect(safeGoogleMapsUrl("https://maps.google.com/?q=1,2")).toBe(
      "https://maps.google.com/?q=1,2",
    );
    expect(safeGoogleMapsUrl("https://www.google.com/maps?q=1,2")).toBe(
      "https://www.google.com/maps?q=1,2",
    );
  });

  it("rejects http and non-Google hosts", () => {
    expect(safeGoogleMapsUrl("http://maps.google.com/?q=1,2")).toBeNull();
    expect(safeGoogleMapsUrl("https://maps.evil.example/?q=1,2")).toBeNull();
  });
});

describe("isUuid", () => {
  it("accepts canonical v4 uuids", () => {
    expect(isUuid("273bf299-9d8d-4423-b3ff-64e7010f9ac0")).toBe(true);
  });

  it("rejects near-misses", () => {
    expect(isUuid("273bf299-9d8d-4423-b3ff-64e7010f9ac")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("isBase64UrlLike", () => {
  it("checks charset and length bounds", () => {
    expect(isBase64UrlLike("abc_DEF-123", 3, 20)).toBe(true);
    expect(isBase64UrlLike("ab", 3, 20)).toBe(false);
    expect(isBase64UrlLike("has space", 3, 20)).toBe(false);
  });
});
