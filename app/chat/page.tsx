"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import EffectOverlay from "@/components/EffectOverlay";
import EnvWarning from "@/components/EnvWarning";
import ImportantNoticeBar from "@/components/ImportantNoticeBar";
import { useLanguage } from "@/components/LanguageProvider";
import { useDialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";
import { clearSession, loadSession, saveSession, type LocalSession } from "@/lib/authLocal";
import {
  CHAT_BACKGROUND_CHANGED,
  getChatBackground,
  setChatBackground,
} from "@/lib/chatBackground";
import { effectFromColumns, transformForSending, type Effect, detectEffect } from "@/lib/effects";
import { humanizeError } from "@/lib/errors";
import { validateMember } from "@/lib/familyService";
import {
  dismissImportantNotification,
  getDismissedImportantIds,
  saveDismissedImportantIds,
} from "@/lib/importantNotificationPreference";
import {
  addImportantNotification,
  listImportantNotifications,
  removeImportantNotification,
} from "@/lib/importantNotificationService";
import { listMembers } from "@/lib/memberService";
import {
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
} from "@/lib/messageRepository";
import { getCurrentLocation, createGoogleMapUrl } from "@/lib/locationService";
import {
  installAudioUnlock,
  playNotificationSound,
  vibrate,
} from "@/lib/notify";
import {
  checkPushSubscriptionHealth,
  pushNotificationErrorMessage,
  requestMessagePush,
  updatePushPresence,
} from "@/lib/pushNotificationService";
import type { RecordingResult } from "@/lib/recordingService";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { usePushNotificationControls } from "@/lib/usePushNotificationControls";
import type { ImportantNotification } from "@/types/importantNotification";
import type { FamilyMember } from "@/types/member";
import type { Message } from "@/types/message";

const MESSAGE_FALLBACK_POLL_MS = 30_000;
const IMPORTANT_FALLBACK_POLL_MS = 30_000;
const METADATA_FALLBACK_POLL_MS = 120_000;

interface MessageRealtimeEvent {
  id: string;
  family_id: string;
  message_id: string;
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

interface PushReceivedMessage {
  type?: string;
  familyId?: string | null;
  messageId?: string | null;
  oldEndpoint?: string | null;
  newEndpoint?: string | null;
  endpoint?: string | null;
}

function isMessageVisibleToSession(
  message: Message,
  activeSession: LocalSession,
): boolean {
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

export default function ChatPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const dialog = useDialog();
  const toast = useToast();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [whisperTargetId, setWhisperTargetId] = useState<string | null>(null);
  const [importantNotifications, setImportantNotifications] = useState<
    ImportantNotification[]
  >([]);
  const [dismissedImportantIds, setDismissedImportantIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(
    null,
  );
  const [messageActionMenu, setMessageActionMenu] = useState<{
    messageId: string;
    x: number;
    y: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [chatBackgroundUrl, setChatBackgroundUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastHeaderTapRef = useRef(0);
  const pullStartYRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const forceImmediateBottomScrollRef = useRef(false);
  const bottomScrollTimeoutsRef = useRef<number[]>([]);
  const isIOSRef = useRef(false);
  const membersRef = useRef<FamilyMember[]>([]);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    knownMessageIdsRef.current = new Set(messages.map((message) => message.id));
  }, [messages]);
  const realtimeEventTimersRef = useRef<Map<string, number>>(new Map());
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

    const updateViewportHeight = () => {
      const height = visualViewport?.height ?? window.innerHeight;
      html.style.setProperty("--chat-viewport-height", `${height}px`);
    };

    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.height = "var(--chat-viewport-height, 100dvh)";
    body.style.overscrollBehavior = "none";
    updateViewportHeight();
    visualViewport?.addEventListener("resize", updateViewportHeight);
    window.addEventListener("orientationchange", updateViewportHeight);

    return () => {
      bottomScrollTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      bottomScrollTimeoutsRef.current = [];
      visualViewport?.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener("orientationchange", updateViewportHeight);
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

  // Notifications: in-app sound + title badge, controlled by the PWA push switch.
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
    pushEnabledRef.current = push.enabled;
  }, [push.enabled]);

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
        playNotificationSound();
        if (typeof document !== "undefined" && document.hidden) {
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
      setMessages(visible);
      unseenMessages.forEach(handleIncomingMessageSideEffects);
    },
    [handleIncomingMessageSideEffects],
  );

  const fetchRealtimeMessage = useCallback(
    async (messageId: string) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      const incoming = await getMessageById(activeSession, messageId);
      if (!incoming) return;
      if (!isMessageVisibleToSession(incoming, activeSession)) return;
      const next = await mergeRealtimeMessage(activeSession, incoming);
      handleSyncedMessages(next);
    },
    [handleSyncedMessages],
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
      if (data.type !== "family-chat:push-received") return;
      if (data.familyId !== session.family_id) return;
      if (window.location.pathname !== "/chat") return;

      if (data.messageId) {
        fetchRealtimeMessage(data.messageId).catch(syncVisibleMessages);
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
  }, [fetchRealtimeMessage, handleSyncedMessages, session]);

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
  }, []);

  const refreshChatData = useCallback(async (forceFullRefresh = false) => {
    if (!session) return;
    try {
      const [syncResult, mems, important] = await Promise.all([
        forceFullRefresh
          ? forceRefreshMessages(session, handleSyncedMessages)
          : syncMessages(session, { onMessages: handleSyncedMessages }),
        listMembers(session, { includeRemoved: true }),
        listImportantNotifications(session),
      ]);
      if (syncResult.messages.length > 0) handleSyncedMessages(syncResult.messages);
      setMembers(mems);
      setImportantNotifications(important);
      setError(null);
    } catch (err) {
      setError(humanizeError(err, language));
    }
  }, [handleSyncedMessages, language, session]);

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

  async function handleToggleNotifications() {
    if (!session) return;
    if (push.busy) return;

    if (push.enabled) {
      await push.disable().catch(() => undefined);
      setUnreadCount(0);
      return;
    }

    if (push.support?.reason === "ios_not_standalone") {
      toast.info(t("settingsPushIosGuideTitle"));
      router.push("/settings");
      return;
    }

    try {
      await push.enable();
      toast.success(t("settingsPushEnabledAlert"));
    } catch (err) {
      toast.error(pushNotificationErrorMessage(err, t));
    }
  }

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
        router.replace("/");
        return;
      }
      let fresh: LocalSession | null = null;
      try {
        fresh = await validateMember(local.member_id, local.member_token);
        if (cancelled) return;
        if (!fresh) {
          clearSession();
          setSession(null);
          setLoadError(t("chatSessionExpired"));
          setLoading(false);
          return;
        }
        saveSession(fresh);
        setSession(fresh);
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

        const [mems, important] = await Promise.all([
          listMembers(fresh, { includeRemoved: true }),
          listImportantNotifications(fresh),
        ]);
        if (cancelled) return;
        setMembers(mems);
        setImportantNotifications(important);
        setDismissedImportantIds(
          getDismissedImportantIds(fresh.family_id, fresh.member_id),
        );

        const syncResult = await syncMessages(fresh, {
          forceFullRefresh: cached.length === 0,
          onMessages: (next) => {
            if (!cancelled) setMessages(filterVisibleMessages(next, fresh));
          },
        });
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
    if (!session) return;
    const sb = getSupabase();
    const realtimeTimers = realtimeEventTimersRef.current;

    const scheduleRealtimeFetch = (event: MessageRealtimeEvent) => {
      const existingTimer = realtimeTimers.get(event.message_id);
      if (existingTimer) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        realtimeTimers.delete(event.message_id);
        fetchRealtimeMessage(event.message_id).catch(() => undefined);
      }, 80);
      realtimeTimers.set(event.message_id, timer);
    };

    const messageEventsChannel = sb
      .channel(`message_events:${session.family_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_realtime_events",
          filter: `family_id=eq.${session.family_id}`,
        },
        (payload) => {
          scheduleRealtimeFetch(payload.new as MessageRealtimeEvent);
        },
      )
      .subscribe((status) => {
        if (typeof window !== "undefined") {
          // eslint-disable-next-line no-console
          console.log(`[realtime message events] ${status}`);
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
          const event = payload.new as ImportantNotificationRealtimeEvent;
          if (event.family_id !== session.family_id) return;
          refreshImportantNotifications(session).catch(() => undefined);
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
      .subscribe();

    const syncVisibleMessages = () => {
      if (document.visibilityState !== "visible") return;
      syncMessages(session, { onMessages: handleSyncedMessages }).catch(
        () => undefined,
      );
    };
    const refreshVisibleImportantNotifications = () => {
      if (document.visibilityState !== "visible") return;
      refreshImportantNotifications(session).catch(() => undefined);
    };
    const refreshVisibleChatData = () => {
      syncVisibleMessages();
      refreshVisibleImportantNotifications();
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

    let visibilityTimer = 0;
    const debouncedVisibilityRefresh = () => {
      window.clearTimeout(visibilityTimer);
      visibilityTimer = window.setTimeout(refreshVisibleChatData, 500);
    };

    window.addEventListener("focus", refreshVisibleChatData);
    window.addEventListener("online", refreshVisibleChatData);
    document.addEventListener("visibilitychange", debouncedVisibilityRefresh);

    return () => {
      sb.removeChannel(messageEventsChannel);
      sb.removeChannel(importantEventsChannel);
      sb.removeChannel(membersChannel);
      window.clearInterval(messagePoll);
      window.clearInterval(importantPoll);
      window.clearInterval(metadataPoll);
      window.removeEventListener("focus", refreshVisibleChatData);
      window.removeEventListener("online", refreshVisibleChatData);
      document.removeEventListener("visibilitychange", debouncedVisibilityRefresh);
      window.clearTimeout(visibilityTimer);
      realtimeTimers.forEach((timer) => window.clearTimeout(timer));
      realtimeTimers.clear();
    };
  }, [
    fetchRealtimeMessage,
    handleSyncedMessages,
    refreshImportantNotifications,
    router,
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
    const shouldScrollImmediately =
      !didInitialScrollRef.current ||
      forceImmediateBottomScrollRef.current ||
      isIOSRef.current;
    scrollToBottom(shouldScrollImmediately ? "auto" : "smooth");
    forceImmediateBottomScrollRef.current = false;
    didInitialScrollRef.current = true;
  }, [loading, messages.length, scrollToBottom]);

  useEffect(() => {
    if (loading || messages.length === 0) return;
    const content = messagesContentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => scrollToBottom("auto"));
    });

    observer.observe(content);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [loading, messages.length, scrollToBottom]);

  // Scroll to the message targeted by a notification click (?mid=xxx).
  const hasScrolledToNotifiedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mid = params.get("mid");
    if (!mid || hasScrolledToNotifiedRef.current) return;
    if (messages.some((m) => m.id === mid)) {
      hasScrolledToNotifiedRef.current = true;
      window.setTimeout(() => scrollToMessage(mid), 300);
    }
  }, [messages, scrollToMessage]);

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
    setWhisperParamInUrl(target.id);
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

  function pushOptimistic(
    partial: Pick<Message, "id" | "message_type"> & Partial<Message>,
  ) {
    if (!session) return;
    forceImmediateBottomScrollRef.current = true;
    const now = new Date().toISOString();
    const optimistic: Message = {
      id: partial.id,
      family_id: session.family_id,
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

  function openMessageActions(
    message: Message,
    point: { x: number; y: number },
  ) {
    if (!session) return;
    const menuWidth = 180;
    const menuHeight = 152;
    const x =
      typeof window === "undefined"
        ? point.x
        : Math.min(Math.max(8, point.x), window.innerWidth - menuWidth - 8);
    const y =
      typeof window === "undefined"
        ? point.y
        : Math.min(Math.max(8, point.y), window.innerHeight - menuHeight - 8);
    setMessageActionMenu({ messageId: message.id, x, y });
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

  async function handleSendText(text: string) {
    if (!session) return;
    setSending(true);
    try {
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
    } catch (err) {
      toast.error(humanizeError(err, language));
    } finally {
      setSending(false);
    }
  }

  async function handlePickImage(file: File) {
    if (!session) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("chatImageTooLarge"));
      return;
    }
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
    return (
      <div className="flex flex-1 items-center justify-center text-slate-500">
        {t("commonLoading")}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 py-8">
        <div className="card w-full max-w-md text-center">
          <h1 className="text-lg font-bold text-slate-900">
            {t("chatLoadFailedTitle")}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            {loadError}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setRetryNonce((value) => value + 1)}
            >
              {t("chatRetry")}
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
              onClick={() => {
                clearSession();
                router.replace("/");
              }}
            >
              {t("chatBackHome")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div
      className="flex overflow-hidden flex-col"
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
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => setMessageActionMenu(null)}
          />
          <div
            className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-xl"
            style={{ left: messageActionMenu.x, top: messageActionMenu.y }}
          >
            {selectedActionMessage.recipient_member_id ? null : selectedActionNotification ? (
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50"
                onClick={() => handleRemoveImportant(selectedActionNotification.id)}
              >
                {t("importantUnset")}
              </button>
            ) : !selectedActionMessage.deleted_at ? (
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50"
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
                className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50"
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
                className="block w-full px-4 py-2 text-left text-rose-600 hover:bg-rose-50"
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
      <header
        className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-2 sm:px-6"
        onDoubleClick={handleHeaderDoubleClick}
        onTouchEnd={handleHeaderTouchEnd}
      >
        <div className="min-w-0">
          <div className="text-[12px] leading-4 text-slate-500">{t("chatFamily")}</div>
          <div className="truncate text-lg font-bold leading-6 text-slate-900">
            {session.family_name}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-cover bg-center bg-no-repeat shadow-sm ring-1 ring-slate-200/70 transition hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
            style={{
              backgroundImage: `url(${
                push.enabled ? "/ui-icons/notify-on.png" : "/ui-icons/notify-off.png"
              })`,
            }}
            aria-label={push.enabled ? t("chatNotifyOff") : t("chatNotifyOn")}
            title={
              push.enabled
                ? t("chatNotifyOff")
                : push.support?.permission === "denied"
                  ? t("chatNotifyDenied")
                  : t("chatNotifyOn")
            }
            disabled={push.busy}
            onClick={handleToggleNotifications}
          />
          <Link
            href="/members"
            className="inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-cover bg-center bg-no-repeat shadow-sm ring-1 ring-slate-200/70 transition hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
            style={{ backgroundImage: "url(/ui-icons/members.png)" }}
            aria-label={t("chatMembers")}
            title={t("chatMembers")}
          />
          <Link
            href="/settings"
            className="inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-cover bg-center bg-no-repeat shadow-sm ring-1 ring-slate-200/70 transition hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
            style={{ backgroundImage: "url(/ui-icons/settings.png)" }}
            aria-label={t("chatSettings")}
            title={t("chatSettings")}
          />
        </div>
      </header>

      {error ? (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      <ImportantNoticeBar
        notifications={visibleImportantNotifications}
        members={memberMap}
        onSelect={handleSelectImportant}
        onRemove={(notification) => handleRemoveImportant(notification.id)}
      />

      <div
        ref={scrollRef}
        onTouchStart={handleMessagesTouchStart}
        onTouchEnd={handleMessagesTouchEnd}
        className="no-scrollbar flex-1 min-h-0 overflow-y-auto overscroll-contain bg-slate-50 bg-cover bg-center bg-no-repeat px-3 pt-4 sm:px-5"
        style={{
          ...(chatBackgroundUrl
            ? {
                backgroundImage: `linear-gradient(rgba(248, 250, 252, 0.82), rgba(248, 250, 252, 0.82)), url("${chatBackgroundUrl}")`,
              }
            : {}),
        }}
      >
        <div ref={messagesContentRef} className="space-y-4">
          {messages.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              {t("chatEmpty")}
            </div>
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
                  className="scroll-mb-28 rounded-3xl"
                  style={{
                    scrollMarginBottom:
                      "calc(104px + env(safe-area-inset-bottom))",
                  }}
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
                    onRequestActions={canOpenActions ? openMessageActions : undefined}
                    onReplayEffect={handleReplayEffect}
                  />
                </div>
              );
            })
          )}
          <div
            ref={messagesEndRef}
            aria-hidden
            style={{
              height: `calc(${whisperTarget ? 140 : 96}px + env(safe-area-inset-bottom))`,
            }}
          />
        </div>
      </div>

      {whisperTarget ? (
        <div
          className="fixed inset-x-0 z-40 mx-auto flex h-10 w-full max-w-3xl items-center justify-between gap-2 border-t border-violet-100 bg-violet-50/95 px-3 text-sm text-violet-800 shadow-sm backdrop-blur sm:px-4"
          style={{ bottom: "calc(61px + env(safe-area-inset-bottom))" }}
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
            className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"
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
      />
    </div>
  );
}
