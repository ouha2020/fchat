"use client";

import Image from "next/image";
import { useEffect, useId, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatTime } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";
import { formatDuration } from "@/lib/recordingService";
import { safeHttpUrl } from "@/lib/security";
import { localizeSystemMessage } from "@/lib/systemMessage";
import type {
  ImportantNotification,
  ImportantNotificationReadState,
} from "@/types/importantNotification";
import type { FamilyMember } from "@/types/member";
import type { Message } from "@/types/message";

interface Props {
  notifications: ImportantNotification[];
  members: Map<string, FamilyMember>;
  readStates?: Map<string, ImportantNotificationReadState>;
  onRequestReadState?: (notificationId: string) => void;
  onSelect: (notification: ImportantNotification) => void;
  onRemove: (notification: ImportantNotification) => void;
}

export default function ImportantNoticeBar({
  notifications,
  members,
  readStates,
  onRequestReadState,
  onSelect,
  onRemove,
}: Props) {
  const { language, t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  useEffect(() => {
    if (!expanded || !onRequestReadState) return;
    notifications.forEach((notification) => {
      if (!readStates?.has(notification.id)) {
        onRequestReadState(notification.id);
      }
    });
  }, [expanded, notifications, onRequestReadState, readStates]);

  if (notifications.length === 0) return null;

  const latest = notifications[0] ?? null;
  const latestPreview = latest ? buildPreview(latest.message, t).text : "";

  return (
    <section className="border-b border-white/70 bg-[#fffaf0]/80 px-3 py-1.5 shadow-[0_8px_18px_rgba(120,80,20,0.05)] backdrop-blur-xl sm:px-5">
      <button
        type="button"
        className="native-press flex min-h-10 w-full items-start justify-between gap-2 overflow-hidden rounded-2xl px-2 py-1 text-left text-[13px] leading-4 text-amber-800 transition hover:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-label={`${expanded ? t("importantCollapse") : t("importantExpand")} ${t(
          "importantTitle",
        )}`}
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            {t("importantTitle")}{" "}
            <span className="tabular-nums">
              {t("importantCount", { count: notifications.length })}
            </span>
          </div>
          {!expanded && latest ? (
            <div className="mt-0.5 truncate text-[12px] leading-4 text-slate-600">
              {t("importantLatest", { preview: latestPreview })}
            </div>
          ) : null}
        </div>
        <span className="inline-flex min-h-7 shrink-0 items-center rounded-full px-2 py-0.5 text-[12px] font-medium leading-4 text-amber-700">
          {expanded ? t("importantCollapse") : t("importantExpand")}
        </span>
      </button>
      {expanded ? (
        <div
          id={listId}
          role="list"
          className="native-scroll mt-2 max-h-[32dvh] space-y-1 overflow-y-auto pr-1"
        >
          {notifications.map((notification) => {
            const message = notification.message;
            const sender =
              message?.sender_member_id != null
                ? members.get(message.sender_member_id)
                : null;
            const preview = buildPreview(message, t);
            const readState = readStates?.get(notification.id) ?? null;

            return (
              <div
                key={notification.id}
                role="listitem"
                className="group flex items-start gap-2 rounded-2xl border border-white/70 bg-white/[0.82] px-2 py-1.5 text-left shadow-[0_8px_20px_rgba(120,80,20,0.08)] transition hover:bg-white/95"
              >
                <button
                  type="button"
                  className="native-press flex min-h-10 min-w-0 flex-1 items-start gap-2 rounded-xl px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
                  title={`${sender?.nickname ?? t("importantSystemSender")} / ${preview.text}`}
                  onClick={() => onSelect(notification)}
                >
                  <PreviewIcon message={message} text={preview.iconText} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="truncate text-xs font-semibold text-slate-700">
                        {sender?.nickname ?? t("importantSystemSender")}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {formatTime(notification.created_at, language)}
                      </span>
                    </span>
                    <span className="block truncate text-xs leading-4 text-slate-600">
                      {preview.text}
                    </span>
                    <ReadStateLine state={readState} />
                  </span>
                </button>
                <button
                  type="button"
                  className="native-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
                  aria-label={t("importantRemove")}
                  title={t("importantRemove")}
                  onClick={() => onRemove(notification)}
                >
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function buildPreview(
  message: Message | null,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): { text: string; iconText: string } {
  if (!message) {
    return { text: t("importantDeletedMessage"), iconText: "!" };
  }
  if (message.deleted_at) {
    return { text: t("importantDeletedMessage"), iconText: "!" };
  }

  if (message.message_type === "system") {
    return {
      text: truncate(localizeSystemMessage(message, t), 40),
      iconText: "!",
    };
  }

  if (message.message_type === "image") {
    return { text: t("importantImagePreview"), iconText: "" };
  }

  if (message.message_type === "audio") {
    return {
      text: t("importantAudioPreview", {
        duration: formatDuration(message.audio_duration_ms ?? 0),
      }),
      iconText: "",
    };
  }

  if (message.message_type === "location") {
    const coords =
      message.latitude != null && message.longitude != null
        ? `${message.latitude.toFixed(5)}, ${message.longitude.toFixed(5)}`
        : "";
    return {
      text: truncate(
        message.address || coords || message.content || t("importantLocationPreview"),
        40,
      ),
      iconText: "",
    };
  }

  return {
    text: truncate(message.effect_caption || message.content || "", 40),
    iconText: "!",
  };
}

function PreviewIcon({
  message,
  text,
}: {
  message: Message | null;
  text: string;
}) {
  if (message?.message_type === "image" && message.image_url && !message.deleted_at) {
    const imageUrl = safeHttpUrl(message.image_url);
    if (!imageUrl) return null;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        className="h-9 w-9 shrink-0 rounded-xl object-cover shadow-[0_5px_12px_rgba(71,64,49,0.1)] ring-1 ring-white/80"
        draggable={false}
      />
    );
  }

  const src =
    message?.message_type === "audio"
      ? "/ui-icons/voice.png"
      : message?.message_type === "location"
        ? "/ui-icons/location.png"
        : null;

  if (src && !message?.deleted_at) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/90 shadow-[0_5px_12px_rgba(71,64,49,0.08)] ring-1 ring-white/80">
        <Image src={src} alt="" width={24} height={24} className="h-6 w-6 object-contain" />
      </span>
    );
  }

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/90 text-sm font-semibold text-amber-700 shadow-[0_5px_12px_rgba(71,64,49,0.08)] ring-1 ring-white/80">
      {text}
    </span>
  );
}

function ReadStateLine({
  state,
}: {
  state: ImportantNotificationReadState | null;
}) {
  const { t } = useLanguage();
  if (!state) {
    return (
      <span className="mt-0.5 block truncate text-[11px] leading-4 text-slate-400">
        {t("importantReadLoading")}
      </span>
    );
  }

  const unreadNames = state.unreadNicknames.slice(0, 3).join(", ");
  const extra =
    state.unreadNicknames.length > 3
      ? ` +${state.unreadNicknames.length - 3}`
      : "";
  const summary = t("importantReadSummary", {
    read: state.readCount,
    unread: state.unreadCount,
  });
  const unreadSummary =
    state.unreadCount > 0 && unreadNames
      ? ` / ${t("importantUnreadMembers", { names: `${unreadNames}${extra}` })}`
      : "";

  return (
    <span
      className="mt-0.5 block truncate text-[11px] leading-4 text-amber-700/80"
      title={`${summary}${unreadSummary}`}
    >
      {summary}
      {unreadSummary}
    </span>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
