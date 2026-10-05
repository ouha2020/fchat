import type { LocalSession } from "@/lib/authLocal";

export const MESSAGE_SESSION_KEY = "family-chat:session";
export const MESSAGE_VERSION_PREFIX = "family-chat:message-cache-version:";
type Identity = Pick<LocalSession, "family_id" | "member_id" | "member_token">;

export interface MessageCacheContext {
  readonly identity: Identity;
  readonly version: string | null;
  readonly generation: number;
}

const generations = new Map<string, number>();
const listeners = new Set<() => void>();

export function messageIdentityMatches(a: Identity | null, b: Identity): boolean {
  return !!a && a.family_id === b.family_id && a.member_id === b.member_id &&
    a.member_token === b.member_token;
}

function ownerKey(owner: Pick<Identity, "family_id" | "member_id">): string {
  return `${owner.family_id}:${owner.member_id}`;
}

export function messageVersionKey(owner: Pick<Identity, "family_id" | "member_id">): string {
  return MESSAGE_VERSION_PREFIX + ownerKey(owner);
}

function storedIdentity(): Identity | null {
  try {
    return JSON.parse(window.localStorage.getItem(MESSAGE_SESSION_KEY) ?? "null");
  } catch { return null; }
}

export function currentMessageCacheVersion(owner: Pick<Identity, "family_id" | "member_id">): string | null {
  try { return window.localStorage.getItem(messageVersionKey(owner)); }
  catch { return null; }
}

/** Capture before the network request, and pass this same context through every await. */
export function captureMessageCacheContext(identity: Identity): MessageCacheContext {
  let version = currentMessageCacheVersion(identity);
  if (!version && typeof window !== "undefined" && messageIdentityMatches(storedIdentity(), identity)) {
    try {
      version = crypto.randomUUID();
      window.localStorage.setItem(messageVersionKey(identity), version);
    } catch { version = null; }
  }
  return { identity: { family_id: identity.family_id, member_id: identity.member_id,
    member_token: identity.member_token }, version, generation: generations.get(ownerKey(identity)) ?? 0 };
}

export function isMessageContextCurrent(context: MessageCacheContext): boolean {
  return typeof window !== "undefined" &&
    context.generation === (generations.get(ownerKey(context.identity)) ?? 0) &&
    messageIdentityMatches(storedIdentity(), context.identity) &&
    (!context.version || currentMessageCacheVersion(context.identity) === context.version);
}

/** No credential is copied to version metadata. Invalidation happens before async deletion. */
export function invalidateMessageCacheContext(identity: Identity): void {
  const owner = ownerKey(identity);
  generations.set(owner, (generations.get(owner) ?? 0) + 1);
  try { window.localStorage.setItem(messageVersionKey(identity), crypto.randomUUID()); }
  catch { /* Persistent caching is disabled when shared version metadata is unavailable. */ }
  listeners.forEach((listener) => listener());
}

export function watchMessageContext(context: MessageCacheContext, onInvalid: () => void): () => void {
  const check = () => { if (!isMessageContextCurrent(context)) onInvalid(); };
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === MESSAGE_SESSION_KEY || event.key === messageVersionKey(context.identity)) check();
  };
  listeners.add(check);
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(check); window.removeEventListener("storage", onStorage); };
}

export function assertMessageContext(context: MessageCacheContext): void {
  if (!isMessageContextCurrent(context)) throw new Error("message_operation_cancelled");
}
