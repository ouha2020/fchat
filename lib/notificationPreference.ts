"use client";

const STORAGE_PREFIX = "family-chat:notifications:";

export function getNotificationsEnabled(familyId: string): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(storageKey(familyId)) !== "off";
}

export function setNotificationsEnabled(
  familyId: string,
  enabled: boolean,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(familyId), enabled ? "on" : "off");
}

function storageKey(familyId: string): string {
  return `${STORAGE_PREFIX}${familyId}`;
}
