"use client";

// Notification helpers: in-app sound (Web Audio), vibration, browser notification.
// All entry points are no-ops in unsupported environments.

let audioCtx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

/**
 * Browsers block AudioContext until a user gesture. Wire this up once on
 * mount; it removes itself after the first click/touch.
 */
export function installAudioUnlock(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const handler = () => {
    const ctx = ensureCtx();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    document.removeEventListener("click", handler);
    document.removeEventListener("touchstart", handler);
  };
  document.addEventListener("click", handler, { once: true });
  document.addEventListener("touchstart", handler, {
    once: true,
    passive: true,
  });
  return () => {
    document.removeEventListener("click", handler);
    document.removeEventListener("touchstart", handler);
  };
}

export function playNotificationSound(): void {
  const ctx = ensureCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.45);
  } catch {
    // ignore
  }
}

export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  const v = (navigator as { vibrate?: (p: VibratePattern) => boolean })
    .vibrate;
  if (!v) return;
  try {
    v.call(navigator, pattern);
  } catch {
    // ignore
  }
}

export type NotificationPerm = "default" | "granted" | "denied" | "unsupported";

export function getNotificationPermission(): NotificationPerm {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission as NotificationPerm;
}

export async function requestNotificationPermission(): Promise<NotificationPerm> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const perm = await Notification.requestPermission();
    return perm as NotificationPerm;
  } catch {
    return "denied";
  }
}

export function showBrowserNotification(title: string, body: string): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  // Only fire when the tab isn't visible — the in-app sound covers the
  // foreground case.
  if (typeof document !== "undefined" && !document.hidden) return;
  try {
    const n = new Notification(title, {
      body,
      tag: "family-chat",
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore
      }
      n.close();
    };
  } catch {
    // ignore
  }
}
