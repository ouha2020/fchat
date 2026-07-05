"use client";

import { useEffect, useState } from "react";

import type { LocalSession } from "@/lib/authLocal";
import { resolveMediaUrl, type ResolvedMedia } from "@/lib/mediaClient";
import { isStorageBackedMediaRef } from "@/lib/mediaRefs";
import { safeHttpUrl } from "@/lib/security";

// Chat images live in Supabase Storage and are fetched through short-lived
// signed URLs that rotate every few minutes. Without a persistent copy the
// browser re-downloads the full image on every rotation, every navigation,
// and every app restart — wasteful, and a broken image whenever the network
// blips. We keep the decoded bytes in the Cache API keyed by the *stable*
// storage ref (not the rotating signed URL), so a downloaded image is served
// locally from then on and never re-fetched.

const MEDIA_CACHE_NAME = "family-chat-media-v1";
// Synthetic, same-shape key so Cache API treats each ref as one stable entry
// regardless of which signed URL happened to deliver the bytes.
const CACHE_KEY_ORIGIN = "https://media-cache.internal/";

export function mediaCacheKey(ref: string): string {
  return CACHE_KEY_ORIGIN + encodeURIComponent(ref);
}

function cacheApiAvailable(): boolean {
  return typeof caches !== "undefined";
}

async function readCachedBlob(ref: string): Promise<Blob | null> {
  if (!cacheApiAvailable()) return null;
  try {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    const hit = await cache.match(mediaCacheKey(ref));
    if (!hit) return null;
    const blob = await hit.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

async function writeCachedBlob(ref: string, blob: Blob): Promise<void> {
  if (!cacheApiAvailable() || blob.size === 0) return;
  try {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    await cache.put(
      mediaCacheKey(ref),
      new Response(blob, {
        headers: {
          "content-type": blob.type || "application/octet-stream",
        },
      }),
    );
  } catch {
    // Best-effort: a full quota or private-mode restriction must never break
    // display — we simply fall back to serving the signed URL directly.
  }
}

/**
 * Seed the local cache with bytes we already hold (e.g. an image the user just
 * uploaded), keyed by its storage ref, so the normal display path serves it
 * instantly with no re-download.
 */
export async function cacheImageBlob(
  ref: string,
  blob: Blob,
): Promise<void> {
  if (!isStorageBackedMediaRef(ref)) return;
  await writeCachedBlob(ref, blob);
}

function directMediaUrl(ref: string | null | undefined): string | null {
  if (isStorageBackedMediaRef(ref ?? null)) return null;
  return safeHttpUrl(ref ?? null);
}

interface CachedImageOptions {
  messageId?: string | null;
  contextEventId?: string | null;
}

export interface CachedImage extends ResolvedMedia {
  /** Download progress 0..1 while fetching from network; null when unknown. */
  progress: number | null;
}

function initialCachedMedia(ref: string | null | undefined): CachedImage {
  if (!ref?.trim()) return { url: null, status: "error", progress: null };
  const direct = directMediaUrl(ref);
  if (direct) return { url: direct, status: "ready", progress: null };
  return { url: null, status: "loading", progress: null };
}

// Stream the response so we can report real download progress (matching the
// upload-side progress ring). Falls back to a plain blob read when the length
// is unknown or streaming is unsupported.
async function downloadBlobWithProgress(
  response: Response,
  onProgress: (fraction: number) => void,
  isCancelled: () => boolean,
): Promise<Blob> {
  const total = Number(response.headers.get("content-length") ?? "");
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body || !Number.isFinite(total) || total <= 0) {
    return response.blob();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (isCancelled()) {
      await reader.cancel().catch(() => undefined);
      throw new DOMException("cancelled", "AbortError");
    }
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress(Math.min(1, received / total));
    }
  }
  return new Blob(chunks as BlobPart[], contentType ? { type: contentType } : undefined);
}

/**
 * Resolve a chat image ref to a displayable URL, preferring a locally cached
 * copy. Storage-backed refs are downloaded once and served from the Cache API
 * thereafter; plain http(s) refs are returned as-is (the browser HTTP cache
 * already handles those). Falls back to the rotating signed URL if the Cache
 * API is unavailable or a download fails. Mirrors the `{ url, status }` shape
 * of `useResolvedMedia` so callers get the same loading/error affordances.
 */
export function useCachedImage(
  session: LocalSession | null,
  ref: string | null | undefined,
  options: CachedImageOptions = {},
): CachedImage {
  const messageId = options.messageId ?? null;
  const contextEventId = options.contextEventId ?? null;
  const [media, setMedia] = useState<CachedImage>(() =>
    initialCachedMedia(ref),
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    // Non-storage refs are stable direct URLs — nothing to cache ourselves.
    if (!isStorageBackedMediaRef(ref ?? null)) {
      setMedia(initialCachedMedia(ref));
      return () => {
        cancelled = true;
      };
    }

    if (!session) {
      setMedia({ url: null, status: "loading", progress: null });
      return () => {
        cancelled = true;
      };
    }

    setMedia({ url: null, status: "loading", progress: null });

    (async () => {
      // 1. Local hit: display immediately, zero network.
      const cached = await readCachedBlob(ref as string);
      if (cancelled) return;
      if (cached) {
        objectUrl = URL.createObjectURL(cached);
        setMedia({ url: objectUrl, status: "ready", progress: null });
        return;
      }

      // 2. Miss: sign once, download once, persist, then serve locally.
      // Caching is strictly best-effort — once we have a signed URL the image
      // must display even if the download-to-cache step fails, so a flaky
      // (VPN) network degrades to the old direct-URL behaviour, never to a
      // broken image.
      let signed: string | null = null;
      try {
        signed = await resolveMediaUrl(session, ref, {
          messageId,
          contextEventId,
        });
        if (cancelled) return;
        if (!signed) {
          setMedia({ url: null, status: "error", progress: null });
          return;
        }
        if (!cacheApiAvailable()) {
          setMedia({ url: signed, status: "ready", progress: null });
          return;
        }

        const res = await fetch(signed);
        if (cancelled) return;
        if (!res.ok) {
          // Serve the signed URL directly so the image still shows this time.
          setMedia({ url: signed, status: "ready", progress: null });
          return;
        }
        const blob = await downloadBlobWithProgress(
          res,
          (fraction) => {
            if (!cancelled) {
              setMedia({ url: null, status: "loading", progress: fraction });
            }
          },
          () => cancelled,
        );
        if (cancelled) return;
        await writeCachedBlob(ref as string, blob);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setMedia({ url: objectUrl, status: "ready", progress: 1 });
      } catch {
        if (cancelled) return;
        // Download/caching failed. If we got a signed URL, still show the image
        // through it; only fall back to an error when we never got a URL.
        setMedia(
          signed
            ? { url: signed, status: "ready", progress: null }
            : { url: null, status: "error", progress: null },
        );
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, ref, messageId, contextEventId]);

  return media;
}
