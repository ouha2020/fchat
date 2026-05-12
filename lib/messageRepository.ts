"use client";

import type { LocalSession } from "@/lib/authLocal";
import { clearMessageCacheForSession } from "@/lib/messageCache";
import {
  forceRefreshMessages,
  loadCachedMessagesForSession,
  mergeRealtimeMessage,
  noteMessageCacheOpen,
  syncMessages,
} from "@/lib/messageSync";
import {
  deleteMessage,
  getMessageById,
  sendMessage,
  uploadChatAudio,
  uploadChatImage,
} from "@/lib/messageService";

export {
  clearMessageCacheForSession,
  deleteMessage,
  forceRefreshMessages,
  getMessageById,
  loadCachedMessagesForSession,
  mergeRealtimeMessage,
  noteMessageCacheOpen,
  sendMessage,
  syncMessages,
  uploadChatAudio,
  uploadChatImage,
};

export function clearMessageCacheSilently(session: LocalSession): void {
  clearMessageCacheForSession(session).catch(() => undefined);
}
