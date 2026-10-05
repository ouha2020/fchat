"use client";

import { useEffect, useState } from "react";

import type { LocalSession } from "@/lib/authLocal";
import { resolveMediaUrl, type ResolvedMedia } from "@/lib/mediaClient";
import { isStorageBackedMediaRef } from "@/lib/mediaRefs";
import { safeHttpUrl } from "@/lib/security";
import {
  isMediaCacheGenerationCurrent,
  mediaCacheGeneration,
  readCachedImageBlob,
  writeCachedImageBlob,
} from "@/lib/mediaCacheStore";
export { mediaCacheKey } from "@/lib/mediaCacheStore";

// Chat images live in Supabase Storage and are fetched through short-lived
// signed URLs that rotate every few minutes. Without a persistent copy the
// browser re-downloads the full image on every rotation, every navigation,
// and every app restart — wasteful, and a broken image whenever the network
// blips. We keep the decoded bytes in the Cache API keyed by the *stable*
// storage ref (not the rotating signed URL), so a downloaded image is served
// locally until it is evicted or the member signs out.

function cacheApiAvailable(): boolean {
  return typeof caches !== "undefined";
}

/**
 * Seed the local cache with bytes we already hold (e.g. an image the user just
 * uploaded), keyed by its storage ref, so the normal display path serves it
 * instantly with no re-download.
 */
export async function cacheImageBlob(
  session: LocalSession,
  ref: string,
  blob: Blob,
): Promise<void> {
  if (!isStorageBackedMediaRef(ref)) return;
  await writeCachedImageBlob(session, ref, blob);
}

function directMediaUrl(ref: string | null | undefined): string | null {
  if (isStorageBackedMediaRef(ref ?? null)) return null;
  return safeHttpUrl(ref ?? null);
}

interface CachedImageOptions {
  messageId?: string | null;
  contextEventId?: string | null;
  enabled?: boolean;
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
  const enabled = options.enabled ?? true;
  const [media, setMedia] = useState<CachedImage>(() =>
    initialCachedMedia(ref),
  );

  useEffect(() => {
    if (!enabled) return;
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
    const generation = mediaCacheGeneration(session);
    const isCurrent = () => !cancelled && isMediaCacheGenerationCurrent(session, generation);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);

    setMedia({ url: null, status: "loading", progress: null });

    (async () => {
      // 1. Local hit: display immediately, zero network.
      const cached = await readCachedImageBlob(session, ref as string, generation);
      if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        if (!signed) {
          setMedia({ url: null, status: "error", progress: null });
          return;
        }
        if (!cacheApiAvailable()) {
          setMedia({ url: signed, status: "ready", progress: null });
          return;
        }

        const res = await fetch(signed, { signal: controller.signal });
        if (!isCurrent()) return;
        if (!res.ok) {
          // Serve the signed URL directly so the image still shows this time.
          setMedia({ url: signed, status: "ready", progress: null });
          return;
        }
        const blob = await downloadBlobWithProgress(
          res,
          (fraction) => {
            if (isCurrent()) {
              setMedia({ url: null, status: "loading", progress: fraction });
            }
          },
          () => !isCurrent(),
        );
        if (!isCurrent()) return;
        await writeCachedImageBlob(session, ref as string, blob, generation);
        if (!isCurrent()) return;
        objectUrl = URL.createObjectURL(blob);
        setMedia({ url: objectUrl, status: "ready", progress: 1 });
      } catch {
        if (!isCurrent()) return;
        // Download/caching failed. If we got a signed URL, still show the image
        // through it; only fall back to an error when we never got a URL.
        setMedia(
          signed
            ? { url: signed, status: "ready", progress: null }
            : { url: null, status: "error", progress: null },
        );
      }
    })().finally(() => window.clearTimeout(timeout));

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, ref, messageId, contextEventId, enabled]);

  return media;
}
