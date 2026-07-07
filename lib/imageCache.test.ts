import { describe, expect, it } from "vitest";

import { mediaCacheKey } from "@/lib/imageCache";

describe("mediaCacheKey", () => {
  it("maps a storage ref to a stable, same-origin cache key", () => {
    const ref = "storage://chat-images/fam-1/1720000000000-abcd.jpg";
    const key = mediaCacheKey(ref);
    expect(key).toBe(mediaCacheKey(ref));
    expect(key.startsWith("https://media-cache.internal/")).toBe(true);
  });

  it("gives distinct keys to distinct refs", () => {
    const a = mediaCacheKey("storage://chat-images/fam-1/a.jpg");
    const b = mediaCacheKey("storage://chat-images/fam-1/b.jpg");
    expect(a).not.toBe(b);
  });

  it("percent-encodes the ref so slashes never spawn extra path segments", () => {
    const key = mediaCacheKey("storage://chat-images/fam-1/nested/path.png");
    const url = new URL(key);
    expect(url.pathname).toBe(
      "/" + encodeURIComponent("storage://chat-images/fam-1/nested/path.png"),
    );
  });
});
