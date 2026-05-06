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
    const t0 = ctx.currentTime;

    // Master bus with a soft compressor so the chime stays loud without
    // clipping on phone speakers.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.001;
    comp.release.value = 0.1;
    comp.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 1.0;
    master.connect(comp);

    // Two-tone ding-dong chime, similar to common system push tones.
    chime(ctx, master, t0, 1318); // E6
    chime(ctx, master, t0 + 0.16, 1568); // G6
  } catch {
    // ignore
  }
}

function chime(
  ctx: AudioContext,
  dest: AudioNode,
  when: number,
  freq: number,
): void {
  const sine = ctx.createOscillator();
  const tri = ctx.createOscillator();
  sine.type = "sine";
  tri.type = "triangle";
  sine.frequency.value = freq;
  tri.frequency.value = freq * 2;

  const gain = ctx.createGain();
  gain.connect(dest);
  sine.connect(gain);
  tri.connect(gain);

  // Sharp attack, ~0.4s exponential decay — louder peak (0.85) than
  // the previous 0.18 sine.
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.85, when + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.45);

  sine.start(when);
  tri.start(when);
  sine.stop(when + 0.5);
  tri.stop(when + 0.5);
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
