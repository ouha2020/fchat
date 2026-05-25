const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_MEMBER_TOKEN_RE = /^[0-9a-f]{48}$/i;
const UUID_TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;
const SAFE_PAGE_RE = /^[a-z0-9/_-]{1,40}$/i;

const GOOGLE_MAPS_HOSTS = new Set(["www.google.com", "google.com", "maps.google.com"]);

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isMemberToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (LEGACY_MEMBER_TOKEN_RE.test(value) || UUID_TOKEN_RE.test(value))
  );
}

export function isBase64UrlLike(
  value: unknown,
  minLength: number,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= maxLength &&
    BASE64URL_RE.test(value)
  );
}

export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function safeHttpUrl(value: unknown): string | null {
  return isSafeHttpUrl(value) ? value : null;
}

export function safeGoogleMapsUrl(value: unknown): string | null {
  if (!isSafeHttpUrl(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return GOOGLE_MAPS_HOSTS.has(url.hostname) ? value : null;
  } catch {
    return null;
  }
}

export function normalizePresencePage(value: unknown): string {
  if (typeof value !== "string") return "app";
  const trimmed = value.trim();
  return SAFE_PAGE_RE.test(trimmed) ? trimmed : "app";
}

export function truncateText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  return value.slice(0, maxLength);
}
