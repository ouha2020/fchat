"use client";

import { useEffect, useMemo, useState } from "react";

import type { LocalSession } from "@/lib/authLocal";
import {
  isStorageBackedMediaRef,
  resolveStorageMediaRef,
} from "@/lib/mediaRefs";
import { safeHttpUrl } from "@/lib/security";
import {
  isMediaCacheGenerationCurrent,
  mediaCacheGeneration,
  mediaCacheGenerationKey,
  mediaCacheOwner,
} from "@/lib/mediaCacheStore";

interface ResolveMediaOptions {
  messageId?: string | null;
  contextEventId?: string | null;
  refreshKey?: number;
  forceRefresh?: boolean;
  enabled?: boolean;
}

interface SignResponse {
  url?: string;
  error?: string;
}

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const pendingSignedUrls = new Map<string, { promise: Promise<string | null>; controller: AbortController }>();
const MAX_SIGNED_URL_CACHE_ENTRIES = 256;
const SIGNED_URL_TTL_MS = 4 * 60 * 1000;
const SIGNED_URL_RETRY_MS = 15 * 1000;
const SIGNED_URL_MAX_RETRIES = 3;

export function clearSignedMediaCacheForSession(session: LocalSession): void {
  const prefix = `${mediaCacheOwner(session)}|`;
  const currentPrefix = `${prefix}${mediaCacheGenerationKey(mediaCacheGeneration(session))}|`;
  for (const key of signedUrlCache.keys()) {
    if (key.startsWith(prefix) && !key.startsWith(currentPrefix)) signedUrlCache.delete(key);
  }
  for (const [key, request] of pendingSignedUrls) {
    if (key.startsWith(prefix) && !key.startsWith(currentPrefix)) {
      request.controller.abort();
      pendingSignedUrls.delete(key);
    }
  }
}

export async function resolveMediaUrl(
  session: LocalSession | null,
  ref: string | null | undefined,
  options: ResolveMediaOptions = {},
): Promise<string | null> {
  const trimmed = ref?.trim();
  if (!trimmed) return null;

  const media = resolveStorageMediaRef(trimmed);
  const legacyUrl = safeHttpUrl(trimmed);
  if (legacyUrl && !media) return legacyUrl;
  if (!media || !session) return null;

  const generation = mediaCacheGeneration(session);
  if (!isMediaCacheGenerationCurrent(session, generation)) return null;
  const cacheKey = [
    mediaCacheOwner(session),
    mediaCacheGenerationKey(generation),
    options.messageId ?? "",
    options.contextEventId ?? "",
    trimmed,
  ].join("|");
  for (const [key, entry] of signedUrlCache) {
    if (entry.expiresAt <= Date.now()) signedUrlCache.delete(key);
  }
  const cached = signedUrlCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    signedUrlCache.delete(cacheKey);
    signedUrlCache.set(cacheKey, cached);
    return cached.url;
  }
  const pending = pendingSignedUrls.get(cacheKey);
  if (pending) return pending.promise;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const promise = (async () => {
    const res = await fetch("/api/media/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberId: session.member_id,
        memberToken: session.member_token,
        ref: trimmed,
        messageId: options.messageId ?? null,
        contextEventId: options.contextEventId ?? null,
      }),
      signal: controller.signal,
    });
    const payload = (await res.json().catch(() => null)) as SignResponse | null;
    if (!isMediaCacheGenerationCurrent(session, generation)) return null;
    // Access failures are permanent. Only network/server failures should retry.
    if (res.status >= 500) throw new Error(`media sign failed: ${res.status}`);
    if (!res.ok || !payload?.url) return null;
    const signedUrl = safeHttpUrl(payload.url);
    if (!signedUrl) return null;
    signedUrlCache.delete(cacheKey);
    signedUrlCache.set(cacheKey, {
      url: signedUrl,
      expiresAt: Date.now() + SIGNED_URL_TTL_MS,
    });
    while (signedUrlCache.size > MAX_SIGNED_URL_CACHE_ENTRIES) {
      const oldestKey = signedUrlCache.keys().next().value as string;
      signedUrlCache.delete(oldestKey);
    }
    return signedUrl;
  })().finally(() => {
    clearTimeout(timeout);
    if (pendingSignedUrls.get(cacheKey)?.controller === controller) {
      pendingSignedUrls.delete(cacheKey);
    }
  });
  pendingSignedUrls.set(cacheKey, { promise, controller });
  return promise;
}

export type MediaResolveStatus = "loading" | "ready" | "error";

export interface ResolvedMedia {
  url: string | null;
  status: MediaResolveStatus;
}

export function useResolvedMedia(
  session: LocalSession | null,
  ref: string | null | undefined,
  options: ResolveMediaOptions = {},
): ResolvedMedia {
  const stableOptions = useMemo(
    () => ({
      messageId: options.messageId ?? null,
      contextEventId: options.contextEventId ?? null,
      refreshKey: options.refreshKey ?? 0,
      forceRefresh: Boolean(options.forceRefresh),
      enabled: options.enabled ?? true,
    }),
    [
      options.messageId,
      options.contextEventId,
      options.refreshKey,
      options.forceRefresh,
      options.enabled,
    ],
  );
  const [media, setMedia] = useState<ResolvedMedia>(() => initialMedia(ref));

  useEffect(() => {
    if (!stableOptions.enabled) return;
    let cancelled = false;
    let resolving = false;
    let refreshTimer: number | null = null;
    let retriesLeft = SIGNED_URL_MAX_RETRIES;
    const isStorageRef = isStorageBackedMediaRef(ref ?? null) && Boolean(session);

    const clearRefreshTimer = () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const resolve = () => {
      clearRefreshTimer();
      if (cancelled || resolving || document.visibilityState !== "visible") return;
      resolving = true;
      resolveMediaUrl(session, ref, stableOptions)
        .then((resolved) => {
          if (cancelled) return;
          // null here is a permanent failure (ref deleted / access revoked);
          // retrying would just poll the sign endpoint forever.
          setMedia({ url: resolved, status: resolved ? "ready" : "error" });
          if (isStorageRef && resolved) {
            retriesLeft = SIGNED_URL_MAX_RETRIES;
            refreshTimer = window.setTimeout(resolve, SIGNED_URL_TTL_MS);
          }
        })
        .catch(() => {
          if (cancelled) return;
          if (isStorageRef && retriesLeft > 0) {
            retriesLeft -= 1;
            setMedia({ url: null, status: "loading" });
            refreshTimer = window.setTimeout(resolve, SIGNED_URL_RETRY_MS);
          } else {
            setMedia({ url: null, status: "error" });
          }
        }).finally(() => { resolving = false; });
    };

    const handleVisibility = () => {
      clearRefreshTimer();
      if (document.visibilityState === "visible") resolve();
    };
    setMedia(initialMedia(ref));
    document.addEventListener("visibilitychange", handleVisibility);
    resolve();
    return () => {
      cancelled = true;
      clearRefreshTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [session, ref, stableOptions]);

  return media;
}

export function useResolvedMediaUrl(
  session: LocalSession | null,
  ref: string | null | undefined,
  options: ResolveMediaOptions = {},
): string | null {
  return useResolvedMedia(session, ref, options).url;
}

function initialMedia(ref: string | null | undefined): ResolvedMedia {
  if (!ref?.trim()) return { url: null, status: "error" };
  const direct = safeDirectMediaUrl(ref);
  if (direct) return { url: direct, status: "ready" };
  return { url: null, status: "loading" };
}

function safeDirectMediaUrl(ref: string | null | undefined): string | null {
  if (isStorageBackedMediaRef(ref ?? null)) return null;
  return safeHttpUrl(ref ?? null);
}
