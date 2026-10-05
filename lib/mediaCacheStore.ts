import type { LocalSession } from "@/lib/authLocal";
import { captureMessageCacheContext, currentMessageCacheVersion, invalidateMessageCacheContext, isMessageContextCurrent,
  type MessageCacheContext } from "@/lib/messageCacheLifecycle";

type CacheOwner = Pick<LocalSession, "family_id" | "member_id" | "member_token">;
type OwnerPath = Pick<CacheOwner, "family_id" | "member_id">;
const MEDIA_CACHE_NAME = "family-chat-media-v3";
const LEGACY_MEDIA_CACHE_NAMES = ["family-chat-media-v1", "family-chat-media-v2"];
const CACHE_KEY_ORIGIN = "https://media-cache.internal/";
export const MAX_MEDIA_CACHE_ENTRIES = 128;
export const MAX_MEDIA_CACHE_BYTES = 64 * 1024 * 1024;
const generations = new Map<string, number>();
let cacheQueue: Promise<unknown> = Promise.resolve();
let cacheReady: Promise<Cache> | null = null;

export function mediaCacheOwner(session: OwnerPath): string {
  return `${encodeURIComponent(session.family_id)}/${encodeURIComponent(session.member_id)}/`;
}

export function mediaCacheKey(session: OwnerPath, ref: string, version = currentMessageCacheVersion(session)): string {
  return CACHE_KEY_ORIGIN + mediaCacheOwner(session) + encodeURIComponent(version ?? "unavailable") + "/" + encodeURIComponent(ref);
}

export interface MediaCacheGeneration {
  readonly local: number;
  readonly context: MessageCacheContext;
}

export function mediaCacheGeneration(session: CacheOwner): MediaCacheGeneration {
  return { local: generations.get(mediaCacheOwner(session)) ?? 0, context: captureMessageCacheContext(session) };
}

export function mediaCacheGenerationKey(generation: MediaCacheGeneration): string {
  return `${generation.local}:${generation.context.version ?? "unavailable"}`;
}

export function isMediaCacheGenerationCurrent(session: CacheOwner, generation: MediaCacheGeneration): boolean {
  return (generations.get(mediaCacheOwner(session)) ?? 0) === generation.local &&
    isMessageContextCurrent(generation.context);
}

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const next = cacheQueue.then(operation);
  cacheQueue = next.catch(() => undefined);
  return next;
}

async function openMediaCache(): Promise<Cache> {
  if (!cacheReady) {
    // Legacy entries have no owner boundary. Re-download through the sign API.
    cacheReady = Promise.all(LEGACY_MEDIA_CACHE_NAMES.map((name) => caches.delete(name)))
      .then(() => caches.open(MEDIA_CACHE_NAME))
      .catch((error) => { cacheReady = null; throw error; });
  }
  return cacheReady;
}

export async function readCachedImageBlob(
  session: CacheOwner,
  ref: string,
  generation = mediaCacheGeneration(session),
): Promise<Blob | null> {
  if (typeof caches === "undefined" || !generation.context.version) return null;
  try {
    return await serialized(async () => {
      if (!isMediaCacheGenerationCurrent(session, generation)) return null;
      const cache = await openMediaCache();
      const response = await cache.match(mediaCacheKey(session, ref, generation.context.version));
      if (!response) return null;
      const blob = await response.blob();
      return isMediaCacheGenerationCurrent(session, generation) && blob.size > 0 ? blob : null;
    });
  } catch {
    return null;
  }
}

export async function writeCachedImageBlob(
  session: CacheOwner,
  ref: string,
  blob: Blob,
  generation = mediaCacheGeneration(session),
): Promise<void> {
  if (typeof caches === "undefined" || !generation.context.version || blob.size === 0 || blob.size > MAX_MEDIA_CACHE_BYTES) return;
  try {
    await serialized(async () => {
      if (!isMediaCacheGenerationCurrent(session, generation)) return;
      const cache = await openMediaCache();
      if (!isMediaCacheGenerationCurrent(session, generation)) return;
      const key = mediaCacheKey(session, ref, generation.context.version);
      if (await cache.match(key)) return;
      if (!isMediaCacheGenerationCurrent(session, generation)) return;
      await cache.put(key, new Response(blob, {
        headers: {
          "content-type": blob.type || "application/octet-stream",
          "x-media-cache-bytes": String(blob.size),
          "x-media-cache-stored-at": String(Date.now()),
        },
      }));
      if (!isMediaCacheGenerationCurrent(session, generation)) {
        await cache.delete(key);
        return;
      }
      const keys = await cache.keys();
      const entries = await Promise.all(keys.map(async (request) => {
        const response = await cache.match(request);
        return {
          request,
          size: Number(response?.headers.get("x-media-cache-bytes") ?? 0),
          storedAt: Number(response?.headers.get("x-media-cache-stored-at") ?? 0),
        };
      }));
      entries.sort((a, b) => a.storedAt - b.storedAt);
      let bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
      let count = entries.length;
      for (const entry of entries) {
        if (count <= MAX_MEDIA_CACHE_ENTRIES && bytes <= MAX_MEDIA_CACHE_BYTES) break;
        await cache.delete(entry.request);
        bytes -= entry.size;
        count -= 1;
      }
    });
  } catch {
    // Quota/private-mode failures must not prevent showing or sending media.
  }
}

/** Invalidate synchronously so late downloads cannot refill a signed-out member's cache. */
export function clearImageCacheForSession(session: CacheOwner, alreadyInvalidated = false): Promise<void> {
  if (!alreadyInvalidated) invalidateMessageCacheContext(session);
  const owner = mediaCacheOwner(session);
  generations.set(owner, (generations.get(owner) ?? 0) + 1);
  if (typeof caches === "undefined") return Promise.resolve();
  return serialized(async () => {
    const cache = await openMediaCache();
    const prefix = CACHE_KEY_ORIGIN + owner;
    const currentPrefix = prefix + encodeURIComponent(currentMessageCacheVersion(session) ?? "unavailable") + "/";
    const keys = await cache.keys();
    await Promise.all(keys.filter((key) => key.url.startsWith(prefix) && !key.url.startsWith(currentPrefix))
      .map((key) => cache.delete(key)));
  }).catch(() => undefined);
}
