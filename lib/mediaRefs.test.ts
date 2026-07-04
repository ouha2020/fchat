import { afterEach, describe, expect, it, vi } from "vitest";

import {
  avatarStoragePathBelongsToFamily,
  createStorageMediaRef,
  isSafeMediaRef,
  isSafeStoragePath,
  isStorageBackedMediaRef,
  parseLegacyStoragePublicUrl,
  parseStorageMediaRef,
} from "@/lib/mediaRefs";

const PROJECT_URL = "https://proj.supabase.co";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseStorageMediaRef", () => {
  it("round-trips refs created by createStorageMediaRef", () => {
    const ref = createStorageMediaRef("chat-images", "fam1/123-abc.jpg");
    expect(parseStorageMediaRef(ref)).toEqual({
      bucket: "chat-images",
      path: "fam1/123-abc.jpg",
    });
  });

  it("rejects unknown buckets", () => {
    expect(parseStorageMediaRef("storage://secrets/x.png")).toBeNull();
  });

  it("rejects path traversal and malformed paths", () => {
    expect(parseStorageMediaRef("storage://chat-images/a/../b.jpg")).toBeNull();
    expect(parseStorageMediaRef("storage://chat-images//x.jpg")).toBeNull();
    expect(parseStorageMediaRef("storage://chat-images/带空格 的.jpg")).toBeNull();
  });

  it("rejects non-strings and oversized values", () => {
    expect(parseStorageMediaRef(null)).toBeNull();
    expect(parseStorageMediaRef(`storage://chat-images/${"a".repeat(2050)}`)).toBeNull();
  });
});

describe("parseLegacyStoragePublicUrl", () => {
  it("parses public URLs on the configured project host", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROJECT_URL);
    expect(
      parseLegacyStoragePublicUrl(
        `${PROJECT_URL}/storage/v1/object/public/chat-images/avatars/f1/a.jpg`,
      ),
    ).toEqual({ bucket: "chat-images", path: "avatars/f1/a.jpg" });
  });

  it("rejects other hosts even with a matching path", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROJECT_URL);
    expect(
      parseLegacyStoragePublicUrl(
        "https://evil.example/storage/v1/object/public/chat-images/a.jpg",
      ),
    ).toBeNull();
  });

  it("rejects buckets outside the allowlist", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROJECT_URL);
    expect(
      parseLegacyStoragePublicUrl(
        `${PROJECT_URL}/storage/v1/object/public/private-bucket/a.jpg`,
      ),
    ).toBeNull();
  });

  it("returns null when the project URL is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(
      parseLegacyStoragePublicUrl(
        `${PROJECT_URL}/storage/v1/object/public/chat-images/a.jpg`,
      ),
    ).toBeNull();
  });
});

describe("isSafeStoragePath", () => {
  it("accepts the character set used by uploads", () => {
    expect(isSafeStoragePath("avatars/f1/m2/9a-b_c.$x.webp")).toBe(true);
  });

  it("rejects traversal, absolute, and empty paths", () => {
    expect(isSafeStoragePath("../x")).toBe(false);
    expect(isSafeStoragePath("/x")).toBe(false);
    expect(isSafeStoragePath("")).toBe(false);
    expect(isSafeStoragePath("a".repeat(1030))).toBe(false);
  });
});

describe("ref classification helpers", () => {
  it("classifies storage refs and legacy urls as storage-backed", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROJECT_URL);
    expect(isStorageBackedMediaRef("storage://chat-audios/f/a.webm")).toBe(true);
    expect(
      isStorageBackedMediaRef(
        `${PROJECT_URL}/storage/v1/object/public/chat-audios/f/a.webm`,
      ),
    ).toBe(true);
    expect(isStorageBackedMediaRef("https://example.com/a.webm")).toBe(false);
  });

  it("isSafeMediaRef accepts http urls and storage refs only", () => {
    expect(isSafeMediaRef("https://example.com/a.png")).toBe(true);
    expect(isSafeMediaRef("storage://chat-images/f/a.png")).toBe(true);
    expect(isSafeMediaRef("javascript:alert(1)")).toBe(false);
    expect(isSafeMediaRef("storage://nope/a.png")).toBe(false);
  });
});

describe("avatarStoragePathBelongsToFamily", () => {
  it("only accepts paths under avatars/<familyId>/", () => {
    expect(avatarStoragePathBelongsToFamily("avatars/f1/m1/a.jpg", "f1")).toBe(true);
    expect(avatarStoragePathBelongsToFamily("avatars/f2/m1/a.jpg", "f1")).toBe(false);
    expect(avatarStoragePathBelongsToFamily("f1/a.jpg", "f1")).toBe(false);
  });
});
