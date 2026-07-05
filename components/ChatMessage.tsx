"use client";

import Link from "next/link";
import { useRef } from "react";

import AssistantActionCardView from "./AssistantActionCard";
import AudioBubble from "./AudioBubble";
import LinkifiedText from "./LinkifiedText";
import MemberAvatarCircle from "./MemberAvatarCircle";
import { useLanguage } from "@/components/LanguageProvider";
import { formatTime } from "@/lib/format";
import { createGoogleMapUrl } from "@/lib/locationService";
import { useCachedImage } from "@/lib/imageCache";
import { useResolvedMedia } from "@/lib/mediaClient";
import { safeGoogleMapsUrl } from "@/lib/security";
import {
  getSystemMessageTone,
  localizeSystemMessage,
} from "@/lib/systemMessage";
import type { LocalSession } from "@/lib/authLocal";
import type { TranslationKey } from "@/lib/i18n";
import type { Message } from "@/types/message";
import type { FamilyMember } from "@/types/member";
import type { FamilyRole } from "@/types/family";
import type { AssistantActionCard } from "@/types/assistant";

const ROLE_KEYS: Record<FamilyRole, TranslationKey> = {
  father: "roleFather",
  mother: "roleMother",
  child: "roleChild",
};
const messageBodyWidthClass = "min-w-0 max-w-[78%] sm:max-w-md";
const messageMetaClass =
  "flex max-w-full min-w-0 flex-wrap items-center gap-1.5 text-[11px] leading-4 text-slate-500";

// One progress indicator for both directions: a determinate ring with a
// percentage when the fraction is known (upload, or download with a known
// length), and a spinning indeterminate ring when it isn't. `overlay` renders
// white on a dark scrim over an image; `inline` renders on a light placeholder.
function MediaProgressRing({
  fraction,
  label,
  variant = "overlay",
}: {
  fraction: number | null;
  label: string;
  variant?: "overlay" | "inline";
}) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const indeterminate = fraction === null;
  const value = indeterminate ? 0.25 : Math.max(0, Math.min(1, fraction));
  const dashoffset = circumference * (1 - value);
  const overlay = variant === "overlay";
  const trackStroke = overlay ? "rgba(255,255,255,0.3)" : "rgba(100,116,139,0.25)";
  const progressStroke = overlay ? "#ffffff" : "#4f6cf7";
  const percent = Math.round(value * 100);
  return (
    <div
      className={`relative flex h-16 w-16 items-center justify-center rounded-full ${
        overlay ? "bg-black/45 text-white backdrop-blur" : "text-slate-600"
      }`}
      role="status"
      aria-label={indeterminate ? label : `${label} ${percent}%`}
    >
      <svg
        width="52"
        height="52"
        viewBox="0 0 52 52"
        className={`-rotate-90 ${indeterminate ? "animate-spin" : ""}`}
      >
        <circle
          cx="26"
          cy="26"
          r={radius}
          fill="none"
          stroke={trackStroke}
          strokeWidth="4"
        />
        <circle
          cx="26"
          cy="26"
          r={radius}
          fill="none"
          stroke={progressStroke}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          style={indeterminate ? undefined : { transition: "stroke-dashoffset 0.2s linear" }}
        />
      </svg>
      {indeterminate ? null : (
        <span className="absolute text-[11px] font-semibold">{percent}%</span>
      )}
    </div>
  );
}

interface Props {
  session: LocalSession;
  message: Message;
  sender: FamilyMember | null;
  recipient?: FamilyMember | null;
  isMine: boolean;
  highlighted?: boolean;
  assistantCard?: AssistantActionCard | null;
  assistantCardSubmitting?: boolean;
  currentMemberId?: string | null;
  onConfirmAssistantCard?: (card: AssistantActionCard) => void;
  onCancelAssistantCard?: (card: AssistantActionCard) => void;
  onModifyAssistantCard?: (card: AssistantActionCard) => void;
  onOpenAssistantSchedule?: (card: AssistantActionCard) => void;
  onAcceptAssistantTask?: (card: AssistantActionCard) => void;
  onCompleteAssistantTask?: (card: AssistantActionCard) => void;
  onSnoozeAssistantTask?: (card: AssistantActionCard) => void;
  onRequestActions?: (
    message: Message,
    point: { x: number; y: number },
  ) => void;
  onReplayEffect?: (message: Message) => void;
  onRetryUpload?: (message: Message) => void;
}

export default function ChatMessage({
  session,
  message,
  sender,
  recipient,
  isMine,
  highlighted,
  assistantCard,
  assistantCardSubmitting,
  currentMemberId,
  onConfirmAssistantCard,
  onCancelAssistantCard,
  onModifyAssistantCard,
  onOpenAssistantSchedule,
  onAcceptAssistantTask,
  onCompleteAssistantTask,
  onSnoozeAssistantTask,
  onRequestActions,
  onReplayEffect,
  onRetryUpload,
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
    ? "important-message-highlight"
    : "";
  const isPrivate = !!message.recipient_member_id;
  const whisperRecipientLabel =
    isPrivate && isMine
      ? t("messageWhisperTo", {
          nickname: recipient?.nickname ?? t("commonUnknownMember"),
        })
      : null;

  if (isAssistantSystemMessage(message)) {
    return (
      <div className="flex w-full gap-2 py-1" {...actionHandlers}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700 shadow-sm ring-1 ring-white/80 sm:h-9 sm:w-9 sm:text-base">
          家
        </div>
        <div className={`flex ${messageBodyWidthClass} flex-col items-start gap-1`}>
          <div className={messageMetaClass}>
            <span className="max-w-full truncate font-medium text-slate-700">
              {t("assistantName")}
            </span>
            <span className="text-slate-300">·</span>
            <span className="shrink-0">{formatTime(message.created_at, language)}</span>
          </div>
          <div
            className={`max-w-full rounded-[22px] bg-white/95 px-3.5 py-2.5 text-sm text-slate-800 shadow-[0_10px_26px_rgba(47,83,67,0.08)] ring-1 ring-white/80 ${actionClass} ${highlightClass}`}
          >
            <AssistantActionCardView
              card={assistantCard ?? null}
              canAct={assistantCard?.created_by_member_id === currentMemberId}
              submitting={assistantCardSubmitting}
              currentMemberId={currentMemberId}
              onConfirm={(card) => onConfirmAssistantCard?.(card)}
              onCancel={(card) => onCancelAssistantCard?.(card)}
              onModify={(card) => onModifyAssistantCard?.(card)}
              onOpenSchedule={(card) => onOpenAssistantSchedule?.(card)}
              onAcceptTask={(card) => onAcceptAssistantTask?.(card)}
              onCompleteTask={(card) => onCompleteAssistantTask?.(card)}
              onSnoozeTask={(card) => onSnoozeAssistantTask?.(card)}
            />
          </div>
        </div>
      </div>
    );
  }

  if (isKeeperSystemMessage(message)) {
    return (
      <div className="flex w-full justify-start py-1" {...actionHandlers}>
        <div
          className={`flex min-w-0 max-w-[86%] items-start gap-2 rounded-3xl bg-emerald-50/95 px-3 py-2.5 text-sm text-slate-800 shadow-[0_10px_24px_rgba(47,83,67,0.08)] ring-1 ring-white/80 sm:max-w-md ${actionClass} ${highlightClass}`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-black text-emerald-700 shadow-sm ring-1 ring-emerald-100">
            家
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold leading-4 text-emerald-700">
              <span className="truncate">{t("keeperName")}</span>
              <span className="text-emerald-300">·</span>
              <span className="shrink-0 font-medium text-slate-400">
                {formatTime(message.created_at, language)}
              </span>
            </div>
            <div className="mt-1 whitespace-pre-wrap break-words leading-6">
              {localizeKeeperMessage(message, t)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (message.message_type === "system") {
    const tone = getSystemMessageTone(message);
    const toneClass =
      tone === "joined"
        ? "bg-emerald-50/95 text-emerald-700 shadow-sm ring-1 ring-white/80"
        : tone === "left"
          ? "bg-white/80 text-slate-600 shadow-sm ring-1 ring-white/80"
          : "bg-white/70 text-slate-600 shadow-sm ring-1 ring-white/70";
    return (
      <div className="flex justify-center py-2" {...actionHandlers}>
        <span className={`rounded-full px-3 py-1 text-xs ${toneClass} ${actionClass} ${highlightClass}`}>
          {localizeSystemMessage(message, t)}
        </span>
      </div>
    );
  }

  if (message.deleted_at) {
    const label = isMine ? t("messageYouDeleted") : t("messageOtherDeleted");
    return (
      <div className="flex justify-center py-2" {...actionHandlers}>
        <span className={`rounded-full bg-white/75 px-3 py-1 text-xs italic text-slate-500 shadow-sm ring-1 ring-white/70 ${highlightClass}`}>
          {label}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex w-full gap-2 ${isMine ? "flex-row-reverse" : "flex-row"}`}
    >
      <MemberAvatar session={session} sender={sender} isMine={isMine} />
      <div
        className={`flex ${messageBodyWidthClass} flex-col gap-1 ${
          isMine ? "items-end" : "items-start"
        }`}
      >
        <div className={messageMetaClass}>
          {whisperRecipientLabel ? (
            <span className="max-w-36 truncate font-medium text-violet-700">
              {whisperRecipientLabel}
            </span>
          ) : null}
          <span className="max-w-[9rem] truncate font-medium text-slate-700">
            {sender?.nickname ?? t("commonUnknownMember")}
          </span>
          {showRole ? (
            <>
              <span className="text-slate-300">·</span>
              <span className="max-w-[5rem] truncate font-medium text-slate-500">
                {roleLabel}
              </span>
            </>
          ) : null}
          <span className="text-slate-300">·</span>
          <span className="shrink-0">{formatTime(message.created_at, language)}</span>
        </div>
        <Bubble
          message={message}
          session={session}
          isMine={isMine}
          highlighted={highlighted}
          actionHandlers={actionHandlers}
          actionClass={actionClass}
          isPrivate={isPrivate}
          onReplayEffect={
            message.effect_id && onReplayEffect
              ? () => onReplayEffect(message)
              : undefined
          }
          onRetryUpload={onRetryUpload}
        />
      </div>
    </div>
  );
}

function MemberAvatar({
  session,
  sender,
  isMine,
}: {
  session: LocalSession;
  sender: FamilyMember | null;
  isMine: boolean;
}) {
  const { t } = useLanguage();
  const avatar = (
    <MemberAvatarCircle
      session={session}
      avatarRef={sender?.avatar_url ?? null}
      name={sender?.nickname ?? "?"}
      className={`h-8 w-8 rounded-full text-sm font-semibold sm:h-9 sm:w-9 sm:text-base ${
        isMine
          ? "bg-brand-500 text-white shadow-[0_8px_18px_rgba(79,108,247,0.22)] ring-1 ring-white/30"
          : "bg-white/90 text-slate-700 shadow-[0_8px_18px_rgba(71,64,49,0.08)] ring-1 ring-white/80"
      }`}
    />
  );

  // Tapping any member's avatar opens that member's photo album.
  if (sender) {
    return (
      <Link
        href={`/album?member=${encodeURIComponent(sender.id)}`}
        className="-m-1 flex shrink-0 rounded-full p-1 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
        aria-label={t("albumOpenAria")}
        title={t("albumOpenAria")}
      >
        {avatar}
      </Link>
    );
  }

  return avatar;
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
  session,
  isMine,
  isPrivate,
  highlighted,
  actionHandlers,
  actionClass,
  onReplayEffect,
  onRetryUpload,
}: {
  message: Message;
  session: LocalSession;
  isMine: boolean;
  isPrivate: boolean;
  highlighted?: boolean;
  actionHandlers: ReturnType<typeof useLongPress>;
  actionClass: string;
  onReplayEffect?: () => void;
  onRetryUpload?: (message: Message) => void;
}) {
  const { t } = useLanguage();
  const base = `max-w-full rounded-[20px] px-3.5 py-2.5 text-sm ${
    isPrivate && isMine
      ? "bg-violet-500 text-white shadow-[0_10px_24px_rgba(124,58,237,0.22)] ring-1 ring-violet-300/70"
      : isPrivate
        ? "bg-white/95 text-slate-800 shadow-[0_8px_22px_rgba(88,70,118,0.08)] ring-1 ring-violet-100"
        : isMine
      ? "bg-brand-500 text-white shadow-[0_10px_24px_rgba(79,108,247,0.22)] ring-1 ring-white/20"
      : "bg-white/95 text-slate-800 shadow-[0_8px_22px_rgba(77,67,50,0.08)] ring-1 ring-white/80"
  }`;
  const highlightClass = highlighted
    ? "important-message-highlight"
    : "";
  const imageMedia = useCachedImage(
    session,
    message.message_type === "image" ? message.image_url : null,
    { messageId: message.id },
  );
  const audioMedia = useResolvedMedia(
    session,
    message.message_type === "audio" ? message.audio_url : null,
    { messageId: message.id },
  );
  const imageUrl = imageMedia.url;

  if (message.message_type === "image" && message.upload_status) {
    const previewSrc = message.local_preview_url ?? null;
    const failed = message.upload_status === "failed";
    return (
      <div
        className={`relative max-w-full overflow-hidden rounded-[20px] shadow-[0_10px_24px_rgba(77,67,50,0.1)] ${isPrivate ? "ring-2 ring-violet-200" : ""} ${highlightClass}`}
      >
        {previewSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewSrc}
            alt={t("messageImageAlt")}
            className={`max-h-72 max-w-full rounded-[20px] object-cover transition ${
              failed ? "opacity-40" : "opacity-60"
            }`}
            draggable={false}
          />
        ) : (
          <div className="h-40 w-48 max-w-full rounded-[20px] bg-slate-200/80" />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          {failed ? (
            <button
              type="button"
              onClick={() => onRetryUpload?.(message)}
              className="flex max-w-[85%] flex-col items-center gap-1 rounded-2xl bg-black/50 px-4 py-2 text-center text-xs font-medium text-white backdrop-blur"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              {t("chatImageUploadFailed")}
            </button>
          ) : (
            <MediaProgressRing
              fraction={message.upload_progress ?? 0}
              label={t("chatImageUploading")}
              variant="overlay"
            />
          )}
        </div>
      </div>
    );
  }

  if (message.message_type === "image" && message.image_url) {
    if (!imageUrl) {
      const failed = imageMedia.status === "error";
      return (
        <div
          {...actionHandlers}
          role="status"
          className={`relative max-w-full overflow-hidden rounded-[20px] shadow-[0_10px_24px_rgba(77,67,50,0.1)] ${isPrivate ? "ring-2 ring-violet-200" : ""} ${actionClass} ${highlightClass}`}
        >
          <div className="flex h-40 w-48 max-w-full items-center justify-center rounded-[20px] bg-slate-200/80">
            {failed ? (
              <span className="text-xs font-medium text-slate-500">
                {t("mediaLoadFailed")}
              </span>
            ) : (
              <MediaProgressRing
                fraction={imageMedia.progress}
                label={t("commonLoading")}
                variant="inline"
              />
            )}
          </div>
          <span className="sr-only">
            {failed ? t("mediaLoadFailed") : t("commonLoading")}
          </span>
        </div>
      );
    }
    const previewHref = `/image-preview?mid=${encodeURIComponent(message.id)}`;

    return (
      <div
        {...actionHandlers}
        className={`relative max-w-full overflow-hidden rounded-[20px] shadow-[0_10px_24px_rgba(77,67,50,0.1)] ${isPrivate ? "ring-2 ring-violet-200" : ""} ${actionClass} ${highlightClass}`}
      >
        {isPrivate ? (
          <span className="absolute left-2 top-2 z-10 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-violet-700 shadow-sm">
            {t("messageWhisperLabel")}
          </span>
        ) : null}
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
            src={imageUrl}
            alt={t("messageImageAlt")}
            className="max-h-72 max-w-full rounded-[20px] object-cover"
            draggable={false}
          />
        </Link>
      </div>
    );
  }

  if (message.message_type === "audio" && message.audio_url) {
    return (
      <div
        {...actionHandlers}
        className={`${isPrivate ? "rounded-[20px] bg-violet-50/95 p-1 shadow-[0_8px_20px_rgba(88,70,118,0.08)] ring-1 ring-violet-200" : ""} ${actionClass}`}
      >
        {isPrivate ? (
          <WhisperInlineLabel className="mb-1 px-2 pt-1 text-violet-700" />
        ) : null}
        <AudioBubble
          messageId={message.id}
          url={audioMedia.url}
          durationMs={message.audio_duration_ms}
          isMine={isMine}
          highlighted={highlighted}
          loadFailed={audioMedia.status === "error"}
        />
      </div>
    );
  }

  if (message.message_type === "location") {
    const detail = message.address || t("messageLocationShared");
    const mapUrl =
      safeGoogleMapsUrl(message.map_url) ??
      (message.latitude != null && message.longitude != null
        ? createGoogleMapUrl(message.latitude, message.longitude)
        : null);

    return (
      <a
        href={mapUrl ?? "#"}
        target={mapUrl ? "_blank" : undefined}
        rel={mapUrl ? "noreferrer" : undefined}
        onClick={(e) => {
          if (!mapUrl) e.preventDefault();
        }}
        {...actionHandlers}
        className={`${base} flex min-w-40 max-w-full flex-col gap-1 no-underline sm:max-w-56 ${actionClass} ${highlightClass}`}
      >
        {isPrivate ? (
          <WhisperInlineLabel className="mb-0.5 opacity-90" />
        ) : null}
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
      className={`${base} flex flex-col gap-1 whitespace-pre-wrap break-words ${actionClass} ${effectClass} ${highlightClass}`}
    >
      {isPrivate ? (
        <WhisperInlineLabel
          className={isMine ? "text-violet-50/90" : "text-violet-700"}
        />
      ) : null}
      <span>
        <LinkifiedText
          text={message.content ?? ""}
          linkClassName={
            isMine
              ? "text-white decoration-white/60 hover:decoration-white"
              : "text-brand-600 decoration-brand-300 hover:decoration-brand-500"
          }
        />
      </span>
      {isEffect ? (
        <span aria-hidden className="text-xs opacity-70">
          ✦
        </span>
      ) : null}
    </div>
  );
}

function isKeeperSystemMessage(message: Message): boolean {
  return (
    message.message_type === "system" &&
    (message.system_event_type === "keeper_request_created" ||
      message.system_event_payload?.actor_type === "keeper")
  );
}

function isAssistantSystemMessage(message: Message): boolean {
  const payload = message.system_event_payload ?? {};
  return (
    message.message_type === "system" &&
    (message.system_event_type === "assistant_card_created" ||
      message.system_event_type === "assistant_card_confirmed" ||
      message.system_event_type === "assistant_card_cancelled" ||
      (payload.actor_type === "assistant" && typeof payload.status === "string"))
  );
}

function localizeKeeperMessage(message: Message, t: (key: string, vars?: Record<string, string>) => string): string {
  const payload = message.system_event_payload ?? {};
  if (message.system_event_type === "keeper_request_created") {
    const target = typeof payload.target_kind === "string" ? payload.target_kind : "";
    const nickname =
      typeof payload.assignee_nickname === "string"
        ? payload.assignee_nickname
        : t("commonUnknownMember");
    if (target === "family") return t("keeperReplyFamily");
    if (target === "assignee") return t("keeperReplyAssignee", { nickname });
    return t("keeperReplySelf");
  }
  return message.content || t("keeperReplySelf");
}

function WhisperInlineLabel({ className = "" }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${className}`}>
      <WhisperIcon />
      <span>{t("messageWhisperLabel")}</span>
    </span>
  );
}

function WhisperIcon() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/ui-icons/whisper-lock.png"
      alt=""
      className="h-3.5 w-3.5 shrink-0 rounded-[3px]"
      draggable={false}
    />
  );
}
