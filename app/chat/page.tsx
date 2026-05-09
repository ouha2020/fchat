"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import EffectOverlay from "@/components/EffectOverlay";
import EnvWarning from "@/components/EnvWarning";
import ImportantNoticeBar from "@/components/ImportantNoticeBar";
import { useLanguage } from "@/components/LanguageProvider";
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
  listMessages,
  sendMessage,
  uploadChatAudio,
  uploadChatImage,
} from "@/lib/messageService";
import { getCurrentLocation, createGoogleMapUrl } from "@/lib/locationService";
import {
  getNotificationPermission,
  installAudioUnlock,
  playNotificationSound,
  requestNotificationPermission,
  showBrowserNotification,
  vibrate,
  type NotificationPerm,
} from "@/lib/notify";
import {
  getNotificationsEnabled,
  setNotificationsEnabled,
} from "@/lib/notificationPreference";
import type { RecordingResult } from "@/lib/recordingService";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import type { ImportantNotification } from "@/types/importantNotification";
import type { FamilyMember } from "@/types/member";
import type { Message } from "@/types/message";

export default function ChatPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
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
  const [chatBackgroundUrl, setChatBackgroundUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const membersRef = useRef<FamilyMember[]>([]);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);
  const [effectShow, setEffectShow] = useState<{
    effect: Effect;
    key: string;
  } | null>(null);
  const triggeredEffectIdsRef = useRef<Set<string>>(new Set());
  const handleEffectDone = useCallback(() => setEffectShow(null), []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
    };

    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.height = "100dvh";
    body.style.overscrollBehavior = "none";

    return () => {
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

  // Notifications: in-app sound + title badge + browser notification.
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifPerm, setNotifPerm] = useState<NotificationPerm>("default");
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const notifyEnabledRef = useRef(true);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const sessionRef = useRef<LocalSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    notifyEnabledRef.current = notifyEnabled;
  }, [notifyEnabled]);

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

  // Sync notification permission state on mount and when the tab regains focus.
  useEffect(() => {
    setNotifPerm(getNotificationPermission());
    function onVisibility() {
      if (!document.hidden) {
        setUnreadCount(0);
        setNotifPerm(getNotificationPermission());
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setNotifyEnabled(true);
      return;
    }
    setNotifyEnabled(getNotificationsEnabled(session.family_id));
  }, [session]);

  const refreshImportantNotifications = useCallback(async (familyId: string) => {
    const rows = await listImportantNotifications(familyId);
    setImportantNotifications(rows);
  }, []);

  // Title badge for unread count.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const base = t("appTitle");
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [t, unreadCount]);

  async function handleToggleNotifications() {
    if (!session) return;
    if (notifyEnabled) {
      setNotificationsEnabled(session.family_id, false);
      setNotifyEnabled(false);
      setUnreadCount(0);
      return;
    }

    const perm = await requestNotificationPermission();
    setNotifPerm(perm);
    if (perm === "granted") {
      setNotificationsEnabled(session.family_id, true);
      setNotifyEnabled(true);
      alert(t("chatNotifyEnabledAlert"));
    } else if (perm === "denied") {
      alert(t("chatNotifyDeniedAlert"));
    } else if (perm === "unsupported") {
      alert(t("chatNotifyUnsupportedAlert"));
    }
  }

  // Bootstrap: validate session, then load data.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      const local = loadSession();
      if (!local) {
        router.replace("/");
        return;
      }
      try {
        const fresh = await validateMember(local.member_id, local.member_token);
        if (cancelled) return;
        if (!fresh) {
          clearSession();
          router.replace("/");
          return;
        }
        saveSession(fresh);
        setSession(fresh);

        const [msgs, mems, important] = await Promise.all([
          listMessages(fresh.family_id),
          listMembers(fresh.family_id, { includeRemoved: true }),
          listImportantNotifications(fresh.family_id),
        ]);
        if (cancelled) return;
        setMessages(msgs);
        setMembers(mems);
        setImportantNotifications(important);
        setDismissedImportantIds(
          getDismissedImportantIds(fresh.family_id, fresh.member_id),
        );
      } catch (err) {
        if (!cancelled) setError(humanizeError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Realtime subscription for new messages.
  useEffect(() => {
    if (!session) return;
    const sb = getSupabase();

    const messagesChannel = sb
      .channel(`messages:${session.family_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `family_id=eq.${session.family_id}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
          // Always attempt the effect — tryTriggerEffect dedupes by id via
          // the ref, so re-runs (Realtime echo, polling) are safe. Doing
          // this OUTSIDE the setMessages updater avoids React 18's batched
          // updater scheduling, which kept the previous "isNew" closure
          // false for subsequent triggers.
          const eff =
            effectFromColumns(
              incoming.effect_id,
              incoming.effect_caption,
            ) ??
            (incoming.message_type === "text"
              ? detectEffect(incoming.content)
              : null);
          tryTriggerEffect(incoming.id, eff);
          // If the sender isn't in our member map yet (e.g. they just joined
          // and the family_members realtime event hasn't landed), refresh.
          if (
            incoming.sender_member_id &&
            !membersRef.current.some((m) => m.id === incoming.sender_member_id)
          ) {
            listMembers(session.family_id, { includeRemoved: true })
              .then(setMembers)
              .catch(() => undefined);
          }
          // Notification path — once per message id, only for inbound,
          // non-system, non-deleted messages.
          const me = sessionRef.current;
          if (
            me &&
            incoming.sender_member_id &&
            incoming.sender_member_id !== me.member_id &&
            incoming.message_type !== "system" &&
            !incoming.deleted_at &&
            notifyEnabledRef.current &&
            !notifiedIdsRef.current.has(incoming.id)
          ) {
            notifiedIdsRef.current.add(incoming.id);
            playNotificationSound();
            if (typeof document !== "undefined" && document.hidden) {
              setUnreadCount((c) => c + 1);
              vibrate(120);
              const sender = membersRef.current.find(
                (m) => m.id === incoming.sender_member_id,
              );
              const senderName = sender?.nickname ?? t("chatFamily");
              const previewMap: Record<string, string> = {
                image: t("notifyImagePreview"),
                audio: t("notifyAudioPreview"),
                location: t("notifyLocationPreview"),
              };
              const preview =
                previewMap[incoming.message_type] ??
                (incoming.content ?? "").slice(0, 80);
              showBrowserNotification(senderName, preview);
            }
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `family_id=eq.${session.family_id}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
          );
        },
      )
      .subscribe((status) => {
        if (typeof window !== "undefined") {
          // eslint-disable-next-line no-console
          console.log(`[realtime messages] ${status}`);
        }
      });

    const importantChannel = sb
      .channel(`important_notifications:${session.family_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "important_notifications",
          filter: `family_id=eq.${session.family_id}`,
        },
        () => {
          refreshImportantNotifications(session.family_id).catch(() => undefined);
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
          listMembers(session.family_id, { includeRemoved: true })
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
            alert(t("chatRemoved"));
            router.replace("/");
          }
        },
      )
      .subscribe();

    // Fallback: poll messages every 8s in case Realtime drops events or the
    // table is not in the supabase_realtime publication. Optimistic dedup
    // by id keeps this safe.
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      listMessages(session.family_id)
        .then((rows) => {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const merged = [...prev];
            for (const r of rows) {
              if (!seen.has(r.id)) merged.push(r);
            }
            merged.sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime(),
            );
            return merged;
          });
        })
        .catch(() => undefined);
    }, 8000);

    return () => {
      sb.removeChannel(messagesChannel);
      sb.removeChannel(importantChannel);
      sb.removeChannel(membersChannel);
      window.clearInterval(interval);
    };
  }, [refreshImportantNotifications, router, session, t]);

  // Auto scroll to bottom on new messages.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages.length]);

  const memberMap = useMemo(() => {
    const m = new Map<string, FamilyMember>();
    members.forEach((mem) => m.set(mem.id, mem));
    return m;
  }, [members]);

  const importantByMessageId = useMemo(() => {
    const m = new Map<string, ImportantNotification>();
    importantNotifications.forEach((notification) => {
      if (!notification.removed_at) m.set(notification.message_id, notification);
    });
    return m;
  }, [importantNotifications]);

  const visibleImportantNotifications = useMemo(
    () =>
      importantNotifications.filter(
        (notification) =>
          !notification.removed_at && !dismissedImportantIds.has(notification.id),
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
    setMessages((prev) => {
      if (prev.some((m) => m.id === partial.id)) return prev;
      const optimistic: Message = {
        id: partial.id,
        family_id: session.family_id,
        sender_member_id: session.member_id,
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
        deleted_at: null,
        deleted_by_member_id: null,
        created_at: new Date().toISOString(),
      };
      return [...prev, optimistic];
    });
  }

  async function handleDeleteMessage(messageId: string) {
    if (!session) return;
    const ok = window.confirm(t("chatDeleteConfirm"));
    if (!ok) return;
    try {
      await deleteMessage(session, messageId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, deleted_at: new Date().toISOString(), deleted_by_member_id: session.member_id }
            : m,
        ),
      );
    } catch (err) {
      alert(humanizeError(err, language));
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

  function handleSetMessageImageBackground(message: Message) {
    if (!session || !message.image_url) return;
    setMessageActionMenu(null);
    const ok = window.confirm(t("previewSetBackgroundConfirm"));
    if (!ok) return;
    setChatBackground(session.family_id, message.image_url);
    alert(t("previewBackgroundSet"));
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
      await refreshImportantNotifications(session.family_id);
    } catch (err) {
      alert(
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
      await refreshImportantNotifications(session.family_id);
      setDismissedImportantIds((prev) => {
        const next = new Set(prev);
        next.delete(notificationId);
        saveDismissedImportantIds(session.family_id, session.member_id, next);
        return next;
      });
    } catch (err) {
      alert(
        t("importantRemoveFailed", {
          message: humanizeError(err, language),
        }),
      );
    }
  }

  function scrollToMessage(messageId: string) {
    const el = messageRefs.current.get(messageId);
    if (!el) return;
    el.scrollIntoView({ block: "end", behavior: "smooth" });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => {
      setHighlightedMessageId((current) =>
        current === messageId ? null : current,
      );
    }, 1500);
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

  function tryTriggerEffect(messageId: string, eff: Effect | null) {
    if (!eff) return;
    if (triggeredEffectIdsRef.current.has(messageId)) return;
    triggeredEffectIdsRef.current.add(messageId);
    // Unique key per trigger forces React to unmount the previous overlay
    // so the CSS keyframes restart from 0 — otherwise the second hit would
    // reuse particles that have already animated off-screen.
    setEffectShow({ effect: eff, key: `${messageId}-${Date.now()}` });
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
      });
      pushOptimistic({
        id,
        message_type: "text",
        content,
        effect_id: eff?.id ?? null,
        effect_caption: eff?.caption ?? null,
      });
      tryTriggerEffect(id, eff);
    } catch (err) {
      alert(humanizeError(err, language));
    } finally {
      setSending(false);
    }
  }

  async function handlePickImage(file: File) {
    if (!session) return;
    if (file.size > 8 * 1024 * 1024) {
      alert(t("chatImageTooLarge"));
      return;
    }
    setSending(true);
    try {
      const url = await uploadChatImage(session.family_id, file);
      const id = await sendMessage(session, {
        type: "image",
        image_url: url,
        content: t("chatImageMessage"),
      });
      pushOptimistic({
        id,
        message_type: "image",
        image_url: url,
        content: t("chatImageMessage"),
      });
    } catch (err) {
      alert(humanizeError(err, language));
    } finally {
      setSending(false);
    }
  }

  async function handleSendAudio(result: RecordingResult) {
    if (!session) return;
    if (result.blob.size > 12 * 1024 * 1024) {
      alert(t("chatAudioTooLarge"));
      return;
    }
    setSending(true);
    try {
      const url = await uploadChatAudio(
        session.family_id,
        result.blob,
        result.mimeType,
      );
      const id = await sendMessage(session, {
        type: "audio",
        audio_url: url,
        audio_duration_ms: result.durationMs,
        content: t("chatAudioMessage"),
      });
      pushOptimistic({
        id,
        message_type: "audio",
        audio_url: url,
        audio_duration_ms: result.durationMs,
        content: t("chatAudioMessage"),
      });
    } catch (err) {
      alert(humanizeError(err, language));
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
      });
      pushOptimistic({
        id,
        message_type: "location",
        content: t("chatLocationMessage"),
        latitude: fix.latitude,
        longitude: fix.longitude,
        map_url: mapUrl,
      });
    } catch (err) {
      alert(humanizeError(err, language) || t("chatLocationError"));
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

  if (!session) {
    return null;
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden flex-col">
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
            {selectedActionNotification ? (
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
              session.is_admin) ? (
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
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-2 sm:px-6">
        <div className="min-w-0">
          <div className="text-[12px] leading-4 text-slate-500">{t("chatFamily")}</div>
          <div className="truncate text-lg font-bold leading-6 text-slate-900">
            {session.family_name}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {notifPerm !== "unsupported" ? (
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-cover bg-center bg-no-repeat shadow-sm ring-1 ring-slate-200/70 transition hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
              style={{
                backgroundImage: `url(${
                  notifyEnabled && notifPerm === "granted"
                    ? "/ui-icons/notify-on.png"
                    : "/ui-icons/notify-off.png"
                })`,
              }}
              aria-label={
                notifyEnabled && notifPerm === "granted"
                  ? t("chatNotifyOff")
                  : t("chatNotifyOn")
              }
              title={
                notifyEnabled && notifPerm === "granted"
                  ? t("chatNotifyOff")
                  : notifPerm === "denied"
                    ? t("chatNotifyDenied")
                    : t("chatNotifyOn")
              }
              onClick={handleToggleNotifications}
            />
          ) : null}
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
            style={{
              backgroundImage: "url(/ui-icons/settings.png)",
              backgroundSize: "118%",
            }}
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
        className="flex-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain bg-slate-50 bg-cover bg-center bg-no-repeat px-3 pt-4 sm:px-5"
        style={{
          paddingBottom: "calc(88px + env(safe-area-inset-bottom))",
          ...(chatBackgroundUrl
            ? {
                backgroundImage: `linear-gradient(rgba(248, 250, 252, 0.82), rgba(248, 250, 252, 0.82)), url("${chatBackgroundUrl}")`,
              }
            : {}),
        }}
      >
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
                    "calc(96px + env(safe-area-inset-bottom))",
                }}
              >
                <ChatMessage
                  message={m}
                  sender={
                    m.sender_member_id
                      ? memberMap.get(m.sender_member_id) ?? null
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
        <div ref={messagesEndRef} className="h-4" aria-hidden />
      </div>

      <ChatInput
        sending={sending}
        onSendText={handleSendText}
        onPickImage={handlePickImage}
        onSendLocation={handleSendLocation}
        onSendAudio={handleSendAudio}
      />
    </div>
  );
}
