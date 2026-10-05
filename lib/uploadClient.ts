"use client";

import { isSafeOutgoingMediaRef } from "@/lib/mediaRefs";

export const MEDIA_UPLOAD_TIMEOUT_MS = 120_000;

export interface MediaUploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Keep real upload progress while bounding stalled requests. Never retry writes automatically. */
export function uploadMediaViaApi(
  path: string,
  form: FormData,
  options: MediaUploadOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("upload_cancelled"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => {
      options.signal?.removeEventListener("abort", abort);
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
      if (xhr.upload) xhr.upload.onprogress = null;
    };
    const fail = (code: string) => {
      cleanup();
      reject(new Error(code));
    };
    xhr.open("POST", path);
    xhr.responseType = "json";
    xhr.timeout = MEDIA_UPLOAD_TIMEOUT_MS;
    if (options.onProgress && xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          options.onProgress?.(Math.min(1, event.loaded / event.total));
        }
      };
    }
    xhr.onload = () => {
      const payload = xhr.response as { url?: string; error?: string } | null;
      const url = payload?.url;
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(payload?.error ?? "upload_failed");
      } else if (!isSafeOutgoingMediaRef(url)) {
        fail("upload_failed");
      } else {
        cleanup();
        resolve(url);
      }
    };
    xhr.onerror = () => fail("upload_failed");
    xhr.ontimeout = () => fail("upload_timeout");
    xhr.onabort = () => fail("upload_cancelled");
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      xhr.send(form);
    } catch {
      fail("upload_failed");
    }
  });
}
