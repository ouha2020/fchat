"use client";

import type { FamilyRole } from "@/types/family";

const STORAGE_KEY = "family-chat:session";
const DEVICE_ID_KEY = "family-chat:device-id";
const MEMBER_ID_COOKIE = "family_chat_member_id";
const MEMBER_TOKEN_COOKIE = "family_chat_member_token";

export interface LocalSession {
  family_id: string;
  family_name: string;
  family_code: string;
  member_id: string;
  member_token: string;
  device_id?: string;
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
  const next = { ...session, device_id: session.device_id ?? getOrCreateDeviceId() };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  writeCookie(MEMBER_ID_COOKIE, next.member_id);
  writeCookie(MEMBER_TOKEN_COOKIE, next.member_token);
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
  const current = loadSession();
  if (current) {
    import("@/lib/messageCache")
      .then(({ clearMessageCacheForSession }) =>
        clearMessageCacheForSession(current),
      )
      .catch(() => undefined);
  }
  window.localStorage.removeItem(STORAGE_KEY);
  expireCookie(MEMBER_ID_COOKIE);
  expireCookie(MEMBER_TOKEN_COOKIE);
}

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

function writeCookie(name: string, value: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(
    value,
  )}; Path=/; Max-Age=2592000; SameSite=Lax${secure}`;
}

function expireCookie(name: string): void {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}
