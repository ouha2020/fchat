"use client";

import RoleBadge from "./RoleBadge";
import { formatTime } from "@/lib/format";
import type { Message } from "@/types/message";
import type { FamilyMember } from "@/types/member";

interface Props {
  message: Message;
  sender: FamilyMember | null;
  isMine: boolean;
}

export default function ChatMessage({ message, sender, isMine }: Props) {
  if (message.message_type === "system") {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-slate-200/70 px-3 py-1 text-xs text-slate-600">
          {message.content}
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
        <Bubble message={message} isMine={isMine} />
      </div>
    </div>
  );
}

function Bubble({ message, isMine }: { message: Message; isMine: boolean }) {
  const base = `rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
    isMine
      ? "bg-brand-500 text-white"
      : "bg-white text-slate-800 ring-1 ring-slate-100"
  }`;

  if (message.message_type === "image" && message.image_url) {
    return (
      <a
        href={message.image_url}
        target="_blank"
        rel="noreferrer"
        className="overflow-hidden rounded-2xl"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={message.image_url}
          alt="图片消息"
          className="max-h-72 max-w-full rounded-2xl object-cover"
        />
      </a>
    );
  }

  if (message.message_type === "location") {
    return (
      <a
        href={message.map_url ?? "#"}
        target="_blank"
        rel="noreferrer"
        className={`${base} flex flex-col gap-1 no-underline`}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <span>📍</span>
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

  return (
    <div className={`${base} whitespace-pre-wrap break-words`}>
      {message.content}
    </div>
  );
}
