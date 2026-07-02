"use client";

import { useEffect, useMemo, useState } from "react";

import type { LocalSession } from "@/lib/authLocal";
import {
  isStorageBackedMediaRef,
  resolveStorageMediaRef,
} from "@/lib/mediaRefs";
import { safeHttpUrl } from "@/lib/security";

interface ResolveMediaOptions {
  messageId?: string | null;
  contextEventId?: string | null;
}

interface SignResponse {
  url?: string;
  error?: string;
}

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_TTL_MS = 4 * 60 * 1000;
const SIGNED_URL_RETRY_MS = 15 * 1000;
const SIGNED_URL_MAX_RETRIES = 3;

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

  const cacheKey = [
    session.member_id,
    options.messageId ?? "",
    options.contextEventId ?? "",
    trimmed,
  ].join("|");
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

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
  });
  const payload = (await res.json().catch(() => null)) as SignResponse | null;
  // 4xx means the ref is gone or access was revoked — retrying won't help,
  // so resolve to null. Server hiccups (5xx) throw so callers can retry.
  if (res.status >= 500) {
    throw new Error(`media sign failed: ${res.status}`);
  }
  if (!res.ok || !payload?.url) return null;
  const signedUrl = safeHttpUrl(payload.url);
  if (!signedUrl) return null;

  signedUrlCache.set(cacheKey, {
    url: signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL_MS,
  });
  return signedUrl;
}

export function useResolvedMediaUrl(
  session: LocalSession | null,
  ref: string | null | undefined,
  options: ResolveMediaOptions = {},
): string | null {
  const stableOptions = useMemo(
    () => ({
      messageId: options.messageId ?? null,
      contextEventId: options.contextEventId ?? null,
    }),
    [options.messageId, options.contextEventId],
  );
  const [url, setUrl] = useState<string | null>(() => safeDirectMediaUrl(ref));

  useEffect(() => {
    let cancelled = false;
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
      resolveMediaUrl(session, ref, stableOptions)
        .then((resolved) => {
          if (cancelled) return;
          setUrl(resolved);
          // null here is a permanent failure (ref deleted / access revoked);
          // retrying would just poll the sign endpoint forever.
          if (isStorageRef && resolved) {
            retriesLeft = SIGNED_URL_MAX_RETRIES;
            refreshTimer = window.setTimeout(resolve, SIGNED_URL_TTL_MS);
          }
        })
        .catch(() => {
          if (cancelled) return;
          setUrl(null);
          if (isStorageRef && retriesLeft > 0) {
            retriesLeft -= 1;
            refreshTimer = window.setTimeout(resolve, SIGNED_URL_RETRY_MS);
          }
        });
    };

    setUrl(safeDirectMediaUrl(ref));
    resolve();
    return () => {
      cancelled = true;
      clearRefreshTimer();
    };
  }, [session, ref, stableOptions]);

  return url;
}

function safeDirectMediaUrl(ref: string | null | undefined): string | null {
  if (isStorageBackedMediaRef(ref ?? null)) return null;
  return safeHttpUrl(ref ?? null);
}
