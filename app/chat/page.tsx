"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import EnvWarning from "@/components/EnvWarning";
import { clearSession, loadSession, saveSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import { validateMember } from "@/lib/familyService";
import { listMembers } from "@/lib/memberService";
import { listMessages, sendMessage, uploadChatImage } from "@/lib/messageService";
import { getCurrentLocation, createGoogleMapUrl } from "@/lib/locationService";
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
    const channel = sb
      .channel(`family-chat-${session.family_id}`)
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
        },
      )
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

    return () => {
      sb.removeChannel(channel);
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
        latitude: partial.latitude ?? null,
        longitude: partial.longitude ?? null,
        address: partial.address ?? null,
        map_url: partial.map_url ?? null,
        created_at: new Date().toISOString(),
      };
      return [...prev, optimistic];
    });
  }

  async function handleSendText(text: string) {
    if (!session) return;
    setSending(true);
    try {
      const id = await sendMessage(session, { type: "text", content: text });
      pushOptimistic({ id, message_type: "text", content: text });
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
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <div className="text-sm text-slate-500">家庭</div>
          <div className="text-base font-semibold">{session.family_name}</div>
        </div>
        <div className="flex items-center gap-1">
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
          messages.map((m) => (
            <ChatMessage
              key={m.id}
              message={m}
              sender={m.sender_member_id ? memberMap.get(m.sender_member_id) ?? null : null}
              isMine={m.sender_member_id === session.member_id}
            />
          ))
        )}
      </div>

      <ChatInput
        sending={sending}
        onSendText={handleSendText}
        onPickImage={handlePickImage}
        onSendLocation={handleSendLocation}
      />
    </div>
  );
}
