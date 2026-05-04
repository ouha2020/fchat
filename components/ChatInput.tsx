"use client";

import { useRef, useState } from "react";

interface Props {
  disabled?: boolean;
  sending?: boolean;
  onSendText: (text: string) => Promise<void> | void;
  onPickImage: (file: File) => Promise<void> | void;
  onSendLocation: () => Promise<void> | void;
}

export default function ChatInput({
  disabled,
  sending,
  onSendText,
  onPickImage,
  onSendLocation,
}: Props) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled || sending) return;
    await onSendText(trimmed);
    setText("");
  }

  return (
    <div className="border-t border-slate-200 bg-white px-3 py-2 sm:px-4">
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await onPickImage(f);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        <button
          type="button"
          className="btn-ghost h-11 w-11 px-0 text-xl"
          aria-label="发送图片"
          disabled={disabled || sending}
          onClick={() => fileRef.current?.click()}
        >
          🖼️
        </button>
        <button
          type="button"
          className="btn-ghost h-11 w-11 px-0 text-xl"
          aria-label="发送位置"
          disabled={disabled || sending}
          onClick={() => onSendLocation()}
        >
          📍
        </button>
        <textarea
          rows={1}
          className="field max-h-32 min-h-[44px] flex-1 resize-none py-3"
          placeholder="说点什么吧…"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="button"
          className="btn-primary h-11 px-4"
          disabled={disabled || sending || !text.trim()}
          onClick={() => void submit()}
        >
          发送
        </button>
      </div>
    </div>
  );
}
