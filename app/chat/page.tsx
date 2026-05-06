"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import EffectOverlay from "@/components/EffectOverlay";
import EnvWarning from "@/components/EnvWarning";
import { clearSession, loadSession, saveSession, type LocalSession } from "@/lib/authLocal";
import { effectFromColumns, transformForSending, type Effect, detectEffect } from "@/lib/effects";
import { humanizeError } from "@/lib/errors";
import { validateMember } from "@/lib/familyService";
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
import type { RecordingResult } from "@/lib/recordingService";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import type { FamilyMember } from "@/types/member";
import type { Message } from "@/types/message";

export default function ChatPage() {
  const router = useRouter();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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

  // Notifications: in-app sound + title badge + browser notification.
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifPerm, setNotifPerm] = useState<NotificationPerm>("default");
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const sessionRef = useRef<LocalSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
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

  // Title badge for unread count.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const base = "家人聊天室";
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [unreadCount]);

  async function handleEnableNotifications() {
    const perm = await requestNotificationPermission();
    setNotifPerm(perm);
    if (perm === "granted") {
      alert("已开启浏览器通知，新消息会在标签页隐藏时弹出提醒。");
    } else if (perm === "denied") {
      alert("浏览器已拒绝通知权限，请在浏览器设置中手动允许。");
    } else if (perm === "unsupported") {
      alert("当前浏览器不支持网页通知。");
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

        const [msgs, mems] = await Promise.all([
          listMessages(fresh.family_id),
          listMembers(fresh.family_id),
        ]);
        if (cancelled) return;
        setMessages(msgs);
        setMembers(mems);
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
            listMembers(session.family_id)
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
              const senderName = sender?.nickname ?? "家人";
              const previewMap: Record<string, string> = {
                image: "[图片]",
                audio: "[语音]",
                location: "[位置]",
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
        () => {
          listMembers(session.family_id)
            .then(setMembers)
            .catch(() => undefined);
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
      sb.removeChannel(membersChannel);
      window.clearInterval(interval);
    };
  }, [session]);

  // Auto scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const memberMap = useMemo(() => {
    const m = new Map<string, FamilyMember>();
    members.forEach((mem) => m.set(mem.id, mem));
    return m;
  }, [members]);

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
    const ok = window.confirm("删除这条消息？所有家人将看到「消息已撤回」。");
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
      alert(humanizeError(err));
    }
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
      alert(humanizeError(err));
    } finally {
      setSending(false);
    }
  }

  async function handlePickImage(file: File) {
    if (!session) return;
    if (file.size > 8 * 1024 * 1024) {
      alert("图片不能超过 8MB");
      return;
    }
    setSending(true);
    try {
      const url = await uploadChatImage(session.family_id, file);
      const id = await sendMessage(session, {
        type: "image",
        image_url: url,
        content: "图片消息",
      });
      pushOptimistic({
        id,
        message_type: "image",
        image_url: url,
        content: "图片消息",
      });
    } catch (err) {
      alert(humanizeError(err));
    } finally {
      setSending(false);
    }
  }

  async function handleSendAudio(result: RecordingResult) {
    if (!session) return;
    if (result.blob.size > 12 * 1024 * 1024) {
      alert("语音文件太大");
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
        content: "语音消息",
      });
      pushOptimistic({
        id,
        message_type: "audio",
        audio_url: url,
        audio_duration_ms: result.durationMs,
        content: "语音消息",
      });
    } catch (err) {
      alert(humanizeError(err));
    } finally {
      setSending(false);
    }
  }

  async function handleSendLocation() {
    if (!session) return;
    setSending(true);
    try {
      const fix = await getCurrentLocation();
      const ok = window.confirm(
        `是否发送当前位置？\n纬度：${fix.latitude.toFixed(5)}\n经度：${fix.longitude.toFixed(5)}`,
      );
      if (!ok) return;
      const mapUrl = createGoogleMapUrl(fix.latitude, fix.longitude);
      const id = await sendMessage(session, {
        type: "location",
        content: "发送了当前位置",
        latitude: fix.latitude,
        longitude: fix.longitude,
        map_url: mapUrl,
      });
      pushOptimistic({
        id,
        message_type: "location",
        content: "发送了当前位置",
        latitude: fix.latitude,
        longitude: fix.longitude,
        map_url: mapUrl,
      });
    } catch (err) {
      alert(humanizeError(err) || "无法获取位置，请确认浏览器定位权限已开启");
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
        加载中…
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      {effectShow ? (
        <EffectOverlay
          key={effectShow.key}
          effect={effectShow.effect}
          onDone={handleEffectDone}
        />
      ) : null}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <div className="text-sm text-slate-500">家庭</div>
          <div className="text-base font-semibold">{session.family_name}</div>
        </div>
        <div className="flex items-center gap-1">
          {notifPerm !== "unsupported" ? (
            <button
              type="button"
              className="btn-ghost h-9 px-2 text-base"
              aria-label={
                notifPerm === "granted" ? "已开启系统通知" : "开启系统通知"
              }
              title={
                notifPerm === "granted"
                  ? "已开启系统通知"
                  : notifPerm === "denied"
                    ? "通知被拒绝，请在浏览器设置中允许"
                    : "开启系统通知"
              }
              onClick={handleEnableNotifications}
            >
              {notifPerm === "granted" ? "🔔" : "🔕"}
            </button>
          ) : null}
          <Link href="/members" className="btn-ghost h-9 px-3 text-sm">
            成员
          </Link>
          <Link href="/settings" className="btn-ghost h-9 px-3 text-sm">
            设置
          </Link>
        </div>
      </header>

      {error ? (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain bg-slate-50 px-3 py-4 sm:px-5"
      >
        {messages.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">
            还没有消息，发个招呼吧 👋
          </div>
        ) : (
          messages.map((m) => {
            const isMine = m.sender_member_id === session.member_id;
            const canDelete =
              m.message_type !== "system" &&
              !m.deleted_at &&
              (isMine || session.is_admin);
            return (
              <ChatMessage
                key={m.id}
                message={m}
                sender={
                  m.sender_member_id
                    ? memberMap.get(m.sender_member_id) ?? null
                    : null
                }
                isMine={isMine}
                canDelete={canDelete}
                onRequestDelete={canDelete ? handleDeleteMessage : undefined}
              />
            );
          })
        )}
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
