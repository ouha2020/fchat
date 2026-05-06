"use client";

import { useRef } from "react";

import AudioBubble from "./AudioBubble";
import RoleBadge from "./RoleBadge";
import UiIcon from "./UiIcon";
import { formatTime } from "@/lib/format";
import type { Message } from "@/types/message";
import type { FamilyMember } from "@/types/member";

interface Props {
  message: Message;
  sender: FamilyMember | null;
  isMine: boolean;
  canDelete?: boolean;
  onRequestDelete?: (messageId: string) => void;
  onReplayEffect?: (message: Message) => void;
}

export default function ChatMessage({
  message,
  sender,
  isMine,
  canDelete,
  onRequestDelete,
  onReplayEffect,
}: Props) {
  if (message.message_type === "system") {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-slate-200/70 px-3 py-1 text-xs text-slate-600">
          {message.content}
        </span>
      </div>
    );
  }

  if (message.deleted_at) {
    const label = isMine ? "你撤回了一条消息" : "对方撤回了一条消息";
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs italic text-slate-500">
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
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-700">
            {sender?.nickname ?? "未知成员"}
          </span>
          {sender ? <RoleBadge role={sender.role} /> : null}
          <span>{formatTime(message.created_at)}</span>
        </div>
        <Bubble
          message={message}
          isMine={isMine}
          canDelete={!!canDelete && !!onRequestDelete}
          onRequestDelete={() => onRequestDelete?.(message.id)}
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

function useLongPress(onLongPress: () => void, enabled: boolean) {
  const timeoutRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  function clear() {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function start() {
    if (!enabled) return;
    firedRef.current = false;
    clear();
    timeoutRef.current = window.setTimeout(() => {
      firedRef.current = true;
      onLongPress();
    }, 500);
  }

  function cancel() {
    clear();
  }

  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onTouchCancel: cancel,
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      if (!enabled) return;
      e.preventDefault();
      cancel();
      onLongPress();
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
  canDelete,
  onRequestDelete,
  onReplayEffect,
}: {
  message: Message;
  isMine: boolean;
  canDelete: boolean;
  onRequestDelete: () => void;
  onReplayEffect?: () => void;
}) {
  const longPressHandlers = useLongPress(onRequestDelete, canDelete);
  const longPressClass = canDelete
    ? "cursor-pointer select-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
    : "";

  const base = `rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
    isMine
      ? "bg-brand-500 text-white"
      : "bg-white text-slate-800 ring-1 ring-slate-100"
  }`;

  if (message.message_type === "image" && message.image_url) {
    return (
      <div
        {...longPressHandlers}
        className={`overflow-hidden rounded-2xl ${longPressClass}`}
      >
        <a
          href={message.image_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            // Don't navigate when the user is in the middle of a long-press.
            longPressHandlers.onClickCapture(e);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={message.image_url}
            alt="图片消息"
            className="max-h-72 max-w-full rounded-2xl object-cover"
            draggable={false}
          />
        </a>
      </div>
    );
  }

  if (message.message_type === "audio" && message.audio_url) {
    return (
      <div {...longPressHandlers} className={longPressClass}>
        <AudioBubble
          url={message.audio_url}
          durationMs={message.audio_duration_ms}
          isMine={isMine}
        />
      </div>
    );
  }

  if (message.message_type === "location") {
    return (
      <a
        href={message.map_url ?? "#"}
        target="_blank"
        rel="noreferrer"
        {...longPressHandlers}
        className={`${base} flex flex-col gap-1 no-underline ${longPressClass}`}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <UiIcon name="map-pin" className="h-4 w-4 shrink-0" />
          <span>{message.content || "发送了当前位置"}</span>
        </span>
        {message.address ? (
          <span className={isMine ? "text-brand-50" : "text-slate-500"}>
            {message.address}
          </span>
        ) : null}
        {message.latitude != null && message.longitude != null ? (
          <span
            className={`text-xs ${isMine ? "text-brand-100" : "text-slate-500"}`}
          >
            {message.latitude.toFixed(5)}, {message.longitude.toFixed(5)}
          </span>
        ) : null}
        <span
          className={`text-xs ${isMine ? "text-brand-100" : "text-brand-500"}`}
        >
          点击在地图中查看
        </span>
      </a>
    );
  }

  const isEffect = !!message.effect_id && !!onReplayEffect;
  const effectClass = isEffect ? "cursor-pointer hover:opacity-90" : "";

  return (
    <div
      {...longPressHandlers}
      onClick={isEffect ? onReplayEffect : undefined}
      title={isEffect ? "点击重新播放特效" : undefined}
      className={`${base} flex items-center gap-1.5 whitespace-pre-wrap break-words ${longPressClass} ${effectClass}`}
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
