"use client";

import type { FamilyRole } from "@/types/family";

const STORAGE_KEY = "family-chat:session";

export interface LocalSession {
  family_id: string;
  family_name: string;
  family_code: string;
  member_id: string;
  member_token: string;
  nickname: string;
  role: FamilyRole;
  is_admin: boolean;
}

export function loadSession(): LocalSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalSession;
    if (!parsed.member_id || !parsed.member_token || !parsed.family_id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: LocalSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function updateSession(patch: Partial<LocalSession>): LocalSession | null {
  const current = loadSession();
  if (!current) return null;
  const next = { ...current, ...patch };
  saveSession(next);
  return next;
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
