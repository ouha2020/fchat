import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLocalSession } from "@/tests/helpers/localSession";
import type { LocalSession } from "@/lib/authLocal";

const owner: LocalSession = { family_id: "family", member_id: "one", member_token: "synthetic",
  family_name: "test", family_code: "test", nickname: "test", role: "father", is_admin: false };
const other = { ...owner, member_id: "two" };
const ref = "storage://chat-images/family/a.jpg";
const entries = new Map<string, Response>();
const keyUrl = (key: Request | string) => typeof key === "string" ? key : key.url;
const cache = {
  match: vi.fn(async (key: Request | string) => entries.get(keyUrl(key))?.clone()),
  put: vi.fn(async (key: Request | string, response: Response) => { entries.set(keyUrl(key), response.clone()); }),
  delete: vi.fn(async (key: Request | string) => entries.delete(keyUrl(key))),
  keys: vi.fn(async () => [...entries.keys()].map((key) => new Request(key))),
};
const storage = { delete: vi.fn(async () => true), open: vi.fn(async () => cache) };
const loadStore = () => import("@/lib/mediaCacheStore");
let local: ReturnType<typeof installLocalSession>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  entries.clear();
  local = installLocalSession(owner);
  vi.stubGlobal("caches", storage);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("member image cache", () => {
  it("does not share cached bytes with another member and removes unscoped legacy entries", async () => {
    const store = await loadStore();
    await store.writeCachedImageBlob(owner, ref, new Blob(["private image"]));
    expect(await (await store.readCachedImageBlob(owner, ref))?.text()).toBe("private image");
    expect(await store.readCachedImageBlob(other, ref)).toBeNull();
    expect(storage.delete).toHaveBeenCalledWith("family-chat-media-v1");
  });

  it("clears only the departing member and rejects late writes from that session", async () => {
    const store = await loadStore();
    const generation = store.mediaCacheGeneration(owner);
    await store.writeCachedImageBlob(owner, ref, new Blob(["one"]));
    local.setSession(other);
    await store.writeCachedImageBlob(other, ref, new Blob(["two"]));
    local.setSession(owner);
    const clearing = store.clearImageCacheForSession(owner);
    expect(store.isMediaCacheGenerationCurrent(owner, generation)).toBe(false);
    await clearing;
    await store.writeCachedImageBlob(owner, ref, new Blob(["late download"]), generation);
    expect(await store.readCachedImageBlob(owner, ref)).toBeNull();
    local.setSession(other);
    expect(await (await store.readCachedImageBlob(other, ref))?.text()).toBe("two");
  });

  it("rejects a download after another tab replaces the shared version, even before storage events", async () => {
    const store = await loadStore();
    const generation = store.mediaCacheGeneration(owner);
    local.data.set(`family-chat:message-cache-version:${owner.family_id}:${owner.member_id}`, "new-login-version");
    expect(store.isMediaCacheGenerationCurrent(owner, generation)).toBe(false);
    await store.writeCachedImageBlob(owner, ref, new Blob(["late private bytes"]), generation);
    expect(entries.size).toBe(0);
  });

  it("disables persistence when shared session version storage is unavailable", async () => {
    local.localStorage.setItem.mockImplementation(() => { throw new Error("denied"); });
    const store = await loadStore();
    await store.writeCachedImageBlob(owner, ref, new Blob(["private"]));
    expect(entries.size).toBe(0);
  });

  it("evicts the oldest image when the entry limit is exceeded", async () => {
    const store = await loadStore();
    let time = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => time++);
    for (let index = 0; index <= store.MAX_MEDIA_CACHE_ENTRIES; index++) {
      await store.writeCachedImageBlob(owner, `${ref}-${index}`, new Blob(["x"]));
    }
    expect(entries.size).toBe(store.MAX_MEDIA_CACHE_ENTRIES);
    expect(await store.readCachedImageBlob(owner, `${ref}-0`)).toBeNull();
    expect(await store.readCachedImageBlob(owner, `${ref}-${store.MAX_MEDIA_CACHE_ENTRIES}`)).not.toBeNull();
  });

  it("bounds total bytes independently of the image count", async () => {
    const store = await loadStore();
    const image = new Blob(["x"]);
    // Exercise quota accounting without allocating large media fixtures.
    Object.defineProperty(image, "size", { value: 40 * 1024 * 1024 });
    await store.writeCachedImageBlob(owner, `${ref}-old`, image);
    await store.writeCachedImageBlob(owner, `${ref}-new`, image);
    expect(entries.size).toBe(1);
    expect(await store.readCachedImageBlob(owner, `${ref}-old`)).toBeNull();
  });

  it("tolerates storage denial and quota failures", async () => {
    const store = await loadStore();
    cache.put.mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    await expect(store.writeCachedImageBlob(owner, ref, new Blob(["x"]))).resolves.toBeUndefined();
    vi.stubGlobal("caches", undefined);
    expect(await store.readCachedImageBlob(owner, ref)).toBeNull();
    await expect(store.clearImageCacheForSession(owner)).resolves.toBeUndefined();
  });
});
