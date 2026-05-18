"use client";

const OWNER_REJOIN_KEY = "family-chat:pending-owner-rejoin";
const TTL_MS = 10 * 60 * 1000;

export interface PendingOwnerRejoin {
  familyCode: string;
  nickname: string;
  createdAt: number;
}

export function savePendingOwnerRejoin(familyCode: string, nickname: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    OWNER_REJOIN_KEY,
    JSON.stringify({
      familyCode: familyCode.trim().toUpperCase(),
      nickname: nickname.trim(),
      createdAt: Date.now(),
    }),
  );
}

export function loadPendingOwnerRejoin(): PendingOwnerRejoin | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(OWNER_REJOIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingOwnerRejoin;
    if (!parsed.familyCode || !parsed.nickname) return null;
    if (Date.now() - Number(parsed.createdAt ?? 0) > TTL_MS) {
      clearPendingOwnerRejoin();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingOwnerRejoin() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(OWNER_REJOIN_KEY);
}
