"use client";

import type { LocalSession } from "@/lib/authLocal";
import type { TranslationKey } from "@/lib/i18n";

export type PushPlatform = "ios" | "android" | "desktop" | "unknown";

export interface PushPreferences {
  messagesEnabled: boolean;
  locationEnabled: boolean;
  importantEnabled: boolean;
}

export interface PushSupportState {
  supported: boolean;
  reason?: "missing_vapid_key" | "unsupported" | "ios_not_standalone";
  platform: PushPlatform;
  isIos: boolean;
  isStandalone: boolean;
  permission: NotificationPermission | "unsupported";
}

const PREF_PREFIX = "family-chat:push-preferences:";
export const DEFAULT_PUSH_PREFERENCES: PushPreferences = {
  messagesEnabled: true,
  locationEnabled: true,
  importantEnabled: false,
};

export function getPushPreferences(session: LocalSession): PushPreferences {
  if (typeof window === "undefined") return DEFAULT_PUSH_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(prefKey(session));
    if (!raw) return DEFAULT_PUSH_PREFERENCES;
    return {
      ...DEFAULT_PUSH_PREFERENCES,
      ...(JSON.parse(raw) as Partial<PushPreferences>),
    };
  } catch {
    return DEFAULT_PUSH_PREFERENCES;
  }
}

export function savePushPreferences(
  session: LocalSession,
  preferences: PushPreferences,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(prefKey(session), JSON.stringify(preferences));
}

export function getPushSupportState(): PushSupportState {
  const platform = detectPlatform();
  const isIos = platform === "ios";
  const isStandalone = isStandalonePwa();
  const permission =
    typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  const hasVapidKey = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined" &&
    hasVapidKey &&
    (!isIos || isStandalone);

  return {
    supported,
    reason: !hasVapidKey
      ? "missing_vapid_key"
      : typeof window === "undefined" ||
          !("serviceWorker" in navigator) ||
          !("PushManager" in window) ||
          typeof Notification === "undefined"
        ? "unsupported"
        : isIos && !isStandalone
          ? "ios_not_standalone"
          : undefined,
    platform,
    isIos,
    isStandalone,
    permission,
  };
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function subscribeToPush(
  session: LocalSession,
  preferences: PushPreferences,
): Promise<void> {
  const support = getPushSupportState();
  if (!support.supported) {
    throw new Error(support.reason ?? "unsupported");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied" ? "permission_denied" : "permission_default");
  }

  const registration = await ensureServiceWorker();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      ),
    }));

  const nextPreferences = toNewMessagePushPreferences(preferences);
  await savePushSubscription(session, subscription, nextPreferences);
  savePushPreferences(session, nextPreferences);
}

export async function savePushSubscription(
  session: LocalSession,
  subscription: PushSubscription,
  preferences: PushPreferences,
): Promise<void> {
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      memberId: session.member_id,
      memberToken: session.member_token,
      familyId: session.family_id,
      subscription: subscription.toJSON(),
      platform: detectPlatform(),
      preferences,
    }),
  });
  if (!response.ok) throw new Error("push_subscribe_failed");
}

export async function unsubscribePush(session: LocalSession): Promise<void> {
  const subscription = await getCurrentPushSubscription();
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      memberId: session.member_id,
      memberToken: session.member_token,
      endpoint: subscription?.endpoint ?? null,
    }),
  }).catch(() => undefined);
  await subscription?.unsubscribe().catch(() => undefined);
}

export function updatePushPresence(
  session: LocalSession,
  isActive: boolean,
  keepalive = false,
  currentPage = "app",
): void {
  fetch("/api/push/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      memberId: session.member_id,
      memberToken: session.member_token,
      currentPage,
      isActive,
    }),
    keepalive,
  }).catch(() => undefined);
}

export function requestMessagePush(
  session: LocalSession,
  messageId: string,
): void {
  fetch("/api/push/send-message-notification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      memberId: session.member_id,
      memberToken: session.member_token,
      messageId,
    }),
    keepalive: true,
  }).catch(() => undefined);
}

export interface PushDiagnostics {
  permission: NotificationPermission | "unsupported";
  swRegistered: boolean;
  subscriptionExists: boolean;
  subscriptionEndpointHost: string | null;
  subscriptionEndpointFingerprint: string | null;
  subscriptionExpiration: number | null;
  platform: PushPlatform;
  isStandalone: boolean;
  serverSubscriptions: ServerSubscriptionInfo[];
  presence: { current_page: string | null; is_active: boolean; last_seen_at: string | null } | null;
}

export interface ServerSubscriptionInfo {
  id: string;
  endpointHost: string;
  endpointFingerprint: string;
  platform: string;
  enabled: boolean;
  messages_enabled: boolean;
  location_enabled: boolean;
  important_enabled: boolean;
  last_notified_at: string | null;
  disabled_at: string | null;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchPushDiagnostics(
  session: LocalSession,
): Promise<PushDiagnostics> {
  const permission =
    typeof Notification === "undefined" ? "unsupported" : Notification.permission;

  let swRegistered = false;
  let subscriptionExists = false;
  let subscriptionEndpointHost: string | null = null;
  let subscriptionEndpointFingerprint: string | null = null;
  let subscriptionExpiration: number | null = null;

  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      swRegistered = Boolean(reg);
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        subscriptionExists = Boolean(sub);
        if (sub) {
          subscriptionEndpointHost = endpointHost(sub.endpoint);
          subscriptionEndpointFingerprint = await endpointFingerprint(sub.endpoint);
          subscriptionExpiration = sub.expirationTime ?? null;
        }
      }
    } catch {
      // ignore
    }
  }

  let serverSubscriptions: ServerSubscriptionInfo[] = [];
  let presence: PushDiagnostics["presence"] = null;

  try {
    const params = new URLSearchParams({
      memberId: session.member_id,
      memberToken: session.member_token,
    });
    const resp = await fetch(`/api/push/diagnostics?${params.toString()}`);
    if (resp.ok) {
      const data = (await resp.json()) as {
        ok: boolean;
        subscriptions: ServerSubscriptionInfo[];
        presence: PushDiagnostics["presence"];
      };
      serverSubscriptions = data.subscriptions ?? [];
      presence = data.presence ?? null;
    }
  } catch {
    // ignore
  }

  return {
    permission,
    swRegistered,
    subscriptionExists,
    subscriptionEndpointHost,
    subscriptionEndpointFingerprint,
    subscriptionExpiration,
    platform: detectPlatform(),
    isStandalone: isStandalonePwa(),
    serverSubscriptions,
    presence,
  };
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

async function endpointFingerprint(endpoint: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(endpoint);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

export function pushNotificationErrorMessage(
  err: unknown,
  t: (key: TranslationKey) => string,
): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "ios_not_standalone") return t("settingsPushIosGuideTitle");
  if (message === "permission_denied") return t("settingsPushDenied");
  if (message === "missing_vapid_key") return t("settingsPushMissingConfig");
  if (message === "unsupported") return t("settingsPushUnsupported");
  return t("settingsPushEnableFailed");
}

export function detectPlatform(): PushPlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/macintosh/.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  return "desktop";
}

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

const HEALTH_CHECK_DEBOUNCE_MS = 300_000; // 5 minutes between re-saves
let lastHealthSaveAt = 0;

export async function checkPushSubscriptionHealth(
  session: LocalSession,
  options: { force?: boolean } = {},
): Promise<"ok" | "resubscribed" | "expired" | "no_subscription"> {
  if (!("serviceWorker" in navigator)) return "no_subscription";

  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return "no_subscription";

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return "no_subscription";

  if (subscription.expirationTime && subscription.expirationTime < Date.now()) {
    await savePushSubscriptionStatus(session, subscription.endpoint, false);
    return "expired";
  }

  const now = Date.now();
  if (!options.force && now - lastHealthSaveAt < HEALTH_CHECK_DEBOUNCE_MS) {
    return "ok";
  }
  lastHealthSaveAt = now;

  const prefs = getPushPreferences(session);
  await savePushSubscription(session, subscription, prefs);
  return options.force ? "resubscribed" : "ok";
}

async function savePushSubscriptionStatus(
  session: LocalSession,
  endpoint: string,
  enabled: boolean,
): Promise<void> {
  if (!enabled) {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId: session.member_id,
        memberToken: session.member_token,
        endpoint,
      }),
    }).catch(() => undefined);
  }
}

function prefKey(session: LocalSession): string {
  return `${PREF_PREFIX}${session.family_id}:${session.member_id}`;
}

function toNewMessagePushPreferences(
  preferences: PushPreferences,
): PushPreferences {
  return {
    messagesEnabled: preferences.messagesEnabled,
    locationEnabled: preferences.locationEnabled,
    importantEnabled: preferences.importantEnabled,
  };
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer.slice(0);
}
