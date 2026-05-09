"use client";

import Link from "next/link";
import { useRef } from "react";

import AudioBubble from "./AudioBubble";
import { useLanguage } from "@/components/LanguageProvider";
import { formatTime } from "@/lib/format";
import {
  getSystemMessageTone,
  localizeSystemMessage,
} from "@/lib/systemMessage";
import type { TranslationKey } from "@/lib/i18n";
import type { Message } from "@/types/message";
import type { FamilyMember } from "@/types/member";
import type { FamilyRole } from "@/types/family";

const ROLE_KEYS: Record<FamilyRole, TranslationKey> = {
  father: "roleFather",
  mother: "roleMother",
  child: "roleChild",
};

interface Props {
  message: Message;
  sender: FamilyMember | null;
  isMine: boolean;
  highlighted?: boolean;
  onRequestActions?: (
    message: Message,
    point: { x: number; y: number },
  ) => void;
  onReplayEffect?: (message: Message) => void;
}

export default function ChatMessage({
  message,
  sender,
  isMine,
  highlighted,
  onRequestActions,
  onReplayEffect,
}: Props) {
  const { language, t } = useLanguage();
  const actionHandlers = useLongPress(
    (point) => onRequestActions?.(message, point),
    !!onRequestActions,
  );
  const actionClass = onRequestActions
    ? "cursor-pointer select-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
    : "";
  const roleLabel = sender ? t(ROLE_KEYS[sender.role]) : "";
  const showRole =
    !!sender && sender.nickname.trim().toLowerCase() !== roleLabel.trim().toLowerCase();
  const highlightClass = highlighted
    ? "ring-[3px] ring-amber-400 shadow-[0_0_0_2px_rgba(255,255,255,0.85),0_0_14px_rgba(245,158,11,0.45)]"
    : "";

  if (message.message_type === "system") {
    const tone = getSystemMessageTone(message.content);
    const toneClass =
      tone === "joined"
        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
        : tone === "left"
          ? "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
          : "bg-slate-200/70 text-slate-600";
    return (
      <div className="flex justify-center py-2" {...actionHandlers}>
        <span className={`rounded-full px-3 py-1 text-xs ${toneClass} ${actionClass} ${highlightClass}`}>
          {localizeSystemMessage(message.content, t)}
        </span>
      </div>
    );
  }

  if (message.deleted_at) {
    const label = isMine ? t("messageYouDeleted") : t("messageOtherDeleted");
    return (
      <div className="flex justify-center py-2" {...actionHandlers}>
        <span className={`rounded-full bg-slate-100 px-3 py-1 text-xs italic text-slate-500 ${highlightClass}`}>
          {label}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex w-full gap-2 ${isMine ? "flex-row-reverse" : "flex-row"}`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
          isMine ? "bg-brand-500 text-white" : "bg-slate-200 text-slate-700"
        }`}
      >
        {(sender?.nickname ?? "?").slice(0, 1).toUpperCase()}
      </div>
      <div
        className={`flex max-w-[75%] flex-col gap-1 ${
          isMine ? "items-end" : "items-start"
        }`}
      >
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="font-medium text-slate-700">
            {sender?.nickname ?? t("commonUnknownMember")}
          </span>
          {showRole ? (
            <>
              <span className="text-slate-300">·</span>
              <span className="font-medium text-slate-500">
                {roleLabel}
              </span>
            </>
          ) : null}
          <span className="text-slate-300">·</span>
          <span>{formatTime(message.created_at, language)}</span>
        </div>
        <Bubble
          message={message}
          isMine={isMine}
          highlighted={highlighted}
          actionHandlers={actionHandlers}
          actionClass={actionClass}
          onReplayEffect={
            message.effect_id && onReplayEffect
              ? () => onReplayEffect(message)
              : undefined
          }
        />
      </div>
    </div>
  );
}

function useLongPress(
  onLongPress: (point: { x: number; y: number }) => void,
  enabled: boolean,
) {
  const timeoutRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  function clear() {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function start(point: { x: number; y: number }) {
    if (!enabled) return;
    firedRef.current = false;
    clear();
    timeoutRef.current = window.setTimeout(() => {
      firedRef.current = true;
      onLongPress(point);
    }, 500);
  }

  function cancel() {
    clear();
  }

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      start({ x: touch.clientX, y: touch.clientY });
    },
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onTouchCancel: cancel,
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      start({ x: e.clientX, y: e.clientY });
    },
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      if (!enabled) return;
      e.preventDefault();
      cancel();
      onLongPress({ x: e.clientX, y: e.clientY });
    },
    // Suppress click events that follow a long-press
    onClickCapture: (e: React.MouseEvent) => {
      if (firedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        firedRef.current = false;
      }
    },
  };
}

function Bubble({
  message,
  isMine,
  highlighted,
  actionHandlers,
  actionClass,
  onReplayEffect,
}: {
  message: Message;
  isMine: boolean;
  highlighted?: boolean;
  actionHandlers: ReturnType<typeof useLongPress>;
  actionClass: string;
  onReplayEffect?: () => void;
}) {
  const { t } = useLanguage();
  const base = `rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
    isMine
      ? "bg-brand-500 text-white"
      : "bg-white text-slate-800 ring-1 ring-slate-100"
  }`;
  const highlightClass = highlighted
    ? "ring-[3px] ring-amber-400 shadow-[0_0_0_2px_rgba(255,255,255,0.85),0_0_14px_rgba(245,158,11,0.45)]"
    : "";

  if (message.message_type === "image" && message.image_url) {
    const previewHref = `/image-preview?src=${encodeURIComponent(
      message.image_url,
    )}`;

    return (
      <div
        {...actionHandlers}
        className={`overflow-hidden rounded-2xl ${actionClass} ${highlightClass}`}
      >
        <Link
          href={previewHref}
          className="block"
          onClickCapture={(e) => {
            // Don't navigate when the user is in the middle of a long-press.
            actionHandlers.onClickCapture(e);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={message.image_url}
            alt={t("messageImageAlt")}
            className="max-h-72 max-w-full rounded-2xl object-cover"
            draggable={false}
          />
        </Link>
      </div>
    );
  }

  if (message.message_type === "audio" && message.audio_url) {
    return (
      <div {...actionHandlers} className={actionClass}>
        <AudioBubble
          messageId={message.id}
          url={message.audio_url}
          durationMs={message.audio_duration_ms}
          isMine={isMine}
          highlighted={highlighted}
        />
      </div>
    );
  }

  if (message.message_type === "location") {
    const coords =
      message.latitude != null && message.longitude != null
        ? `${message.latitude.toFixed(5)}, ${message.longitude.toFixed(5)}`
        : "";
    const detail = message.address || coords || t("messageLocationFallback");

    return (
      <a
        href={message.map_url ?? "#"}
        target="_blank"
        rel="noreferrer"
        {...actionHandlers}
        className={`${base} flex min-w-40 max-w-56 flex-col gap-1 no-underline ${actionClass} ${highlightClass}`}
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <span aria-hidden className="text-xs">
            📍
          </span>
          <span>{t("messageLocationTitle")}</span>
        </span>
        <span
          className={`text-xs leading-5 ${isMine ? "text-brand-50" : "text-slate-700"}`}
        >
          {detail}
        </span>
        <span
          className={`text-xs font-medium leading-5 ${isMine ? "text-brand-100" : "text-brand-500"}`}
        >
          {t("messageOpenMap")}
        </span>
      </a>
    );
  }

  const isEffect = !!message.effect_id && !!onReplayEffect;
  const effectClass = isEffect ? "cursor-pointer hover:opacity-90" : "";

  return (
    <div
      {...actionHandlers}
      onClick={isEffect ? onReplayEffect : undefined}
      title={isEffect ? t("messageReplayEffect") : undefined}
      className={`${base} flex items-center gap-1.5 whitespace-pre-wrap break-words ${actionClass} ${effectClass} ${highlightClass}`}
    >
      <span>{message.content}</span>
      {isEffect ? (
        <span aria-hidden className="text-xs opacity-70">
          ✨
        </span>
      ) : null}
    </div>
  );
}
