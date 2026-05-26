"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import EffectOverlay from "@/components/EffectOverlay";
import EnvWarning from "@/components/EnvWarning";
import ImportantNoticeBar from "@/components/ImportantNoticeBar";
import KeeperRequestSheet from "@/components/KeeperRequestSheet";
import { useLanguage } from "@/components/LanguageProvider";
import { useDialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";
import { clearSession, loadSession, saveSession, type LocalSession } from "@/lib/authLocal";
import {
  cancelAssistantActionCard,
  confirmAssistantActionCard,
  createAssistantActionCard,
  listAssistantActionCards,
} from "@/lib/assistantActionService";
import {
  isAssistantCreateDraft,
  parseAssistantIntent,
  type ParsedAssistantIntent,
  type ScheduleLookupIntent,
} from "@/lib/assistantIntentParser";
import {
  CHAT_BACKGROUND_CHANGED,
  getChatBackground,
  setChatBackground,
} from "@/lib/chatBackground";
import { effectFromColumns, transformForSending, type Effect, detectEffect } from "@/lib/effects";
import { humanizeError } from "@/lib/errors";
import { safeRestoreSession } from "@/lib/familyService";
import { createKeeperRequest } from "@/lib/keeperService";
import {
  dismissImportantNotification,
  getDismissedImportantIds,
  saveDismissedImportantIds,
} from "@/lib/importantNotificationPreference";
import {
  addImportantNotification,
  getImportantNotificationReadState,
  listImportantNotifications,
  removeImportantNotification,
} from "@/lib/importantNotificationService";
import { listMembers } from "@/lib/memberService";
import {
  deleteMessage,
  forceRefreshMessages,
  getMessageById,
  getMessagesByIds,
  loadCachedMessagesForSession,
  markMessagesDelivered,
  markMessagesRead,
  mergeRealtimeMessage,
  mergeRealtimeMessages,
  noteMessageCacheOpen,
  sendMessage,
  syncMessages,
  uploadChatAudio,
  uploadChatImage,
} from "@/lib/messageRepository";
import { getCurrentLocation, createGoogleMapUrl } from "@/lib/locationService";
import {
  installAudioUnlock,
  playNotificationSound,
  vibrate,
} from "@/lib/notify";
import {
  checkPushSubscriptionHealth,
  requestMessagePush,
  updatePushPresence,
} from "@/lib/pushNotificationService";
import { safeGoogleMapsUrl, safeHttpUrl } from "@/lib/security";
import type { RecordingResult } from "@/lib/recordingService";
import {
  getScheduleReminderStatus,
  respondScheduleAssignment,
  searchScheduleItems,
  setScheduleItemStatus,
  snoozeScheduleReminder,
} from "@/lib/scheduleService";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { withTimeout } from "@/lib/timeout";
import { usePushNotificationControls } from "@/lib/usePushNotificationControls";
import type {
  ImportantNotification,
  ImportantNotificationReadState,
} from "@/types/importantNotification";
import type {
  AssistantActionCard,
  CreateAssistantActionCardInput,
} from "@/types/assistant";
import type { CreateKeeperRequestInput } from "@/types/keeper";
import type { FamilyMember } from "@/types/member";
import type { Message } from "@/types/message";
import type { ScheduleItem } from "@/types/schedule";

const MESSAGE_FALLBACK_POLL_MS = 30_000;
const IMPORTANT_FALLBACK_POLL_MS = 30_000;
const METADATA_FALLBACK_POLL_MS = 120_000;
const INITIAL_CACHED_MESSAGE_LIMIT = 100;
const CACHED_MESSAGE_PAGE_SIZE = 100;
const PUSH_MESSAGE_DEDUPE_MS = 5_000;
const REALTIME_BACKGROUND_DISCONNECT_MS = 45_000;
const REALTIME_BATCH_FLUSH_MS = 150;
const MESSAGE_DELIVERED_REPORT_DELAY_MS = 500;
const MESSAGE_READ_REPORT_DELAY_MS = 700;
const CHAT_BOOTSTRAP_DATA_TIMEOUT_MS = 15_000;
const ASSISTANT_REPLY_DELAY_MS = 850;
const MESSAGE_ACTION_MENU_MARGIN = 8;
const MESSAGE_ACTION_MENU_FALLBACK_WIDTH = 176;
const MESSAGE_ACTION_MENU_FALLBACK_HEIGHT = 220;
const MESSAGE_ACTION_MENU_MIN_VISIBLE_HEIGHT = 112;
const chatHeaderIconClass =
  "native-icon-button native-press inline-flex h-11 w-11 shrink-0 overflow-hidden rounded-[15px] bg-white bg-cover bg-center bg-no-repeat ring-1 ring-white/80 hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200";
const chatActionMenuButtonClass =
  "block min-h-11 w-full whitespace-normal break-words px-4 py-2.5 text-left text-sm font-medium leading-5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset";

interface MessageRealtimeEvent {
  id: string;
  family_id: string;
  message_id: string;
  recipient_member_id: string | null;
  event_type: "insert" | "update";
  created_at: string;
}

interface ImportantNotificationRealtimeEvent {
  id: string;
  family_id: string;
  notification_id: string;
  message_id: string;
  event_type: "add" | "remove";
  created_at: string;
}

interface AssistantReplyPending {
  sourceMessageId: string;
  startedAt: number;
}

interface MessageActionMenuState {
  messageId: string;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  maxHeight: number;
}

interface ScheduleRealtimeEvent {
  id: string;
  family_id: string;
  schedule_item_id: string;
  recipient_member_id: string;
  event_type: "created" | "updated" | "status_changed" | "deleted" | "reminder_updated";
  created_at: string;
}

interface PushReceivedMessage {
  type?: string;
  familyId?: string | null;
  messageId?: string | null;
  scheduleItemId?: string | null;
  oldEndpoint?: string | null;
  newEndpoint?: string | null;
  endpoint?: string | null;
}

function scheduleAttentionStorageKey(session: Pick<LocalSession, "family_id" | "member_id">): string {
  return `family-chat:schedule-attention:${session.family_id}:${session.member_id}`;
}

function readScheduleAttentionDot(session: Pick<LocalSession, "family_id" | "member_id">): boolean {
  try {
    return window.localStorage.getItem(scheduleAttentionStorageKey(session)) === "1";
  } catch {
    return false;
  }
}

function writeScheduleAttentionDot(
  session: Pick<LocalSession, "family_id" | "member_id">,
  active: boolean,
) {
  try {
    const key = scheduleAttentionStorageKey(session);
    if (active) {
      window.localStorage.setItem(key, "1");
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Local attention state is only a visual hint.
  }
}

function isAssistantCardSystemMessage(message: Message): boolean {
  const payload = message.system_event_payload ?? {};
  return (
    message.message_type === "system" &&
    (message.system_event_type === "assistant_card_created" ||
      message.system_event_type === "assistant_card_confirmed" ||
      message.system_event_type === "assistant_card_cancelled" ||
      (payload.actor_type === "assistant" &&
        typeof payload.card_id === "string" &&
        typeof payload.status === "string"))
  );
}

function isAssistantScheduleActionDoneMessage(message: Message): boolean {
  const payload = message.system_event_payload ?? {};
  return (
    message.message_type === "system" &&
    message.system_event_type === "assistant_action_done" &&
    payload.actor_type === "assistant" &&
    typeof payload.schedule_item_id === "string"
  );
}

function isMessageVisibleToSession(
  message: Message,
  activeSession: LocalSession,
): boolean {
  if (isAssistantCardSystemMessage(message)) {
    return message.sender_member_id === activeSession.member_id;
  }
  if (
    isAssistantScheduleActionDoneMessage(message) &&
    !message.recipient_member_id
  ) {
    return message.sender_member_id === activeSession.member_id;
  }
  return (
    !message.recipient_member_id ||
    message.sender_member_id === activeSession.member_id ||
    message.recipient_member_id === activeSession.member_id
  );
}

function filterVisibleMessages(
  rows: Message[],
  activeSession: LocalSession,
): Message[] {
  return rows.filter((message) =>
    isMessageVisibleToSession(message, activeSession),
  );
}

function closeMessageNotifications({
  familyId,
  messageIds,
  closeAllForFamily = false,
}: {
  familyId: string;
  messageIds?: string[];
  closeAllForFamily?: boolean;
}): void {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  const cleanMessageIds = (messageIds ?? []).filter(Boolean);
  if (!closeAllForFamily && cleanMessageIds.length === 0) return;

  const payload = {
    type: "family-chat:close-notifications",
    familyId,
    messageIds: cleanMessageIds,
    closeAllForFamily,
  };

  const controller = navigator.serviceWorker.controller;
  if (controller) {
    controller.postMessage(payload);
    return;
  }

  navigator.serviceWorker.ready
    .then((registration) => {
      registration.active?.postMessage(payload);
    })
    .catch(() => undefined);
}

function sortMessagesByCreatedAt(rows: Message[]): Message[] {
  return [...rows].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
      a.id.localeCompare(b.id),
  );
}

function isRealtimeProblemStatus(status: string): boolean {
  return status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED";
}

function mergeMessagesById(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return sortMessagesByCreatedAt([...byId.values()]);
}

function hasAssistantCardMessage(rows: Message[]): boolean {
  return rows.some(isAssistantCardSystemMessage);
}

function latestOrdinaryVisibleMessage(rows: Message[], currentMessageId?: string): Message | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const message = rows[index];
    if (!message || message.id === currentMessageId) continue;
    if (message.deleted_at) continue;
    if (message.recipient_member_id) continue;
    if (message.message_type === "system") continue;
    return message;
  }
  return null;
}

function getCopyableMessageText(message: Message): string | null {
  if (message.deleted_at) return null;
  if (message.message_type === "text") {
    const text = message.content?.trim();
    return text || null;
  }
  if (message.message_type === "location") {
    const mapUrl =
      safeGoogleMapsUrl(message.map_url) ??
      (message.latitude != null && message.longitude != null
        ? createGoogleMapUrl(message.latitude, message.longitude)
        : null);
    const parts = [message.address?.trim(), mapUrl].filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("copy_failed");
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function getMessageActionMenuPlacement({
  anchorX,
  anchorY,
  menuElement,
  composerElement,
}: {
  anchorX: number;
  anchorY: number;
  menuElement?: HTMLElement | null;
  composerElement?: HTMLElement | null;
}): Pick<MessageActionMenuState, "x" | "y" | "maxHeight"> {
  if (typeof window === "undefined") {
    return {
      x: anchorX,
      y: anchorY,
      maxHeight: MESSAGE_ACTION_MENU_FALLBACK_HEIGHT,
    };
  }

  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;

  const safeLeft = viewportLeft + MESSAGE_ACTION_MENU_MARGIN;
  const safeTop = viewportTop + MESSAGE_ACTION_MENU_MARGIN;
  const safeRight = Math.max(
    safeLeft,
    viewportRight - MESSAGE_ACTION_MENU_MARGIN,
  );
  let safeBottom = Math.max(
    safeTop,
    viewportBottom - MESSAGE_ACTION_MENU_MARGIN,
  );

  const composerRect = composerElement?.getBoundingClientRect();
  if (composerRect) {
    const composerTop = composerRect.top;
    const composerBottom = composerRect.bottom;
    const composerIntersectsViewport =
      composerBottom > safeTop && composerTop < viewportBottom;
    const bottomAboveComposer = composerTop - MESSAGE_ACTION_MENU_MARGIN;
    if (
      composerIntersectsViewport &&
      bottomAboveComposer - safeTop >= MESSAGE_ACTION_MENU_MIN_VISIBLE_HEIGHT
    ) {
      safeBottom = Math.min(safeBottom, bottomAboveComposer);
    }
  }

  const availableWidth = Math.max(
    MESSAGE_ACTION_MENU_FALLBACK_WIDTH,
    safeRight - safeLeft,
  );
  const menuWidth = Math.min(
    Math.max(
      menuElement?.offsetWidth ?? MESSAGE_ACTION_MENU_FALLBACK_WIDTH,
      MESSAGE_ACTION_MENU_FALLBACK_WIDTH,
    ),
    availableWidth,
  );
  const availableHeight = Math.max(
    MESSAGE_ACTION_MENU_MIN_VISIBLE_HEIGHT,
    safeBottom - safeTop,
  );
  const menuHeight = Math.min(
    menuElement?.offsetHeight ?? MESSAGE_ACTION_MENU_FALLBACK_HEIGHT,
    availableHeight,
  );

  return {
    x: Math.round(
      clampNumber(anchorX, safeLeft, Math.max(safeLeft, safeRight - menuWidth)),
    ),
    y: Math.round(
      clampNumber(anchorY, safeTop, Math.max(safeTop, safeBottom - menuHeight)),
    ),
    maxHeight: Math.floor(availableHeight),
  };
}

function removeWhisperParamFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("whisper");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function setWhisperParamInUrl(memberId: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("whisper", memberId);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function removeKeeperParamFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("keeper");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function setKeeperParamInUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("keeper", "1");
  url.searchParams.delete("whisper");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function keeperDraftFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const triggers = [
    "@家庭助理",
    "家庭助理",
    "@おうちアシスタント",
    "おうちアシスタント",
    "@Home Assistant",
    "Home Assistant",
    "@おうち係",
    "おうち係",
    "小管家",
    "家庭管家",
  ];
  const trigger = triggers.find((item) => trimmed.startsWith(item));
  if (!trigger) return null;
  return trimmed.slice(trigger.length).replace(/^[\s,，、:：]+/, "").trim();
}

function assistantDraftFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const triggers = [
    "@家庭助理",
    "家庭助理",
    "@家庭管家",
    "家庭管家",
    "@小管家",
    "小管家",
    "@おうちアシスタント",
    "おうちアシスタント",
    "@ホームアシスタント",
    "ホームアシスタント",
    "@Home Assistant",
    "Home Assistant",
  ];
  const trigger = triggers.find((item) => trimmed.startsWith(item));
  if (!trigger) return null;
  return trimmed.slice(trigger.length).replace(/^[\s,，、。:：]+/, "").trim();
}

function shouldKeepAssistantDraftPrivate(
  draft: ParsedAssistantIntent | null,
): boolean {
  if (!draft) return false;
  if ("reason" in draft && draft.reason === "schedule_lookup") return true;
  if (!isAssistantCreateDraft(draft) || draft.reason) return false;
  return [
    "reminder",
    "schedule",
    "todo",
    "schedule_update",
    "schedule_cancel",
  ].includes(draft.card_type);
}

function buildScheduleChangeCardInput(
  item: ScheduleItem,
  lookup: ScheduleLookupIntent,
  language: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): CreateAssistantActionCardInput {
  if (lookup.action === "cancel") {
    return {
      card_type: "schedule_cancel",
      title: item.title,
      summary: t("assistantScheduleCancelSummary", { title: item.title }),
      payload: {
        action: "cancel",
        schedule_item_id: item.id,
        original_text: lookup.originalText,
        source: "rule-parser",
        visibility: item.visibility,
      },
    };
  }

  const newStartsAt = lookup.newStartsAt ?? item.starts_at;
  const newEndsAt = shiftEndTime(item.starts_at, item.ends_at, newStartsAt);
  const newRemindAt = shiftReminderTime(item.starts_at, item.remind_at, newStartsAt);
  return {
    card_type: "schedule_update",
    title: item.title,
    summary: t("assistantScheduleUpdateSummary", {
      from: formatAssistantDateTime(item.starts_at, language),
      to: formatAssistantDateTime(newStartsAt, language),
    }),
    payload: {
      action: "update",
      schedule_item_id: item.id,
      title: item.title,
      note: item.note,
      item_type: item.item_type,
      visibility: item.visibility,
      assignee_member_id: item.assignee_member_id,
      starts_at: newStartsAt,
      ends_at: newEndsAt,
      remind_at: newRemindAt,
      original_text: lookup.originalText,
      source: "rule-parser",
    },
  };
}

function shiftEndTime(
  oldStartsAt: string,
  oldEndsAt: string | null,
  newStartsAt: string,
): string | null {
  if (!oldEndsAt) return null;
  const duration = new Date(oldEndsAt).getTime() - new Date(oldStartsAt).getTime();
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return new Date(new Date(newStartsAt).getTime() + duration).toISOString();
}

function shiftReminderTime(
  oldStartsAt: string,
  oldRemindAt: string | null,
  newStartsAt: string,
): string | null {
  if (!oldRemindAt) return null;
  const offset = new Date(oldStartsAt).getTime() - new Date(oldRemindAt).getTime();
  if (!Number.isFinite(offset) || offset < 0) return null;
  return new Date(new Date(newStartsAt).getTime() - offset).toISOString();
}

function formatAssistantDateTime(value: string, language: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : language, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function assistantScheduleItemId(card: AssistantActionCard): string | null {
  if (card.result_schedule_item_id) return card.result_schedule_item_id;
  const payloadItemId = card.payload.schedule_item_id;
  return typeof payloadItemId === "string" && payloadItemId ? payloadItemId : null;
}

function AssistantReplyPendingBubble() {
  const { t } = useLanguage();
  return (
    <div className="flex w-full gap-2 py-1" aria-live="polite">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700 shadow-sm ring-1 ring-white/80 sm:h-9 sm:w-9 sm:text-base">
        家
      </div>
      <div className="flex min-w-0 max-w-[78%] flex-col items-start gap-1 sm:max-w-md">
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-1.5 text-[11px] leading-4 text-slate-500">
          <span className="truncate font-medium text-slate-700">
            {t("assistantName")}
          </span>
        </div>
        <div className="min-h-[112px] min-w-[11rem] rounded-[22px] bg-white/95 px-3.5 py-2.5 text-sm text-slate-700 shadow-[0_10px_26px_rgba(47,83,67,0.08)] ring-1 ring-white/80">
          <div className="flex items-center gap-2">
            <span className="font-medium">{t("assistantThinking")}</span>
            <span className="flex items-center gap-1" aria-hidden>
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400" />
            </span>
          </div>
          <div className="mt-4 space-y-2" aria-hidden>
            <span className="block h-2 w-28 animate-pulse rounded-full bg-emerald-100" />
            <span className="block h-2 w-20 animate-pulse rounded-full bg-slate-100" />
            <span className="block h-8 w-32 animate-pulse rounded-full bg-slate-50 ring-1 ring-slate-100" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatLoadingState() {
  const { t } = useLanguage();
  return (
    <div
      className="chat-paper-bg flex flex-col items-center justify-center px-6 text-center"
      style={{ height: "var(--chat-viewport-height, 100dvh)" }}
      role="status"
      aria-live="polite"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-base font-black text-emerald-700 shadow-sm ring-1 ring-white/80">
        家
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-700">
        {t("commonLoading")}
      </p>
      <div className="mt-3 flex items-center justify-center gap-1.5" aria-hidden>
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-0.2s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-0.1s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400" />
      </div>
    </div>
  );
}

function ChatLoadErrorState({
  message,
  onRetry,
  onBackHome,
}: {
  message: string;
  onRetry: () => void;
  onBackHome: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div
      className="chat-paper-bg flex items-center justify-center px-5 py-8"
      style={{ minHeight: "var(--chat-viewport-height, 100dvh)" }}
    >
      <section
        className="w-full max-w-sm rounded-[28px] bg-white/[0.92] p-5 text-center shadow-[0_18px_44px_rgba(70,62,48,0.12)] ring-1 ring-white/80"
        role="alert"
      >
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-base font-black text-rose-600 ring-1 ring-rose-100">
          !
        </div>
        <h1 className="mt-3 text-lg font-bold leading-7 text-slate-950">
          {t("chatLoadFailedTitle")}
        </h1>
        <p className="mt-2 break-words text-sm leading-6 text-slate-600">
          {message}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            className="btn-primary native-press min-h-11 w-full"
            onClick={onRetry}
          >
            {t("chatRetry")}
          </button>
          <button
            type="button"
            className="btn-secondary native-press min-h-11 w-full"
            onClick={onBackHome}
          >
            {t("chatBackHome")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ChatEmptyState() {
  const { t } = useLanguage();
  return (
    <div
      className="mx-auto flex w-full max-w-xs flex-col items-center justify-center px-5 py-10 text-center"
      role="status"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-base font-black text-emerald-700 shadow-sm ring-1 ring-white/80">
        家
      </div>
      <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
        {t("chatEmpty")}
      </p>
    </div>
  );
}

function OlderMessagesLoadingIndicator() {
  const { t } = useLanguage();
  return (
    <div
      className="flex justify-center pb-2"
      role="status"
      aria-label={t("commonLoading")}
    >
      <span className="inline-flex h-6 items-center gap-1 rounded-full bg-white/80 px-3 shadow-sm ring-1 ring-white/70">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-300 [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-300 [animation-delay:240ms]" />
      </span>
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const dialog = useDialog();
  const toast = useToast();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [whisperTargetId, setWhisperTargetId] = useState<string | null>(null);
  const [keeperMode, setKeeperMode] = useState(false);
  const [keeperDraftText, setKeeperDraftText] = useState<string | null>(null);
  const [keeperSubmitting, setKeeperSubmitting] = useState(false);
  const [importantNotifications, setImportantNotifications] = useState<
    ImportantNotification[]
  >([]);
  const [importantReadStates, setImportantReadStates] = useState<
    Map<string, ImportantNotificationReadState>
  >(() => new Map());
  const [assistantCards, setAssistantCards] = useState<AssistantActionCard[]>([]);
  const [assistantSubmittingCardId, setAssistantSubmittingCardId] =
    useState<string | null>(null);
  const [assistantReplyPending, setAssistantReplyPending] =
    useState<AssistantReplyPending | null>(null);
  const [scheduleAttentionDot, setScheduleAttentionDot] = useState(false);
  const [dismissedImportantIds, setDismissedImportantIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(
    null,
  );
  const [messageActionMenu, setMessageActionMenu] =
    useState<MessageActionMenuState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [chatBackgroundUrl, setChatBackgroundUrl] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageActionMenuPanelRef = useRef<HTMLDivElement>(null);
  const messageActionMenuStateRef = useRef<MessageActionMenuState | null>(null);
  const messageActionMenuReturnFocusRef = useRef<HTMLElement | null>(null);
  const chatComposerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastHeaderTapRef = useRef(0);
  const pullStartYRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const forceImmediateBottomScrollRef = useRef(false);
  const cachedMessageLimitRef = useRef(INITIAL_CACHED_MESSAGE_LIMIT);
  const loadingOlderMessagesRef = useRef(false);
  const preserveScrollRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  const suppressBottomScrollUntilRef = useRef(0);
  const bottomScrollTimeoutsRef = useRef<number[]>([]);
  const isIOSRef = useRef(false);
  const membersRef = useRef<FamilyMember[]>([]);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);
  const messagesRef = useRef<Message[]>([]);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    messagesRef.current = messages;
    knownMessageIdsRef.current = new Set(messages.map((message) => message.id));
  }, [messages]);
  const pendingRealtimeMessageIdsRef = useRef<Set<string>>(new Set());
  const realtimeBatchTimerRef = useRef<number | null>(null);
  const pendingPushMessageIdsRef = useRef<Map<string, number>>(new Map());
  const pendingDeliveredMessageIdsRef = useRef<Set<string>>(new Set());
  const pendingReadMessageIdsRef = useRef<Set<string>>(new Set());
  const reportedDeliveredMessageIdsRef = useRef<Set<string>>(new Set());
  const loadingImportantReadStateIdsRef = useRef<Set<string>>(new Set());
  const reportedReadMessageIdsRef = useRef<Set<string>>(new Set());
  const deliveredReportTimerRef = useRef<number | null>(null);
  const readReportTimerRef = useRef<number | null>(null);
  const [effectShow, setEffectShow] = useState<{
    effect: Effect;
    key: string;
  } | null>(null);
  const triggeredEffectIdsRef = useRef<Set<string>>(new Set());
  const handleEffectDone = useCallback(() => setEffectShow(null), []);
  const tryTriggerEffect = useCallback((messageId: string, eff: Effect | null) => {
    if (!eff) return;
    if (triggeredEffectIdsRef.current.has(messageId)) return;
    triggeredEffectIdsRef.current.add(messageId);
    // Unique key per trigger forces React to unmount the previous overlay
    // so the CSS keyframes restart from 0.
    setEffectShow({ effect: eff, key: `${messageId}-${Date.now()}` });
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = messageRefs.current.get(messageId);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => {
      setHighlightedMessageId((current) =>
        current === messageId ? null : current,
      );
    }, 3000);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
      chatViewportHeight: html.style.getPropertyValue("--chat-viewport-height"),
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
    };
    const visualViewport = window.visualViewport;

    isIOSRef.current =
      /iP(ad|hone|od)/.test(window.navigator.userAgent) ||
      (window.navigator.platform === "MacIntel" &&
        window.navigator.maxTouchPoints > 1);

    let viewportFrame = 0;
    let orientationTimer = 0;
    let lastViewportHeight = 0;

    const applyViewportHeight = () => {
      viewportFrame = 0;
      const rawHeight = visualViewport?.height ?? window.innerHeight;
      const height = Math.max(320, Math.round(rawHeight));
      if (height === lastViewportHeight) return;
      lastViewportHeight = height;
      html.style.setProperty("--chat-viewport-height", `${height}px`);
    };

    const updateViewportHeight = () => {
      if (viewportFrame) window.cancelAnimationFrame(viewportFrame);
      viewportFrame = window.requestAnimationFrame(applyViewportHeight);
    };

    const updateAfterOrientationChange = () => {
      updateViewportHeight();
      if (orientationTimer) window.clearTimeout(orientationTimer);
      orientationTimer = window.setTimeout(updateViewportHeight, 250);
    };

    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.height = "var(--chat-viewport-height, 100dvh)";
    body.style.overscrollBehavior = "none";
    updateViewportHeight();
    visualViewport?.addEventListener("resize", updateViewportHeight);
    visualViewport?.addEventListener("scroll", updateViewportHeight);
    window.addEventListener("resize", updateViewportHeight);
    window.addEventListener("orientationchange", updateAfterOrientationChange);

    return () => {
      bottomScrollTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      bottomScrollTimeoutsRef.current = [];
      if (viewportFrame) window.cancelAnimationFrame(viewportFrame);
      if (orientationTimer) window.clearTimeout(orientationTimer);
      visualViewport?.removeEventListener("resize", updateViewportHeight);
      visualViewport?.removeEventListener("scroll", updateViewportHeight);
      window.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener(
        "orientationchange",
        updateAfterOrientationChange,
      );
      if (previous.chatViewportHeight) {
        html.style.setProperty(
          "--chat-viewport-height",
          previous.chatViewportHeight,
        );
      } else {
        html.style.removeProperty("--chat-viewport-height");
      }
      html.style.overflow = previous.htmlOverflow;
      html.style.overscrollBehavior = previous.htmlOverscrollBehavior;
      body.style.overflow = previous.bodyOverflow;
      body.style.height = previous.bodyHeight;
      body.style.overscrollBehavior = previous.bodyOverscrollBehavior;
    };
  }, []);

  const handleReplayEffect = useCallback((m: Message) => {
    const eff = effectFromColumns(m.effect_id, m.effect_caption);
    if (!eff) return;
    // Brand new key forces EffectOverlay to unmount + remount, restarting
    // the CSS keyframes from frame 0 (same trick as the initial trigger).
    setEffectShow({ effect: eff, key: `replay-${m.id}-${Date.now()}` });
  }, []);

  const push = usePushNotificationControls(session);

  // Notifications: background sound + title badge, controlled by the PWA push switch.
  const [unreadCount, setUnreadCount] = useState(0);
  const pushEnabledRef = useRef(false);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  // Prune notifiedIdsRef periodically to prevent unbounded growth.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const set = notifiedIdsRef.current;
      if (set.size > 200) {
        const entries = [...set];
        const keep = entries.slice(entries.length - 200);
        notifiedIdsRef.current = new Set(keep);
      }
    }, 300_000);
    return () => window.clearInterval(interval);
  }, []);
  const sessionRef = useRef<LocalSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    if (!session) {
      setScheduleAttentionDot(false);
      return;
    }
    setScheduleAttentionDot(readScheduleAttentionDot(session));
  }, [session]);
  useEffect(() => {
    pushEnabledRef.current = push.enabled;
  }, [push.enabled]);

  const markScheduleAttention = useCallback((activeSession?: LocalSession | null) => {
    const targetSession = activeSession ?? sessionRef.current;
    if (!targetSession) return;
    setScheduleAttentionDot(true);
    writeScheduleAttentionDot(targetSession, true);
  }, []);

  const clearScheduleAttention = useCallback(() => {
    const targetSession = sessionRef.current;
    if (!targetSession) return;
    setScheduleAttentionDot(false);
    writeScheduleAttentionDot(targetSession, false);
  }, []);

  const handleIncomingMessageSideEffects = useCallback(
    (incoming: Message) => {
      const eff =
        effectFromColumns(incoming.effect_id, incoming.effect_caption) ??
        (incoming.message_type === "text" ? detectEffect(incoming.content) : null);
      tryTriggerEffect(incoming.id, eff);

      const activeSession = sessionRef.current;
      if (
        activeSession &&
        incoming.sender_member_id &&
        !membersRef.current.some((m) => m.id === incoming.sender_member_id)
      ) {
        listMembers(activeSession, { includeRemoved: true })
          .then(setMembers)
          .catch(() => undefined);
      }

      if (
        activeSession &&
        incoming.sender_member_id &&
        incoming.sender_member_id !== activeSession.member_id &&
        incoming.message_type !== "system" &&
        !incoming.deleted_at &&
        pushEnabledRef.current &&
        !notifiedIdsRef.current.has(incoming.id)
      ) {
        notifiedIdsRef.current.add(incoming.id);
        if (typeof document !== "undefined" && document.hidden) {
          playNotificationSound();
          setUnreadCount((c) => c + 1);
          vibrate(120);
        }
      }
    },
    [tryTriggerEffect],
  );

  const handleSyncedMessages = useCallback(
    (next: Message[]) => {
      const activeSession = sessionRef.current;
      const visible = activeSession
        ? filterVisibleMessages(next, activeSession)
        : next;
      const knownIds = knownMessageIdsRef.current;
      const unseenMessages = visible.filter((message) => !knownIds.has(message.id));
      setMessages((prev) => mergeMessagesById(prev, visible));
      unseenMessages.forEach(handleIncomingMessageSideEffects);
      if (activeSession && hasAssistantCardMessage(visible)) {
        listAssistantActionCards(activeSession)
          .then(setAssistantCards)
          .catch(() => undefined);
      }
    },
    [handleIncomingMessageSideEffects],
  );

  const flushDeliveredReports = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;

    const ids = [...pendingDeliveredMessageIdsRef.current].slice(0, 300);
    ids.forEach((id) => pendingDeliveredMessageIdsRef.current.delete(id));
    if (ids.length === 0) return;

    try {
      await markMessagesDelivered(activeSession, ids);
    } catch {
      ids.forEach((id) => reportedDeliveredMessageIdsRef.current.delete(id));
    } finally {
      if (
        pendingDeliveredMessageIdsRef.current.size > 0 &&
        !deliveredReportTimerRef.current
      ) {
        deliveredReportTimerRef.current = window.setTimeout(() => {
          deliveredReportTimerRef.current = null;
          flushDeliveredReports().catch(() => undefined);
        }, MESSAGE_DELIVERED_REPORT_DELAY_MS);
      }
    }
  }, []);

  const scheduleDeliveredReports = useCallback(
    (candidates: Message[]) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;

      candidates.forEach((message) => {
        if (message.sender_member_id === activeSession.member_id) return;
        if (reportedDeliveredMessageIdsRef.current.has(message.id)) return;
        if (!isMessageVisibleToSession(message, activeSession)) return;
        reportedDeliveredMessageIdsRef.current.add(message.id);
        pendingDeliveredMessageIdsRef.current.add(message.id);
      });

      if (
        pendingDeliveredMessageIdsRef.current.size === 0 ||
        deliveredReportTimerRef.current
      ) {
        return;
      }

      deliveredReportTimerRef.current = window.setTimeout(() => {
        deliveredReportTimerRef.current = null;
        flushDeliveredReports().catch(() => undefined);
      }, MESSAGE_DELIVERED_REPORT_DELAY_MS);
    },
    [flushDeliveredReports],
  );

  const flushReadReports = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;

    const ids = [...pendingReadMessageIdsRef.current].slice(0, 300);
    ids.forEach((id) => pendingReadMessageIdsRef.current.delete(id));
    if (ids.length === 0) return;

    try {
      await markMessagesRead(activeSession, ids);
      closeMessageNotifications({
        familyId: activeSession.family_id,
        messageIds: ids,
      });
    } catch {
      ids.forEach((id) => reportedReadMessageIdsRef.current.delete(id));
    } finally {
      if (pendingReadMessageIdsRef.current.size > 0 && !readReportTimerRef.current) {
        readReportTimerRef.current = window.setTimeout(() => {
          readReportTimerRef.current = null;
          flushReadReports().catch(() => undefined);
        }, MESSAGE_READ_REPORT_DELAY_MS);
      }
    }
  }, []);

  const scheduleReadReports = useCallback(
    (candidates: Message[]) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      if (document.visibilityState !== "visible") return;
      if (window.location.pathname !== "/chat") return;

      candidates.forEach((message) => {
        if (message.sender_member_id === activeSession.member_id) return;
        if (reportedReadMessageIdsRef.current.has(message.id)) return;
        if (!isMessageVisibleToSession(message, activeSession)) return;
        reportedReadMessageIdsRef.current.add(message.id);
        pendingReadMessageIdsRef.current.add(message.id);
      });

      if (pendingReadMessageIdsRef.current.size === 0 || readReportTimerRef.current) {
        return;
      }

      readReportTimerRef.current = window.setTimeout(() => {
        readReportTimerRef.current = null;
        flushReadReports().catch(() => undefined);
      }, MESSAGE_READ_REPORT_DELAY_MS);
    },
    [flushReadReports],
  );

  useEffect(() => {
    if (!session || messages.length === 0) return;
    scheduleDeliveredReports(messages);
    scheduleReadReports(messages);
  }, [messages, scheduleDeliveredReports, scheduleReadReports, session]);

  useEffect(() => {
    if (!session) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      scheduleReadReports(messagesRef.current);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [scheduleReadReports, session]);

  useEffect(() => {
    if (!session) return;

    const closeCurrentFamilyNotifications = () => {
      if (document.visibilityState !== "visible") return;
      if (window.location.pathname !== "/chat") return;
      closeMessageNotifications({
        familyId: session.family_id,
        closeAllForFamily: true,
      });
    };

    closeCurrentFamilyNotifications();
    document.addEventListener("visibilitychange", closeCurrentFamilyNotifications);
    window.addEventListener("focus", closeCurrentFamilyNotifications);
    return () => {
      document.removeEventListener(
        "visibilitychange",
        closeCurrentFamilyNotifications,
      );
      window.removeEventListener("focus", closeCurrentFamilyNotifications);
    };
  }, [session]);

  useEffect(() => {
    const pendingDeliveredMessageIds = pendingDeliveredMessageIdsRef.current;
    const pendingReadMessageIds = pendingReadMessageIdsRef.current;
    return () => {
      if (deliveredReportTimerRef.current) {
        window.clearTimeout(deliveredReportTimerRef.current);
        deliveredReportTimerRef.current = null;
      }
      if (readReportTimerRef.current) {
        window.clearTimeout(readReportTimerRef.current);
        readReportTimerRef.current = null;
      }
      pendingDeliveredMessageIds.clear();
      pendingReadMessageIds.clear();
    };
  }, []);

  const fetchRealtimeMessage = useCallback(
    async (messageId: string): Promise<boolean> => {
      const activeSession = sessionRef.current;
      if (!activeSession) return false;
      const incoming = await getMessageById(activeSession, messageId);
      if (!incoming) return false;
      if (!isMessageVisibleToSession(incoming, activeSession)) return false;
      const next = await mergeRealtimeMessage(activeSession, incoming);
      handleSyncedMessages(next);
      return true;
    },
    [handleSyncedMessages],
  );

  const flushRealtimeMessages = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;

    const pendingIds = pendingRealtimeMessageIdsRef.current;
    const messageIds = [...pendingIds].slice(0, 100);
    messageIds.forEach((id) => pendingIds.delete(id));
    if (messageIds.length === 0) return;

    try {
      const incoming = await getMessagesByIds(activeSession, messageIds);
      const visible = incoming.filter((message) =>
        isMessageVisibleToSession(message, activeSession),
      );
      if (visible.length === 0) return;

      const next = await mergeRealtimeMessages(activeSession, visible);
      handleSyncedMessages(next);
    } catch {
      if (document.visibilityState !== "visible") return;
      await syncMessages(activeSession, { onMessages: handleSyncedMessages }).catch(
        () => undefined,
      );
    } finally {
      if (pendingIds.size > 0 && !realtimeBatchTimerRef.current) {
        realtimeBatchTimerRef.current = window.setTimeout(() => {
          realtimeBatchTimerRef.current = null;
          flushRealtimeMessages().catch(() => undefined);
        }, REALTIME_BATCH_FLUSH_MS);
      }
    }
  }, [handleSyncedMessages]);

  const scheduleRealtimeBatchFetch = useCallback(
    (messageId: string) => {
      pendingRealtimeMessageIdsRef.current.add(messageId);
      if (realtimeBatchTimerRef.current) {
        window.clearTimeout(realtimeBatchTimerRef.current);
      }
      realtimeBatchTimerRef.current = window.setTimeout(() => {
        realtimeBatchTimerRef.current = null;
        flushRealtimeMessages().catch(() => undefined);
      }, REALTIME_BATCH_FLUSH_MS);
    },
    [flushRealtimeMessages],
  );

  const fetchPushMessageNow = useCallback(
    async (messageId: string, scrollAfterFetch = false) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;

      const now = Date.now();
      const pending = pendingPushMessageIdsRef.current;
      pending.forEach((expiresAt, id) => {
        if (expiresAt <= now) pending.delete(id);
      });

      const existing = pending.get(messageId);
      if (existing && existing > now) return;
      pending.set(messageId, now + PUSH_MESSAGE_DEDUPE_MS);

      try {
        const fetched = await fetchRealtimeMessage(messageId);
        if (!fetched) {
          await syncMessages(activeSession, { onMessages: handleSyncedMessages });
        }
        if (scrollAfterFetch) {
          window.setTimeout(() => scrollToMessage(messageId), 120);
        }
      } finally {
        window.setTimeout(() => {
          const expiresAt = pending.get(messageId);
          if (expiresAt && expiresAt <= Date.now()) pending.delete(messageId);
        }, PUSH_MESSAGE_DEDUPE_MS);
      }
    },
    [fetchRealtimeMessage, handleSyncedMessages, scrollToMessage],
  );

  useEffect(() => {
    if (!session) return;
    if (!("serviceWorker" in navigator)) return;

    const syncVisibleMessages = () => {
      if (document.visibilityState !== "visible") return;
      syncMessages(session, { onMessages: handleSyncedMessages }).catch(
        () => undefined,
      );
    };

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as PushReceivedMessage | null;
      if (!data) return;

      if (data.type === "family-chat:subscription-changed") {
        void checkPushSubscriptionHealth(session).catch(() => undefined);
        return;
      }
      if (data.type === "family-chat:subscription-expired") {
        void checkPushSubscriptionHealth(session).catch(() => undefined);
        return;
      }
      if (data.type === "family-chat:schedule-reminder") {
        if (data.familyId && data.familyId !== session.family_id) return;
        markScheduleAttention(session);
        return;
      }
      if (data.type !== "family-chat:push-received") return;
      if (data.familyId !== session.family_id) return;
      if (window.location.pathname !== "/chat") return;

      if (data.messageId) {
        fetchPushMessageNow(data.messageId).catch(syncVisibleMessages);
        return;
      }

      syncVisibleMessages();
    };

    navigator.serviceWorker.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );
    return () => {
      navigator.serviceWorker.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
    };
  }, [fetchPushMessageNow, handleSyncedMessages, markScheduleAttention, session]);

  useEffect(() => {
    if (!session) return;

    const markCurrentPresence = (keepalive = false) => {
      updatePushPresence(
        session,
        document.visibilityState === "visible",
        keepalive,
        "chat",
      );
    };
    const markActive = () => {
      if (document.visibilityState !== "visible") return;
      updatePushPresence(session, true, false, "chat");
    };

    markCurrentPresence();
    const interval = window.setInterval(() => {
      markCurrentPresence();
    }, 30_000);

    const markVisibility = () => {
      markCurrentPresence(document.visibilityState !== "visible");
    };
    const markInactive = () => {
      updatePushPresence(session, false, true, "chat");
    };

    document.addEventListener("visibilitychange", markVisibility);
    window.addEventListener("focus", markActive);
    window.addEventListener("online", markActive);
    window.addEventListener("pagehide", markInactive);
    window.addEventListener("beforeunload", markInactive);
    return () => {
      window.clearInterval(interval);
      markInactive();
      document.removeEventListener("visibilitychange", markVisibility);
      window.removeEventListener("focus", markActive);
      window.removeEventListener("online", markActive);
      window.removeEventListener("pagehide", markInactive);
      window.removeEventListener("beforeunload", markInactive);
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      setChatBackgroundUrl(null);
      return;
    }

    const syncBackground = () => {
      setChatBackgroundUrl(getChatBackground(session.family_id));
    };

    syncBackground();
    window.addEventListener("focus", syncBackground);
    window.addEventListener(CHAT_BACKGROUND_CHANGED, syncBackground);
    return () => {
      window.removeEventListener("focus", syncBackground);
      window.removeEventListener(CHAT_BACKGROUND_CHANGED, syncBackground);
    };
  }, [session]);

  // Unlock AudioContext on the first user interaction so later pings can play.
  useEffect(() => installAudioUnlock(), []);

  // Clear the title badge when the tab regains focus.
  useEffect(() => {
    function onVisibility() {
      if (!document.hidden) {
        setUnreadCount(0);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  const refreshImportantNotifications = useCallback(async (activeSession: LocalSession) => {
    const rows = await listImportantNotifications(activeSession);
    setImportantNotifications(rows);
    setImportantReadStates((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(rows.map((row) => row.id));
      const next = new Map(
        [...prev.entries()].filter(([notificationId]) => validIds.has(notificationId)),
      );
      return next.size === prev.size ? prev : next;
    });
  }, []);

  const refreshAssistantCards = useCallback(async (activeSession: LocalSession) => {
    const rows = await listAssistantActionCards(activeSession);
    setAssistantCards(rows);
  }, []);

  useEffect(() => {
    if (!session) {
      setRealtimeConnected(true);
      return;
    }

    let disconnectTimer = 0;
    const clearDisconnectTimer = () => {
      if (!disconnectTimer) return;
      window.clearTimeout(disconnectTimer);
      disconnectTimer = 0;
    };

    const syncVisibleChatData = () => {
      if (document.visibilityState !== "visible") return;
      syncMessages(session, { onMessages: handleSyncedMessages }).catch(
        () => undefined,
      );
      refreshImportantNotifications(session).catch(() => undefined);
      refreshAssistantCards(session).catch(() => undefined);
    };

    const activateRealtime = () => {
      clearDisconnectTimer();
      setRealtimeConnected(true);
      syncVisibleChatData();
    };

    const scheduleBackgroundDisconnect = () => {
      clearDisconnectTimer();
      if (document.visibilityState === "visible") {
        activateRealtime();
        return;
      }
      disconnectTimer = window.setTimeout(() => {
        if (document.visibilityState !== "visible") {
          setRealtimeConnected(false);
        }
      }, REALTIME_BACKGROUND_DISCONNECT_MS);
    };

    scheduleBackgroundDisconnect();
    document.addEventListener("visibilitychange", scheduleBackgroundDisconnect);
    window.addEventListener("focus", activateRealtime);
    window.addEventListener("online", activateRealtime);
    return () => {
      clearDisconnectTimer();
      document.removeEventListener(
        "visibilitychange",
        scheduleBackgroundDisconnect,
      );
      window.removeEventListener("focus", activateRealtime);
      window.removeEventListener("online", activateRealtime);
    };
  }, [handleSyncedMessages, refreshAssistantCards, refreshImportantNotifications, session]);

  useEffect(() => {
    if (!session) return;

    const syncVisibleMessages = () => {
      if (document.visibilityState !== "visible") return;
      syncMessages(session, { onMessages: handleSyncedMessages }).catch(
        () => undefined,
      );
    };
    const refreshVisibleImportantNotifications = () => {
      if (document.visibilityState !== "visible") return;
      refreshImportantNotifications(session).catch(() => undefined);
      refreshAssistantCards(session).catch(() => undefined);
    };

    const messagePoll = window.setInterval(
      syncVisibleMessages,
      MESSAGE_FALLBACK_POLL_MS,
    );
    const importantPoll = window.setInterval(
      refreshVisibleImportantNotifications,
      IMPORTANT_FALLBACK_POLL_MS,
    );
    const metadataPoll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      listMembers(session, { includeRemoved: true })
        .then((mems) => {
          setMembers(mems);
        })
        .catch(() => undefined);
    }, METADATA_FALLBACK_POLL_MS);

    return () => {
      window.clearInterval(messagePoll);
      window.clearInterval(importantPoll);
      window.clearInterval(metadataPoll);
    };
  }, [
    handleSyncedMessages,
    refreshAssistantCards,
    refreshImportantNotifications,
    session,
  ]);

  const refreshChatData = useCallback(async (forceFullRefresh = false) => {
    if (!session) return;
    try {
      const [syncResult, mems, important, cards] = await Promise.all([
        forceFullRefresh
          ? forceRefreshMessages(session, handleSyncedMessages)
          : syncMessages(session, { onMessages: handleSyncedMessages }),
        listMembers(session, { includeRemoved: true }),
        listImportantNotifications(session),
        listAssistantActionCards(session).catch(() => []),
      ]);
      if (syncResult.messages.length > 0) handleSyncedMessages(syncResult.messages);
      setMembers(mems);
      setImportantNotifications(important);
      setAssistantCards(cards);
      setError(null);
    } catch (err) {
      setError(humanizeError(err, language));
    }
  }, [handleSyncedMessages, language, session]);

  const loadOlderCachedMessages = useCallback(async () => {
    const activeSession = sessionRef.current;
    const scroller = scrollRef.current;
    if (!activeSession || !scroller || loadingOlderMessagesRef.current) return;

    const nextLimit = cachedMessageLimitRef.current + CACHED_MESSAGE_PAGE_SIZE;
    loadingOlderMessagesRef.current = true;
    setLoadingOlderMessages(true);
    preserveScrollRef.current = {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
    };
    suppressBottomScrollUntilRef.current = Date.now() + 1200;

    try {
      const cached = await loadCachedMessagesForSession(activeSession, nextLimit);
      const visible = filterVisibleMessages(cached, activeSession);
      const currentMessages = messagesRef.current;
      const merged = mergeMessagesById(visible, currentMessages);
      if (merged.length <= currentMessages.length) {
        preserveScrollRef.current = null;
        return;
      }
      cachedMessageLimitRef.current = nextLimit;
      setMessages(merged);
    } catch {
      preserveScrollRef.current = null;
    } finally {
      loadingOlderMessagesRef.current = false;
      setLoadingOlderMessages(false);
    }
  }, []);

  function isHeaderActionTarget(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest("a,button");
  }

  function handleHeaderDoubleClick(e: React.MouseEvent<HTMLElement>) {
    if (isHeaderActionTarget(e.target)) return;
    void refreshChatData(true);
  }

  function handleHeaderTouchEnd(e: React.TouchEvent<HTMLElement>) {
    if (isHeaderActionTarget(e.target)) return;
    const now = Date.now();
    if (now - lastHeaderTapRef.current < 320) {
      e.preventDefault();
      lastHeaderTapRef.current = 0;
      void refreshChatData(true);
      return;
    }
    lastHeaderTapRef.current = now;
  }

  // Title badge for unread count.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const base = t("appTitle");
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [t, unreadCount]);

  // Bootstrap: validate session, then load data.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      setLoadError(null);
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      const local = loadSession();
      if (!local) {
        setLoading(false);
        router.replace("/");
        return;
      }
      let fresh: LocalSession | null = null;
      try {
        const restored = await safeRestoreSession(local.member_id, local.member_token);
        if (cancelled) return;
        if (restored.status === "expired") {
          clearSession();
          setSession(null);
          setLoadError(t("chatSessionExpired"));
          setLoading(false);
          return;
        }
        if (restored.status === "recoverable_error") {
          setLoadError(
            humanizeError(restored.error, language) || t("chatLoadFailed"),
          );
          setLoading(false);
          return;
        }
        fresh = restored.session;
        saveSession(fresh);
        setSession(fresh);
        cachedMessageLimitRef.current = INITIAL_CACHED_MESSAGE_LIMIT;
        noteMessageCacheOpen(fresh).catch(() => undefined);
      } catch (err) {
        if (!cancelled) {
          setLoadError(humanizeError(err, language) || t("chatLoadFailed"));
          setLoading(false);
        }
        return;
      }

      let hadCachedMessages = false;
      try {
        const cached = await loadCachedMessagesForSession(fresh).catch(() => []);
        if (cancelled) return;
        hadCachedMessages = cached.length > 0;
        if (hadCachedMessages) {
          setMessages(filterVisibleMessages(cached, fresh));
          setLoading(false);
        }

        const [mems, important, cards] = await withTimeout(
          Promise.all([
            listMembers(fresh, { includeRemoved: true }),
            listImportantNotifications(fresh),
            listAssistantActionCards(fresh).catch(() => []),
          ]),
          CHAT_BOOTSTRAP_DATA_TIMEOUT_MS,
          "chat_bootstrap_timeout",
        );
        if (cancelled) return;
        setMembers(mems);
        setImportantNotifications(important);
        setAssistantCards(cards);
        setDismissedImportantIds(
          getDismissedImportantIds(fresh.family_id, fresh.member_id),
        );

        const syncResult = await withTimeout(
          syncMessages(fresh, {
            forceFullRefresh: cached.length === 0,
            onMessages: (next) => {
              if (!cancelled) setMessages(filterVisibleMessages(next, fresh));
            },
          }),
          CHAT_BOOTSTRAP_DATA_TIMEOUT_MS,
          "chat_bootstrap_timeout",
        );
        if (cancelled) return;
        if (syncResult.messages.length > 0) {
          setMessages(filterVisibleMessages(syncResult.messages, fresh));
        }
        setLoadError(null);
      } catch (err) {
        if (!cancelled) {
          if (!hadCachedMessages) {
            setLoadError(humanizeError(err, language) || t("chatLoadFailed"));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [language, retryNonce, router, t]);

  // Realtime subscription for lightweight message events.
  useEffect(() => {
    if (!session || !realtimeConnected) return;
    const sb = getSupabase();
    let active = true;

    const messageEventsChannel = sb
      .channel(`message_events:${session.family_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_realtime_events",
          filter: `recipient_member_id=eq.${session.member_id}`,
        },
        (payload) => {
          if (!active) return;
          const event = payload.new as MessageRealtimeEvent;
          if (event.family_id !== session.family_id) return;
          scheduleRealtimeBatchFetch(event.message_id);
        },
      )
      .subscribe((status) => {
        if (typeof window !== "undefined") {
          // eslint-disable-next-line no-console
          console.log(`[realtime message events] ${status}`);
        }
        if (
          active &&
          isRealtimeProblemStatus(status) &&
          document.visibilityState === "visible"
        ) {
          syncMessages(session, { onMessages: handleSyncedMessages }).catch(
            () => undefined,
          );
        }
      });

    const importantEventsChannel = sb
      .channel(`important_notification_events:${session.family_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "important_notification_realtime_events",
          filter: `family_id=eq.${session.family_id}`,
        },
        (payload) => {
          if (!active) return;
          const event = payload.new as ImportantNotificationRealtimeEvent;
          if (event.family_id !== session.family_id) return;
          refreshImportantNotifications(session).catch(() => undefined);
        },
      )
      .subscribe((status) => {
        if (
          active &&
          isRealtimeProblemStatus(status) &&
          document.visibilityState === "visible"
        ) {
          refreshImportantNotifications(session).catch(() => undefined);
        }
      });

    const scheduleEventsChannel = sb
      .channel(`schedule-events-chat:${session.member_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "family_schedule_events",
          filter: `recipient_member_id=eq.${session.member_id}`,
        },
        (payload) => {
          if (!active) return;
          const event = payload.new as ScheduleRealtimeEvent;
          if (event.family_id !== session.family_id) return;
          markScheduleAttention(session);
        },
      )
      .subscribe();

    const membersChannel = sb
      .channel(`members:${session.family_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "family_members",
          filter: `family_id=eq.${session.family_id}`,
        },
        (payload) => {
          if (!active) return;
          listMembers(session, { includeRemoved: true })
            .then(setMembers)
            .catch(() => undefined);
          // If my own row got flipped to status='removed', kick myself out.
          const newRow = payload.new as FamilyMember | undefined;
          if (
            payload.eventType === "UPDATE" &&
            newRow &&
            newRow.id === session.member_id &&
            newRow.status === "removed"
          ) {
            clearSession();
            toast.info(t("chatRemoved"));
            router.replace("/");
          }
        },
      )
      .subscribe((status) => {
        if (
          active &&
          isRealtimeProblemStatus(status) &&
          document.visibilityState === "visible"
        ) {
          listMembers(session, { includeRemoved: true })
            .then(setMembers)
            .catch(() => undefined);
        }
      });

    const pendingRealtimeMessageIds = pendingRealtimeMessageIdsRef.current;

    return () => {
      active = false;
      sb.removeChannel(messageEventsChannel);
      sb.removeChannel(importantEventsChannel);
      sb.removeChannel(scheduleEventsChannel);
      sb.removeChannel(membersChannel);
      if (realtimeBatchTimerRef.current) {
        window.clearTimeout(realtimeBatchTimerRef.current);
        realtimeBatchTimerRef.current = null;
      }
      pendingRealtimeMessageIds.clear();
    };
  }, [
    handleSyncedMessages,
    markScheduleAttention,
    refreshAssistantCards,
    refreshImportantNotifications,
    realtimeConnected,
    router,
    scheduleRealtimeBatchFetch,
    session,
    t,
    toast,
  ]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomScrollTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    bottomScrollTimeoutsRef.current = [];

    const primaryBehavior: ScrollBehavior =
      isIOSRef.current && behavior === "smooth" ? "auto" : behavior;

    const scroll = (mode: ScrollBehavior = "auto") => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: mode,
      });
    };

    requestAnimationFrame(() => {
      scroll(primaryBehavior);
      requestAnimationFrame(() => scroll("auto"));
    });
    [180, 520].forEach((delay) => {
      const id = window.setTimeout(() => scroll("auto"), delay);
      bottomScrollTimeoutsRef.current.push(id);
    });
  }, []);

  // Auto scroll to bottom on new messages.
  useLayoutEffect(() => {
    if (loading || messages.length === 0) return;
    const preserve = preserveScrollRef.current;
    if (preserve) {
      preserveScrollRef.current = null;
      const scroller = scrollRef.current;
      if (scroller) {
        scroller.scrollTop =
          scroller.scrollHeight - preserve.scrollHeight + preserve.scrollTop;
      }
      didInitialScrollRef.current = true;
      return;
    }
    const shouldScrollImmediately =
      !didInitialScrollRef.current ||
      forceImmediateBottomScrollRef.current ||
      isIOSRef.current;
    scrollToBottom(shouldScrollImmediately ? "auto" : "smooth");
    forceImmediateBottomScrollRef.current = false;
    didInitialScrollRef.current = true;
  }, [loading, messages.length, scrollToBottom]);

  useEffect(() => {
    if (loading || !assistantReplyPending) return;
    scrollToBottom(isIOSRef.current ? "auto" : "smooth");
  }, [assistantReplyPending, loading, scrollToBottom]);

  useEffect(() => {
    if (loading || messages.length === 0) return;
    const content = messagesContentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (Date.now() < suppressBottomScrollUntilRef.current) return;
        scrollToBottom("auto");
      });
    });

    observer.observe(content);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [loading, messages.length, scrollToBottom]);

  useEffect(() => {
    if (loading || typeof ResizeObserver === "undefined") return;
    const scroller = scrollRef.current;
    if (!scroller) return;

    let frame = 0;
    let wasNearBottom = true;
    const rememberBottomProximity = () => {
      const distanceFromBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      wasNearBottom = distanceFromBottom < 120;
    };
    const observer = new ResizeObserver(() => {
      const shouldStickToBottom = wasNearBottom;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (Date.now() < suppressBottomScrollUntilRef.current) return;
        if (shouldStickToBottom) scrollToBottom("auto");
        rememberBottomProximity();
      });
    });

    rememberBottomProximity();
    observer.observe(scroller);
    scroller.addEventListener("scroll", rememberBottomProximity, {
      passive: true,
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener("scroll", rememberBottomProximity);
    };
  }, [loading, scrollToBottom]);

  // Scroll to the message targeted by a notification click (?mid=xxx).
  const lastScrolledToNotifiedMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mid = params.get("mid");
    if (!mid || lastScrolledToNotifiedMessageIdRef.current === mid) return;
    if (messages.some((m) => m.id === mid)) {
      lastScrolledToNotifiedMessageIdRef.current = mid;
      window.setTimeout(() => scrollToMessage(mid), 300);
      return;
    }
    fetchPushMessageNow(mid, true).catch(() => undefined);
  }, [fetchPushMessageNow, messages, scrollToMessage]);

  const memberMap = useMemo(() => {
    const m = new Map<string, FamilyMember>();
    members.forEach((mem) => m.set(mem.id, mem));
    return m;
  }, [members]);

  const whisperTarget = useMemo(() => {
    if (!whisperTargetId) return null;
    const target = memberMap.get(whisperTargetId) ?? null;
    if (!target || target.status !== "active" || target.id === session?.member_id) {
      return null;
    }
    return target;
  }, [memberMap, session?.member_id, whisperTargetId]);

  useEffect(() => {
    if (!session || members.length === 0 || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const targetId = url.searchParams.get("whisper");
    if (!targetId) {
      setWhisperTargetId(null);
      return;
    }

    const target = members.find(
      (member) =>
        member.id === targetId &&
        member.status === "active" &&
        member.id !== session.member_id,
    );
    if (!target) {
      setWhisperTargetId(null);
      removeWhisperParamFromUrl();
      toast.info(t("whisperTargetUnavailable"));
      return;
    }

    setWhisperTargetId(target.id);
  }, [members, session, t, toast]);

  useEffect(() => {
    if (!session || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    setKeeperMode(url.searchParams.get("keeper") === "1");
  }, [session]);

  function exitWhisperMode() {
    setWhisperTargetId(null);
    removeWhisperParamFromUrl();
  }

  function enterWhisperMode(memberId: string) {
    if (!session) return;
    const target = members.find(
      (member) =>
        member.id === memberId &&
        member.status === "active" &&
        member.id !== session.member_id,
    );
    if (!target) {
      setWhisperTargetId(null);
      removeWhisperParamFromUrl();
      toast.info(t("whisperTargetUnavailable"));
      return;
    }

    setWhisperTargetId(target.id);
    setKeeperMode(false);
    setKeeperDraftText(null);
    removeKeeperParamFromUrl();
    setWhisperParamInUrl(target.id);
  }

  function enterKeeperMode(initialText = "") {
    setWhisperTargetId(null);
    removeWhisperParamFromUrl();
    setKeeperMode(true);
    setKeeperParamInUrl();
    if (initialText.trim()) {
      setKeeperDraftText(initialText.trim());
    }
  }

  function exitKeeperMode() {
    setKeeperMode(false);
    setKeeperDraftText(null);
    removeKeeperParamFromUrl();
  }

  const importantByMessageId = useMemo(() => {
    const m = new Map<string, ImportantNotification>();
    importantNotifications.forEach((notification) => {
      if (!notification.removed_at && !notification.message?.recipient_member_id) {
        m.set(notification.message_id, notification);
      }
    });
    return m;
  }, [importantNotifications]);

  const visibleImportantNotifications = useMemo(
    () =>
      importantNotifications.filter(
        (notification) =>
          !notification.removed_at &&
          !notification.message?.recipient_member_id &&
          !dismissedImportantIds.has(notification.id),
      ),
    [dismissedImportantIds, importantNotifications],
  );

  const visibleImportantByMessageId = useMemo(() => {
    const m = new Map<string, ImportantNotification>();
    visibleImportantNotifications.forEach((notification) => {
      m.set(notification.message_id, notification);
    });
    return m;
  }, [visibleImportantNotifications]);

  const selectedActionMessage = messageActionMenu
    ? messages.find((m) => m.id === messageActionMenu.messageId) ?? null
    : null;
  const selectedActionNotification = selectedActionMessage
    ? visibleImportantByMessageId.get(selectedActionMessage.id) ?? null
    : null;
  const selectedActionCopyText = selectedActionMessage
    ? getCopyableMessageText(selectedActionMessage)
    : null;
  const messageActionMenuId = messageActionMenu?.messageId ?? null;
  useLayoutEffect(() => {
    messageActionMenuStateRef.current = messageActionMenu;
  }, [messageActionMenu]);

  const closeMessageActionMenu = useCallback(() => {
    setMessageActionMenu(null);
    const returnTarget = messageActionMenuReturnFocusRef.current;
    messageActionMenuReturnFocusRef.current = null;
    if (!returnTarget || !returnTarget.isConnected) return;
    window.setTimeout(() => {
      try {
        returnTarget.focus({ preventScroll: true });
      } catch {
        returnTarget.focus();
      }
    }, 0);
  }, []);

  const repositionMessageActionMenu = useCallback(() => {
    const current = messageActionMenuStateRef.current;
    if (!current) return;
    const placement = getMessageActionMenuPlacement({
      anchorX: current.anchorX,
      anchorY: current.anchorY,
      menuElement: messageActionMenuPanelRef.current,
      composerElement: chatComposerRef.current,
    });
    setMessageActionMenu((prev) => {
      if (!prev || prev.messageId !== current.messageId) return prev;
      if (
        prev.x === placement.x &&
        prev.y === placement.y &&
        prev.maxHeight === placement.maxHeight
      ) {
        return prev;
      }
      return { ...prev, ...placement };
    });
  }, []);

  useLayoutEffect(() => {
    if (!messageActionMenuId || !selectedActionMessage) return;
    repositionMessageActionMenu();
    const focusFrame = window.requestAnimationFrame(() => {
      messageActionMenuPanelRef.current?.focus({ preventScroll: true });
      repositionMessageActionMenu();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [
    messageActionMenuId,
    repositionMessageActionMenu,
    selectedActionMessage,
  ]);

  useEffect(() => {
    if (!messageActionMenuId) return;
    const visualViewport = window.visualViewport;
    let frame = 0;

    const queueReposition = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        repositionMessageActionMenu();
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeMessageActionMenu();
    };

    visualViewport?.addEventListener("resize", queueReposition);
    visualViewport?.addEventListener("scroll", queueReposition);
    window.addEventListener("resize", queueReposition);
    window.addEventListener("orientationchange", queueReposition);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      visualViewport?.removeEventListener("resize", queueReposition);
      visualViewport?.removeEventListener("scroll", queueReposition);
      window.removeEventListener("resize", queueReposition);
      window.removeEventListener("orientationchange", queueReposition);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    closeMessageActionMenu,
    messageActionMenuId,
    repositionMessageActionMenu,
  ]);

  useEffect(() => {
    if (messageActionMenuId && !selectedActionMessage) {
      setMessageActionMenu(null);
    }
  }, [messageActionMenuId, selectedActionMessage]);

  const assistantCardsByMessageId = useMemo(() => {
    const map = new Map<string, AssistantActionCard>();
    assistantCards.forEach((card) => {
      if (card.card_message_id) map.set(card.card_message_id, card);
    });
    return map;
  }, [assistantCards]);

  function pushOptimistic(
    partial: Pick<Message, "id" | "message_type"> & Partial<Message>,
  ) {
    if (!session) return;
    forceImmediateBottomScrollRef.current = true;
    const now = new Date().toISOString();
    const optimistic: Message = {
      id: partial.id,
      family_id: session.family_id,
      family_seq: partial.family_seq ?? null,
      sender_member_id: session.member_id,
      recipient_member_id: partial.recipient_member_id ?? null,
      message_type: partial.message_type,
      content: partial.content ?? null,
      image_url: partial.image_url ?? null,
      audio_url: partial.audio_url ?? null,
      audio_duration_ms: partial.audio_duration_ms ?? null,
      latitude: partial.latitude ?? null,
      longitude: partial.longitude ?? null,
      address: partial.address ?? null,
      map_url: partial.map_url ?? null,
      effect_id: partial.effect_id ?? null,
      effect_caption: partial.effect_caption ?? null,
      system_event_type: null,
      system_event_payload: null,
      deleted_at: null,
      deleted_by_member_id: null,
      updated_at: now,
      created_at: now,
    };
    setMessages((prev) => {
      if (prev.some((m) => m.id === partial.id)) return prev;
      return [...prev, optimistic];
    });
    mergeRealtimeMessage(session, optimistic)
      .then(setMessages)
      .catch(() => undefined);
    scrollToBottom("auto");
  }

  async function handleDeleteMessage(messageId: string) {
    if (!session) return;
    const ok = await dialog.confirm({
      title: t("importantRecallMessage"),
      message: t("chatDeleteConfirm"),
    });
    if (!ok) return;
    try {
      await deleteMessage(session, messageId);
      const updatedAt = new Date().toISOString();
      const current = messages.find((m) => m.id === messageId);
      const patched: Message | null = current
        ? {
            ...current,
            deleted_at: updatedAt,
            deleted_by_member_id: session.member_id,
            updated_at: updatedAt,
          }
        : null;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !patched) return m;
          return patched;
        }),
      );
      if (patched) {
        mergeRealtimeMessage(session, patched)
          .then(setMessages)
          .catch(() => undefined);
      }
    } catch (err) {
      toast.error(humanizeError(err, language));
    }
  }

  async function handleCopyMessage(message: Message) {
    const text = getCopyableMessageText(message);
    if (!text) return;
    setMessageActionMenu(null);
    try {
      await copyTextToClipboard(text);
      toast.success(t("messageCopied"));
    } catch {
      toast.error(t("messageCopyFailed"));
    }
  }

  function openMessageActions(
    message: Message,
    point: { x: number; y: number },
  ) {
    if (!session) return;
    const activeElement = document.activeElement;
    messageActionMenuReturnFocusRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
    const placement = getMessageActionMenuPlacement({
      anchorX: point.x,
      anchorY: point.y,
      composerElement: chatComposerRef.current,
    });
    setMessageActionMenu({
      messageId: message.id,
      anchorX: point.x,
      anchorY: point.y,
      ...placement,
    });
  }

  async function handleSetMessageImageBackground(message: Message) {
    if (!session || !message.image_url) return;
    setMessageActionMenu(null);
    const ok = await dialog.confirm({
      title: t("previewSetBackground"),
      message: t("previewSetBackgroundConfirm"),
    });
    if (!ok) return;
    setChatBackground(session.family_id, message.image_url);
    toast.success(t("previewBackgroundSet"));
  }

  async function handleAddImportant(messageId: string) {
    if (!session) return;
    setMessageActionMenu(null);
    try {
      const notificationId = await addImportantNotification(session, messageId);
      setDismissedImportantIds((prev) => {
        if (!prev.has(notificationId)) return prev;
        const next = new Set(prev);
        next.delete(notificationId);
        saveDismissedImportantIds(session.family_id, session.member_id, next);
        return next;
      });
      await refreshImportantNotifications(session);
    } catch (err) {
      toast.error(
        t("importantSetFailed", {
          message: humanizeError(err, language),
        }),
      );
    }
  }

  async function handleRemoveImportant(notificationId: string) {
    if (!session) return;
    setMessageActionMenu(null);
    try {
      await removeImportantNotification(session, notificationId);
      await refreshImportantNotifications(session);
      setDismissedImportantIds((prev) => {
        const next = new Set(prev);
        next.delete(notificationId);
        saveDismissedImportantIds(session.family_id, session.member_id, next);
        return next;
      });
    } catch (err) {
      toast.error(
        t("importantRemoveFailed", {
          message: humanizeError(err, language),
        }),
      );
    }
  }

  async function loadImportantReadState(notificationId: string) {
    if (!session) return;
    if (importantReadStates.has(notificationId)) return;
    if (loadingImportantReadStateIdsRef.current.has(notificationId)) return;
    loadingImportantReadStateIdsRef.current.add(notificationId);
    try {
      const state = await getImportantNotificationReadState(session, notificationId);
      setImportantReadStates((prev) => {
        const next = new Map(prev);
        next.set(notificationId, state);
        return next;
      });
    } catch {
      // Read-state is supplemental; the important notice itself remains usable.
    } finally {
      loadingImportantReadStateIdsRef.current.delete(notificationId);
    }
  }

  async function createScheduleChangeAssistantCard(
    sourceMessageId: string | null,
    lookup: ScheduleLookupIntent,
  ) {
    if (!session) return;
    const matches = await searchScheduleItems(session, {
      rangeStart: new Date(lookup.rangeStart),
      rangeEnd: new Date(lookup.rangeEnd),
      query: lookup.query,
      limit: 5,
    });
    const activeMatches = matches.filter((item) => item.status === "active");
    if (activeMatches.length === 0) {
      toast.info(t("assistantScheduleMatchMissing"));
      return;
    }
    if (activeMatches.length > 1) {
      toast.info(t("assistantScheduleMatchMultiple"));
      return;
    }

    const item = activeMatches[0];
    const input = buildScheduleChangeCardInput(item, lookup, language, t);
    const result = await createAssistantActionCard(session, {
      ...input,
      source_message_id: sourceMessageId,
    });
    await refreshAssistantCards(session).catch(() => undefined);
    if (result.message_id) {
      const fetched = await fetchRealtimeMessage(result.message_id).catch(() => false);
      if (!fetched) {
        await syncMessages(session, { onMessages: handleSyncedMessages }).catch(
          () => undefined,
        );
      }
    }
  }

  function handleOpenAssistantSchedule(card: AssistantActionCard) {
    const scheduleItemId = assistantScheduleItemId(card);
    if (!scheduleItemId) return;
    router.push(`/schedule?item=${encodeURIComponent(scheduleItemId)}`);
  }

  async function handleAssistantTaskAction(
    card: AssistantActionCard,
    action: "accept" | "complete" | "snooze",
  ) {
    if (!session || !card.result_schedule_item_id) return;
    setAssistantSubmittingCardId(card.id);
    try {
      if (action === "accept") {
        await respondScheduleAssignment(
          session,
          card.result_schedule_item_id,
          "accepted",
        );
        toast.success(t("assistantTaskAccepted"));
      } else if (action === "complete") {
        await setScheduleItemStatus(session, card.result_schedule_item_id, "done");
        toast.success(t("assistantTaskCompleted"));
      } else {
        const status = await getScheduleReminderStatus(
          session,
          card.result_schedule_item_id,
        );
        const delivery = status.current_member_delivery;
        if (!delivery) throw new Error("schedule_reminder_not_found");
        await snoozeScheduleReminder(session, delivery.id, 10);
        toast.success(t("assistantTaskSnoozed"));
      }
    } catch (err) {
      toast.error(
        t("assistantTaskActionFailed", {
          message: humanizeError(err, language),
        }),
      );
    } finally {
      setAssistantSubmittingCardId(null);
    }
  }

  async function handleConfirmAssistantCard(card: AssistantActionCard) {
    if (!session) return;
    setAssistantSubmittingCardId(card.id);
    try {
      const result = await confirmAssistantActionCard(session, card.id);
      await refreshAssistantCards(session);
      if (result.message_id) {
        await fetchRealtimeMessage(result.message_id).catch(() => false);
      }
      if (result.result_message_id) {
        await fetchRealtimeMessage(result.result_message_id).catch(() => false);
        requestMessagePush(session, result.result_message_id);
      }
      if (card.card_type === "important") {
        await refreshImportantNotifications(session).catch(() => undefined);
      }
      toast.success(t("assistantConfirmed"));
    } catch (err) {
      toast.error(
        t("assistantConfirmFailed", {
          message: humanizeError(err, language),
        }),
      );
    } finally {
      setAssistantSubmittingCardId(null);
    }
  }

  async function handleCancelAssistantCard(card: AssistantActionCard) {
    if (!session) return;
    setAssistantSubmittingCardId(card.id);
    try {
      const result = await cancelAssistantActionCard(session, card.id);
      await refreshAssistantCards(session);
      if (result.message_id) {
        await fetchRealtimeMessage(result.message_id).catch(() => false);
      }
      toast.success(t("assistantCancelled"));
    } catch (err) {
      toast.error(
        t("assistantCancelFailed", {
          message: humanizeError(err, language),
        }),
      );
    } finally {
      setAssistantSubmittingCardId(null);
    }
  }

  function handleModifyAssistantCard() {
    toast.info(t("assistantModifyUnavailable"));
  }

  function handleMessagesTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const scroller = scrollRef.current;
    if (!scroller || scroller.scrollTop > 4) {
      pullStartYRef.current = null;
      return;
    }
    pullStartYRef.current = e.touches[0]?.clientY ?? null;
  }

  function handleMessagesTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    const startY = pullStartYRef.current;
    pullStartYRef.current = null;
    if (startY == null) return;
    const endY = e.changedTouches[0]?.clientY ?? startY;
    if (endY - startY > 72) {
      void refreshChatData(true);
    }
  }

  function handleMessagesScroll() {
    const scroller = scrollRef.current;
    if (!scroller || scroller.scrollTop > 32) return;
    void loadOlderCachedMessages();
  }

  function handleSelectImportant(notification: ImportantNotification) {
    if (!session) return;
    const next = dismissImportantNotification(
      session.family_id,
      session.member_id,
      notification.id,
    );
    setDismissedImportantIds(next);

    if (notification.message && !messages.some((m) => m.id === notification.message_id)) {
      mergeRealtimeMessage(session, notification.message as Message)
        .then(setMessages)
        .catch(() => undefined);
      setMessages((prev) => {
        if (prev.some((m) => m.id === notification.message_id)) return prev;
        return [...prev, notification.message as Message].sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      });
      window.setTimeout(() => scrollToMessage(notification.message_id), 60);
      return;
    }

    scrollToMessage(notification.message_id);
  }

  async function runAssistantReplyAfterPause(
    sourceMessageId: string,
    work: () => Promise<void>,
  ) {
    setAssistantReplyPending({
      sourceMessageId,
      startedAt: Date.now(),
    });
    try {
      await delay(ASSISTANT_REPLY_DELAY_MS);
      await work();
    } finally {
      setAssistantReplyPending((prev) =>
        prev?.sourceMessageId === sourceMessageId ? null : prev,
      );
    }
  }

  async function handleSendText(text: string) {
    if (!session) return;
    const explicitAssistantText = assistantDraftFromText(text) ?? keeperDraftFromText(text);
    const isAssistantAddressed = !whisperTarget && (keeperMode || explicitAssistantText !== null);
    const assistantText = keeperMode ? text.trim() : explicitAssistantText ?? text;
    const latestTarget = latestOrdinaryVisibleMessage(messagesRef.current);
    const assistantDraft =
      !whisperTarget && assistantText.trim()
        ? parseAssistantIntent(assistantText, {
            members: membersRef.current,
            currentMemberId: session.member_id,
            latestVisibleMessage: latestTarget,
          })
        : null;
    const keepAssistantDraftPrivate =
      !whisperTarget && shouldKeepAssistantDraftPrivate(assistantDraft);

    setSending(true);
    try {
      if (isAssistantAddressed || keepAssistantDraftPrivate) {
        if (!assistantText.trim()) {
          toast.info(t("assistantNeedTimeExample"));
          return;
        }

        const pendingKey = `assistant-${Date.now()}`;
        if (assistantDraft?.reason === "schedule_lookup") {
          await runAssistantReplyAfterPause(pendingKey, async () => {
            try {
              await createScheduleChangeAssistantCard(null, assistantDraft.scheduleLookup);
            } catch (assistantErr) {
              toast.error(
                t("assistantCreateFailed", {
                  message: humanizeError(assistantErr, language),
                }),
              );
            }
          });
        } else if (assistantDraft?.reason === "missing_time") {
          toast.info(t("assistantNeedTimeExample"));
        } else if (assistantDraft?.reason === "missing_target") {
          toast.info(t("assistantNeedTarget"));
        } else if (isAssistantCreateDraft(assistantDraft)) {
          await runAssistantReplyAfterPause(pendingKey, async () => {
            try {
              const result = await createAssistantActionCard(session, {
                ...assistantDraft,
                source_message_id: null,
              });
              await refreshAssistantCards(session).catch(() => undefined);
              if (result.message_id) {
                const fetched = await fetchRealtimeMessage(result.message_id).catch(
                  () => false,
                );
                if (!fetched) {
                  await syncMessages(session, { onMessages: handleSyncedMessages }).catch(
                    () => undefined,
                  );
                }
              }
            } catch (assistantErr) {
              toast.error(
                t("assistantCreateFailed", {
                  message: humanizeError(assistantErr, language),
                }),
              );
            }
          });
          if (keeperMode) {
            setKeeperMode(false);
            removeKeeperParamFromUrl();
          }
        } else {
          toast.info(t("assistantNeedTimeExample"));
        }
        return;
      }

      const { content, effect: eff } = transformForSending(text);
      const id = await sendMessage(session, {
        type: "text",
        content,
        effect_id: eff?.id ?? null,
        effect_caption: eff?.caption ?? null,
        recipient_member_id: whisperTarget?.id ?? null,
      });
      pushOptimistic({
        id,
        message_type: "text",
        content,
        effect_id: eff?.id ?? null,
        effect_caption: eff?.caption ?? null,
        recipient_member_id: whisperTarget?.id ?? null,
      });
      requestMessagePush(session, id);
      tryTriggerEffect(id, eff);
      if (assistantDraft?.reason === "schedule_lookup") {
        await runAssistantReplyAfterPause(id, async () => {
          try {
            await createScheduleChangeAssistantCard(id, assistantDraft.scheduleLookup);
          } catch (assistantErr) {
            toast.error(
              t("assistantCreateFailed", {
                message: humanizeError(assistantErr, language),
              }),
            );
          }
        });
      } else if (assistantDraft?.reason === "missing_time") {
        toast.info(t("assistantNeedTimeExample"));
      } else if (assistantDraft?.reason === "missing_target") {
        toast.info(t("assistantNeedTarget"));
      } else if (isAssistantCreateDraft(assistantDraft)) {
        await runAssistantReplyAfterPause(id, async () => {
          try {
            const result = await createAssistantActionCard(session, {
              ...assistantDraft,
              source_message_id: id,
            });
            await refreshAssistantCards(session).catch(() => undefined);
            if (result.message_id) {
              const fetched = await fetchRealtimeMessage(result.message_id).catch(
                () => false,
              );
              if (!fetched) {
                await syncMessages(session, { onMessages: handleSyncedMessages }).catch(
                  () => undefined,
                );
              }
            }
          } catch (assistantErr) {
            toast.error(
              t("assistantCreateFailed", {
                message: humanizeError(assistantErr, language),
              }),
            );
          }
        });
        if (keeperMode) {
          setKeeperMode(false);
          removeKeeperParamFromUrl();
        }
      }
    } catch (err) {
      toast.error(humanizeError(err, language));
    } finally {
      setSending(false);
    }
  }

  async function handleCreateKeeperRequest(input: CreateKeeperRequestInput) {
    if (!session) return;
    setKeeperSubmitting(true);
    try {
      const result = await createKeeperRequest(session, input);
      setKeeperDraftText(null);
      setKeeperMode(false);
      removeKeeperParamFromUrl();
      toast.success(t("keeperCreated"));
      const fetched = await fetchRealtimeMessage(result.message_id).catch(() => false);
      if (!fetched) {
        await syncMessages(session, { onMessages: handleSyncedMessages }).catch(
          () => undefined,
        );
      }
    } catch (err) {
      toast.error(humanizeError(err, language) || t("keeperCreateFailed"));
    } finally {
      setKeeperSubmitting(false);
    }
  }

  async function handlePickImage(file: File) {
    if (!session) return;
    setSending(true);
    try {
      const url = await uploadChatImage(session, file);
      const id = await sendMessage(session, {
        type: "image",
        image_url: url,
        content: t("chatImageMessage"),
        recipient_member_id: whisperTarget?.id ?? null,
      });
      pushOptimistic({
        id,
        message_type: "image",
        image_url: url,
        content: t("chatImageMessage"),
        recipient_member_id: whisperTarget?.id ?? null,
      });
      requestMessagePush(session, id);
    } catch (err) {
      toast.error(humanizeError(err, language));
    } finally {
      setSending(false);
    }
  }

  async function handleSendAudio(result: RecordingResult) {
    if (!session) return;
    if (result.blob.size > 2 * 1024 * 1024) {
      throw new Error("audio_too_large");
    }
    setSending(true);
    try {
      const url = await uploadChatAudio(
        session,
        result.blob,
        result.mimeType,
      );
      const id = await sendMessage(session, {
        type: "audio",
        audio_url: url,
        audio_duration_ms: result.durationMs,
        content: t("chatAudioMessage"),
        recipient_member_id: whisperTarget?.id ?? null,
      });
      pushOptimistic({
        id,
        message_type: "audio",
        audio_url: url,
        audio_duration_ms: result.durationMs,
        content: t("chatAudioMessage"),
        recipient_member_id: whisperTarget?.id ?? null,
      });
      requestMessagePush(session, id);
    } finally {
      setSending(false);
    }
  }

  async function handleSendLocation() {
    if (!session) return;
    setSending(true);
    try {
      const fix = await getCurrentLocation();
      const mapUrl = createGoogleMapUrl(fix.latitude, fix.longitude);
      const id = await sendMessage(session, {
        type: "location",
        content: t("chatLocationMessage"),
        latitude: fix.latitude,
        longitude: fix.longitude,
        map_url: mapUrl,
        recipient_member_id: whisperTarget?.id ?? null,
      });
      pushOptimistic({
        id,
        message_type: "location",
        content: t("chatLocationMessage"),
        latitude: fix.latitude,
        longitude: fix.longitude,
        map_url: mapUrl,
        recipient_member_id: whisperTarget?.id ?? null,
      });
      requestMessagePush(session, id);
    } catch (err) {
      toast.error(humanizeError(err, language) || t("chatLocationError"));
    } finally {
      setSending(false);
    }
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 flex-col px-5 py-8">
        <EnvWarning />
      </div>
    );
  }

  if (loading) {
    return <ChatLoadingState />;
  }

  if (loadError) {
    return (
      <ChatLoadErrorState
        message={loadError}
        onRetry={() => setRetryNonce((value) => value + 1)}
        onBackHome={() => {
          clearSession();
          router.replace("/");
        }}
      />
    );
  }

  if (!session) {
    return null;
  }

  const currentMember = memberMap.get(session.member_id) ?? null;
  const currentAvatarUrl = safeHttpUrl(currentMember?.avatar_url ?? null);

  return (
    <div
      className="chat-paper-bg flex overflow-hidden flex-col"
      style={{ height: "var(--chat-viewport-height, 100dvh)" }}
    >
      {effectShow ? (
        <EffectOverlay
          key={effectShow.key}
          effect={effectShow.effect}
          onDone={handleEffectDone}
        />
      ) : null}
      {messageActionMenu && selectedActionMessage ? (
        <>
          <button
            type="button"
            aria-label={t("commonCancel")}
            className="chat-action-dismiss-layer"
            onClick={closeMessageActionMenu}
          />
          <div
            ref={messageActionMenuPanelRef}
            role="menu"
            aria-label={t("inputMoreActions")}
            tabIndex={-1}
            className="chat-action-menu"
            style={{
              left: messageActionMenu.x,
              top: messageActionMenu.y,
              maxHeight: messageActionMenu.maxHeight,
            }}
          >
            {selectedActionCopyText ? (
              <button
                type="button"
                role="menuitem"
                className={`${chatActionMenuButtonClass} text-slate-700 hover:bg-slate-50 focus-visible:ring-brand-200`}
                onClick={() => {
                  void handleCopyMessage(selectedActionMessage);
                }}
              >
                {t("messageCopy")}
              </button>
            ) : null}
            {selectedActionMessage.recipient_member_id ? null : selectedActionNotification ? (
              <button
                type="button"
                role="menuitem"
                className={`${chatActionMenuButtonClass} text-slate-700 hover:bg-slate-50 focus-visible:ring-brand-200`}
                onClick={() => handleRemoveImportant(selectedActionNotification.id)}
              >
                {t("importantUnset")}
              </button>
            ) : !selectedActionMessage.deleted_at ? (
              <button
                type="button"
                role="menuitem"
                className={`${chatActionMenuButtonClass} text-slate-700 hover:bg-slate-50 focus-visible:ring-brand-200`}
                onClick={() => handleAddImportant(selectedActionMessage.id)}
              >
                {t("importantSet")}
              </button>
            ) : null}
            {selectedActionMessage.message_type === "image" &&
            selectedActionMessage.image_url &&
            !selectedActionMessage.deleted_at ? (
              <button
                type="button"
                role="menuitem"
                className={`${chatActionMenuButtonClass} text-slate-700 hover:bg-slate-50 focus-visible:ring-brand-200`}
                onClick={() => handleSetMessageImageBackground(selectedActionMessage)}
              >
                {t("previewSetBackground")}
              </button>
            ) : null}
            {selectedActionMessage.message_type !== "system" &&
            !selectedActionMessage.deleted_at &&
            (selectedActionMessage.sender_member_id === session.member_id ||
              (!selectedActionMessage.recipient_member_id && session.is_admin)) ? (
              <button
                type="button"
                role="menuitem"
                className={`${chatActionMenuButtonClass} text-rose-600 hover:bg-rose-50 focus-visible:ring-rose-200`}
                onClick={() => {
                  setMessageActionMenu(null);
                  void handleDeleteMessage(selectedActionMessage.id);
                }}
              >
                {t("importantRecallMessage")}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      <KeeperRequestSheet
        open={keeperDraftText !== null}
        initialText={keeperDraftText ?? ""}
        members={members}
        currentMemberId={session.member_id}
        submitting={keeperSubmitting}
        onCancel={() => setKeeperDraftText(null)}
        onSubmit={handleCreateKeeperRequest}
      />
      <header
        className="relative z-20 flex min-h-[60px] items-center justify-between gap-2 border-b border-white/70 bg-white/[0.86] px-3 py-2 shadow-[0_8px_22px_rgba(62,56,44,0.06)] backdrop-blur-xl sm:px-5"
        onDoubleClick={handleHeaderDoubleClick}
        onTouchEnd={handleHeaderTouchEnd}
      >
        <div className="min-w-0 flex-1 pr-1">
          <div className="text-[12px] leading-4 text-slate-500">{t("chatFamily")}</div>
          <div className="truncate text-lg font-bold leading-6 text-slate-900">
            {session.family_name}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Link
            href="/schedule"
            className={`${chatHeaderIconClass} relative`}
            style={{ backgroundImage: "url(/ui-icons/schedule.png)" }}
            aria-label={t("scheduleTitle")}
            title={t("scheduleTitle")}
            onClick={clearScheduleAttention}
          >
            {scheduleAttentionDot ? (
              <span
                aria-hidden="true"
                className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-rose-500 shadow-sm ring-2 ring-white"
              />
            ) : null}
          </Link>
          <Link
            href="/members"
            className={chatHeaderIconClass}
            style={{ backgroundImage: "url(/ui-icons/members.png)" }}
            aria-label={t("chatMembers")}
            title={t("chatMembers")}
          />
          <Link
            href="/me"
            className={chatHeaderIconClass}
            style={
              currentAvatarUrl
                ? undefined
                : { backgroundImage: "url(/ui-icons/me.png)" }
            }
            aria-label={t("meTitle")}
            title={t("meTitle")}
          >
            {currentAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentAvatarUrl}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : null}
          </Link>
        </div>
      </header>

      {error ? (
        <div
          className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm leading-6 text-rose-800"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      <ImportantNoticeBar
        notifications={visibleImportantNotifications}
        members={memberMap}
        readStates={importantReadStates}
        onRequestReadState={loadImportantReadState}
        onSelect={handleSelectImportant}
        onRemove={(notification) => handleRemoveImportant(notification.id)}
      />

      <div
        ref={scrollRef}
        onScroll={handleMessagesScroll}
        onTouchStart={handleMessagesTouchStart}
        onTouchEnd={handleMessagesTouchEnd}
        className="native-scroll chat-paper-bg min-h-0 flex-1 overflow-y-auto bg-cover bg-center bg-no-repeat px-3 pt-3 sm:px-5"
        role="log"
        aria-label={`${session.family_name} ${t("chatFamily")}`}
        aria-live="polite"
        aria-relevant="additions"
        style={{
          ...(chatBackgroundUrl
            ? {
                backgroundImage: `linear-gradient(rgba(247, 246, 242, 0.78), rgba(247, 246, 242, 0.78)), url("${chatBackgroundUrl}")`,
              }
            : {}),
        }}
      >
        <div
          ref={messagesContentRef}
          className={
            messages.length === 0 && !assistantReplyPending
              ? "flex min-h-full flex-col justify-center pb-4"
              : "space-y-3 pb-2"
          }
        >
          {loadingOlderMessages ? (
            <OlderMessagesLoadingIndicator />
          ) : null}
          {messages.length === 0 && !assistantReplyPending ? (
            <ChatEmptyState />
          ) : (
            messages.map((m) => {
              const isMine = m.sender_member_id === session.member_id;
              const canOpenActions = !m.deleted_at || importantByMessageId.has(m.id);
              return (
                <div
                  key={m.id}
                  ref={(el) => {
                    if (el) {
                      messageRefs.current.set(m.id, el);
                    } else {
                      messageRefs.current.delete(m.id);
                    }
                  }}
                  className="rounded-3xl"
                >
                  <ChatMessage
                    message={m}
                    sender={
                      m.sender_member_id
                        ? memberMap.get(m.sender_member_id) ?? null
                        : null
                    }
                    recipient={
                      m.recipient_member_id
                        ? memberMap.get(m.recipient_member_id) ?? null
                        : null
                    }
                    isMine={isMine}
                    highlighted={highlightedMessageId === m.id}
                    assistantCard={assistantCardsByMessageId.get(m.id) ?? null}
                    assistantCardSubmitting={
                      assistantSubmittingCardId ===
                      assistantCardsByMessageId.get(m.id)?.id
                    }
                    currentMemberId={session.member_id}
                    onConfirmAssistantCard={handleConfirmAssistantCard}
                    onCancelAssistantCard={handleCancelAssistantCard}
                    onModifyAssistantCard={handleModifyAssistantCard}
                    onOpenAssistantSchedule={handleOpenAssistantSchedule}
                    onAcceptAssistantTask={(card) =>
                      handleAssistantTaskAction(card, "accept")
                    }
                    onCompleteAssistantTask={(card) =>
                      handleAssistantTaskAction(card, "complete")
                    }
                    onSnoozeAssistantTask={(card) =>
                      handleAssistantTaskAction(card, "snooze")
                    }
                    onRequestActions={canOpenActions ? openMessageActions : undefined}
                    onReplayEffect={handleReplayEffect}
                  />
                </div>
              );
            })
          )}
          {assistantReplyPending ? <AssistantReplyPendingBubble /> : null}
          <div ref={messagesEndRef} aria-hidden className="h-4" />
        </div>
      </div>

      <div ref={chatComposerRef} className="relative z-40 shrink-0">
      {keeperMode && !whisperTarget ? (
        <div
          className="mx-auto flex h-10 w-full max-w-3xl items-center justify-between gap-2 border-t border-emerald-100/70 bg-emerald-50/90 px-3 text-sm text-emerald-800 shadow-[0_-10px_24px_rgba(47,83,67,0.08)] backdrop-blur-xl sm:px-4"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
              家
            </span>
            <span className="truncate font-semibold">{t("keeperModeLabel")}</span>
          </div>
          <button
            type="button"
            className="native-press shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
            onClick={exitKeeperMode}
          >
            {t("whisperExit")}
          </button>
        </div>
      ) : whisperTarget ? (
        <div
          className="mx-auto flex h-10 w-full max-w-3xl items-center justify-between gap-2 border-t border-violet-100/70 bg-violet-50/90 px-3 text-sm text-violet-800 shadow-[0_-10px_24px_rgba(88,70,118,0.08)] backdrop-blur-xl sm:px-4"
        >
          <div className="flex min-w-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/ui-icons/whisper-lock.png"
              alt=""
              className="h-5 w-5 shrink-0 rounded-md"
            />
            <span className="truncate font-semibold">
              {t("whisperModeLabel", { nickname: whisperTarget.nickname })}
            </span>
          </div>
          <button
            type="button"
            className="native-press shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"
            onClick={exitWhisperMode}
          >
            {t("whisperExit")}
          </button>
        </div>
      ) : null}

      <ChatInput
        sending={sending}
        onSendText={handleSendText}
        onPickImage={handlePickImage}
        onSendLocation={handleSendLocation}
        onSendAudio={handleSendAudio}
        members={members}
        currentMemberId={session.member_id}
        whisperTargetId={whisperTarget?.id ?? null}
        onSelectWhisper={enterWhisperMode}
        keeperMode={keeperMode}
        onOpenKeeper={() => enterKeeperMode()}
      />
      </div>
    </div>
  );
}
