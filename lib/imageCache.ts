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

function directMediaUrl(ref: string | null | undefined): string | null {
  if (isStorageBackedMediaRef(ref ?? null)) return null;
  return safeHttpUrl(ref ?? null);
}

interface CachedImageOptions {
  messageId?: string | null;
  contextEventId?: string | null;
}

function initialCachedMedia(ref: string | null | undefined): ResolvedMedia {
  if (!ref?.trim()) return { url: null, status: "error" };
  const direct = directMediaUrl(ref);
  if (direct) return { url: direct, status: "ready" };
  return { url: null, status: "loading" };
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
): ResolvedMedia {
  const messageId = options.messageId ?? null;
  const contextEventId = options.contextEventId ?? null;
  const [media, setMedia] = useState<ResolvedMedia>(() =>
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
      setMedia({ url: null, status: "loading" });
      return () => {
        cancelled = true;
      };
    }

    setMedia({ url: null, status: "loading" });

    (async () => {
      // 1. Local hit: display immediately, zero network.
      const cached = await readCachedBlob(ref as string);
      if (cancelled) return;
      if (cached) {
        objectUrl = URL.createObjectURL(cached);
        setMedia({ url: objectUrl, status: "ready" });
        return;
      }

      // 2. Miss: sign once, download once, persist, then serve locally.
      try {
        const signed = await resolveMediaUrl(session, ref, {
          messageId,
          contextEventId,
        });
        if (cancelled) return;
        if (!signed) {
          setMedia({ url: null, status: "error" });
          return;
        }
        if (!cacheApiAvailable()) {
          setMedia({ url: signed, status: "ready" });
          return;
        }

        const res = await fetch(signed);
        if (cancelled) return;
        if (!res.ok) {
          // Serve the signed URL directly so the image still shows this time.
          setMedia({ url: signed, status: "ready" });
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        await writeCachedBlob(ref as string, blob);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setMedia({ url: objectUrl, status: "ready" });
      } catch {
        if (cancelled) return;
        // Network/VPN hiccup with no cached copy: surface as an error so the
        // caller's placeholder / retry UI can take over.
        setMedia({ url: null, status: "error" });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, ref, messageId, contextEventId]);

  return media;
}
