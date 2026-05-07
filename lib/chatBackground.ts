"use client";

const STORAGE_PREFIX = "family-chat:background:";

export const CHAT_BACKGROUND_CHANGED = "family-chat:background-changed";

export function getChatBackground(familyId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(storageKey(familyId));
}

export function setChatBackground(familyId: string, imageUrl: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(familyId), imageUrl);
  window.dispatchEvent(
    new CustomEvent(CHAT_BACKGROUND_CHANGED, {
      detail: { familyId, imageUrl },
    }),
  );
}

function storageKey(familyId: string): string {
  return `${STORAGE_PREFIX}${familyId}`;
}
