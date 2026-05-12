import webPush from "web-push";
import type { PushSubscription } from "web-push";
import type { MessageType } from "@/types/message";

let configured = false;

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function getWebPush() {
  if (configured) return webPush;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    throw new Error("web_push_not_configured");
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return webPush;
}

export function toWebPushSubscription(
  sub: StoredPushSubscription,
): PushSubscription {
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  };
}

export function buildMessagePushBody(
  senderName: string,
  messageType: MessageType,
): string {
  switch (messageType) {
    case "image":
      return `${senderName} \u53d1\u6765\u4e86\u4e00\u5f20\u56fe\u7247`;
    case "audio":
      return `${senderName} \u53d1\u6765\u4e86\u4e00\u6761\u8bed\u97f3`;
    case "location":
      return `${senderName} \u5206\u4eab\u4e86\u4f4d\u7f6e`;
    case "system":
      return "\u5bb6\u5ead\u804a\u5929\u6709\u65b0\u63d0\u9192";
    case "text":
    default:
      return `${senderName} \u53d1\u6765\u4e86\u4e00\u6761\u6d88\u606f`;
  }
}

export function pushErrorStatus(error: unknown): number | string {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  return typeof statusCode === "number" ? statusCode : "unknown";
}

export function isGonePushError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}
