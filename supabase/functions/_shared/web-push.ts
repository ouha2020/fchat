import webPush from "npm:web-push@3.6.7";

let configured = false;

export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function getWebPush() {
  if (configured) return webPush;

  const publicKey =
    Deno.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY") ??
    Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    throw new Error("web_push_not_configured");
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return webPush;
}

export function toWebPushSubscription(sub: StoredPushSubscription) {
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  };
}

export function pushErrorStatus(error: unknown): number | string {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  return typeof statusCode === "number" ? statusCode : "unknown";
}

export function numericPushStatus(error: unknown): number | null {
  const status = pushErrorStatus(error);
  return typeof status === "number" ? status : null;
}

export function isGonePushError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

export function truncateError(error: unknown): string | null {
  if (error instanceof Error) return error.message.slice(0, 300);
  if (typeof error === "string") return error.slice(0, 300);
  return null;
}
