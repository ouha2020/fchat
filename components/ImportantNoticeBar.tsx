"use client";

import Image from "next/image";
import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatTime } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";
import { formatDuration } from "@/lib/recordingService";
import { safeHttpUrl } from "@/lib/security";
import { localizeSystemMessage } from "@/lib/systemMessage";
import type { ImportantNotification } from "@/types/importantNotification";
import type { FamilyMember } from "@/types/member";
import type { Message } from "@/types/message";

interface Props {
  notifications: ImportantNotification[];
  members: Map<string, FamilyMember>;
  onSelect: (notification: ImportantNotification) => void;
  onRemove: (notification: ImportantNotification) => void;
}

export default function ImportantNoticeBar({
  notifications,
  members,
  onSelect,
  onRemove,
}: Props) {
  const { language, t } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  if (notifications.length === 0) return null;

  const latest = notifications[0] ?? null;
  const latestPreview = latest ? buildPreview(latest.message, t).text : "";

  return (
    <section className="border-b border-amber-100/70 bg-white/80 px-5 py-1.5 backdrop-blur sm:px-6">
      <div className="flex items-start justify-between gap-3 text-[13px] leading-4 text-amber-700">
        <div className="min-w-0">
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
        <button
          type="button"
          className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium leading-4 text-amber-700 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("importantCollapse") : t("importantExpand")}
        </button>
      </div>
      {expanded ? (
        <div className="mt-2 max-h-[120px] space-y-1 overflow-y-auto pr-1">
          {notifications.map((notification) => {
            const message = notification.message;
            const sender =
              message?.sender_member_id != null
                ? members.get(message.sender_member_id)
                : null;
            const preview = buildPreview(message, t);

            return (
              <div
                key={notification.id}
                className="group flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50/80 px-2 py-1.5 text-left shadow-sm transition hover:bg-amber-100/80"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => onSelect(notification)}
                >
                  <PreviewIcon message={message} text={preview.iconText} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-slate-700">
                        {sender?.nickname ?? t("importantSystemSender")}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {formatTime(notification.created_at, language)}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-slate-600">
                      {preview.text}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl leading-none text-slate-400 transition hover:bg-white hover:text-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
                  aria-label={t("importantRemove")}
                  title={t("importantRemove")}
                  onClick={() => onRemove(notification)}
                >
                  ×
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
      text: truncate(localizeSystemMessage(message.content, t), 40),
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
        className="h-9 w-9 shrink-0 rounded-md object-cover"
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
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white">
        <Image src={src} alt="" width={24} height={24} className="h-6 w-6 object-contain" />
      </span>
    );
  }

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-sm font-semibold text-amber-600">
      {text}
    </span>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
