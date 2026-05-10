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
      return `${senderName}が画像を送信しました`;
    case "audio":
      return `${senderName}が音声メッセージを送信しました`;
    case "location":
      return `${senderName}が現在地を送信しました`;
    case "system":
      return "家族チャットに新しいお知らせがあります";
    case "text":
    default:
      return `${senderName}から新しいメッセージがあります`;
  }
}

export function isGonePushError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}
