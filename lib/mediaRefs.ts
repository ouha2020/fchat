import { isSafeHttpUrl } from "@/lib/security";

export type MediaBucket = "chat-images" | "chat-audios";

export interface StorageMediaRef {
  bucket: MediaBucket;
  path: string;
}

const STORAGE_REF_PREFIX = "storage://";
const STORAGE_REF_RE = /^storage:\/\/(chat-images|chat-audios)\/(.+)$/;
const SAFE_STORAGE_PATH_RE = /^[A-Za-z0-9/_.$-]+$/;
const STORAGE_PUBLIC_PREFIX = "/storage/v1/object/public/";

export function createStorageMediaRef(bucket: MediaBucket, path: string): string {
  return `${STORAGE_REF_PREFIX}${bucket}/${path}`;
}

export function parseStorageMediaRef(value: unknown): StorageMediaRef | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const match = STORAGE_REF_RE.exec(value.trim());
  if (!match) return null;
  const bucket = match[1] as MediaBucket;
  const path = match[2] ?? "";
  if (!isSafeStoragePath(path)) return null;
  return { bucket, path };
}

export function parseLegacyStoragePublicUrl(value: unknown): StorageMediaRef | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (!isAllowedSupabaseStorageHost(url)) return null;
    const pathname = url.pathname;
    if (!pathname.startsWith(STORAGE_PUBLIC_PREFIX)) return null;
    const rest = pathname.slice(STORAGE_PUBLIC_PREFIX.length);
    const slashIndex = rest.indexOf("/");
    if (slashIndex <= 0) return null;
    const bucket = rest.slice(0, slashIndex);
    if (bucket !== "chat-images" && bucket !== "chat-audios") return null;
    const encodedPath = rest.slice(slashIndex + 1);
    const path = decodeURIComponent(encodedPath);
    if (!isSafeStoragePath(path)) return null;
    return { bucket, path };
  } catch {
    return null;
  }
}

export function resolveStorageMediaRef(value: unknown): StorageMediaRef | null {
  return parseStorageMediaRef(value) ?? parseLegacyStoragePublicUrl(value);
}

export function isStorageBackedMediaRef(value: unknown): boolean {
  return resolveStorageMediaRef(value) !== null;
}

export function isSafeMediaRef(value: unknown): value is string {
  return isSafeHttpUrl(value) || parseStorageMediaRef(value) !== null;
}

export function isSafeStoragePath(path: string): boolean {
  if (!path || path.length > 1024) return false;
  if (path.startsWith("/") || path.includes("//") || path.includes("..")) {
    return false;
  }
  return SAFE_STORAGE_PATH_RE.test(path);
}

export function avatarStoragePathBelongsToFamily(
  path: string,
  familyId: string,
): boolean {
  return path.startsWith(`avatars/${familyId}/`);
}

function isAllowedSupabaseStorageHost(url: URL): boolean {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) return false;
  try {
    const allowed = new URL(projectUrl);
    return url.origin === allowed.origin;
  } catch {
    return false;
  }
}
