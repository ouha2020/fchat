"use client";

import type { LocalSession } from "@/lib/authLocal";
import { isMessageVisibleToSession } from "@/lib/messageList";
import { getMessageById } from "@/lib/messageService";
import { mergeRealtimeMessage } from "@/lib/messageSync";
import { withTimeout } from "@/lib/timeout";
import type { Message } from "@/types/message";
import { captureMessageCacheContext, isMessageContextCurrent } from "@/lib/messageCacheLifecycle";

const RETRY_DELAYS_MS = [0, 400, 1200] as const;
const REQUEST_TIMEOUT_MS = 3000;

interface NotificationMessageOptions {
  getSession: () => LocalSession | null;
  onMessage: (message: Message) => void;
}

export function createNotificationMessageLoader({
  getSession,
  onMessage,
}: NotificationMessageOptions) {
  const pending = new Map<string, Promise<boolean>>();

  return function loadNotificationMessage(messageId: string): Promise<boolean> {
    const session = getSession();
    if (!session) return Promise.resolve(false);
    const context = captureMessageCacheContext(session);
    // Keep deduplication scoped to the active identity, in memory only.
    const key = JSON.stringify([
      session.family_id, session.member_id, session.member_token, context.version, context.generation, messageId,
    ]);
    const existing = pending.get(key);
    if (existing) return existing;

    const isCurrentSession = () => {
      const current = getSession();
      return isMessageContextCurrent(context) && current?.family_id === session.family_id &&
        current.member_id === session.member_id &&
        current.member_token === session.member_token;
    };

    const request = (async () => {
      for (const delayMs of RETRY_DELAYS_MS) {
        if (!isCurrentSession()) return false;
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (!isCurrentSession()) return false;

        let message: Message | null;
        try {
          message = await withTimeout(
            getMessageById(session, messageId),
            REQUEST_TIMEOUT_MS,
            "notification_message_timeout",
          );
        } catch {
          continue;
        }
        if (!isCurrentSession()) return false;
        if (!message) continue;
        if (message.id !== messageId || message.family_id !== session.family_id ||
            !isMessageVisibleToSession(message, session)) return false;

        // Render before caching, even when IndexedDB is slow or the target
        // falls outside the cache's recent-message window.
        onMessage(message);
        void mergeRealtimeMessage(session, message, context).catch(() => undefined);
        return true;
      }
      return false;
    })().finally(() => pending.delete(key));

    pending.set(key, request);
    return request;
  };
}
