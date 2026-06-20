"use client";

import { isSafeMediaRef } from "@/lib/mediaRefs";

const STORAGE_PREFIX = "family-chat:background:";

export const CHAT_BACKGROUND_CHANGED = "family-chat:background-changed";

export interface ChatBackgroundSource {
  mediaRef: string;
  messageId: string | null;
}

export function getChatBackground(familyId: string): ChatBackgroundSource | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(storageKey(familyId));
  if (!value) return null;
  const parsed = parseChatBackgroundSource(value);
  if (parsed) return parsed;
  return isSafeMediaRef(value) ? { mediaRef: value, messageId: null } : null;
}

export function setChatBackground(
  familyId: string,
  mediaRef: string,
  messageId: string | null = null,
): void {
  if (typeof window === "undefined") return;
  if (!isSafeMediaRef(mediaRef)) return;
  const source: ChatBackgroundSource = { mediaRef, messageId };
  window.localStorage.setItem(storageKey(familyId), JSON.stringify(source));
  window.dispatchEvent(
    new CustomEvent(CHAT_BACKGROUND_CHANGED, {
      detail: { familyId, mediaRef, messageId },
    }),
  );
}

function storageKey(familyId: string): string {
  return `${STORAGE_PREFIX}${familyId}`;
}

function parseChatBackgroundSource(value: string): ChatBackgroundSource | null {
  try {
    const parsed = JSON.parse(value) as Partial<ChatBackgroundSource> | null;
    if (!parsed || typeof parsed.mediaRef !== "string") return null;
    if (!isSafeMediaRef(parsed.mediaRef)) return null;
    const messageId =
      typeof parsed.messageId === "string" && parsed.messageId.trim()
        ? parsed.messageId.trim()
        : null;
    return { mediaRef: parsed.mediaRef, messageId };
  } catch {
    return null;
  }
}
