import { describe, expect, it } from "vitest";

import { mediaCacheKey } from "@/lib/imageCache";
const owner = { family_id: "fam-1", member_id: "member-1" };

describe("mediaCacheKey", () => {
  it("maps a storage ref to a stable, same-origin cache key", () => {
    const ref = "storage://chat-images/fam-1/1720000000000-abcd.jpg";
    const key = mediaCacheKey(owner, ref);
    expect(key).toBe(mediaCacheKey(owner, ref));
    expect(key.startsWith("https://media-cache.internal/")).toBe(true);
  });

  it("gives distinct keys to distinct refs", () => {
    const a = mediaCacheKey(owner, "storage://chat-images/fam-1/a.jpg");
    const b = mediaCacheKey(owner, "storage://chat-images/fam-1/b.jpg");
    expect(a).not.toBe(b);
  });

  it("percent-encodes the ref so slashes never spawn extra path segments", () => {
    const key = mediaCacheKey(owner, "storage://chat-images/fam-1/nested/path.png");
    const url = new URL(key);
    expect(url.pathname).toBe(
      "/fam-1/member-1/unavailable/" + encodeURIComponent("storage://chat-images/fam-1/nested/path.png"),
    );
  });

  it("isolates the same image between members and families without storing tokens", () => {
    const ref = "storage://chat-images/fam-1/a.jpg";
    expect(mediaCacheKey(owner, ref)).not.toBe(mediaCacheKey({ ...owner, member_id: "member-2" }, ref));
    expect(mediaCacheKey(owner, ref)).not.toBe(mediaCacheKey({ ...owner, family_id: "fam-2" }, ref));
  });
});
