"use client";

// Save a blob to the user's device by clicking a synthetic <a download>.
// Works across mobile Chrome/Android and desktop; the object URL is revoked
// on a delay so the download has time to start.
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const SAFE_EXT_RE = /\.([a-z0-9]{1,8})$/i;

export function fileExtFromRef(ref: string | null | undefined, fallback: string): string {
  const match = ref ? SAFE_EXT_RE.exec(ref.trim()) : null;
  return match ? match[1].toLowerCase() : fallback;
}
