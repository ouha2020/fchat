"use client";

import { useEffect, useRef, useState } from "react";

import { formatDuration, startRecording, type RecordingHandle, type RecordingResult } from "@/lib/recordingService";

interface Props {
  disabled?: boolean;
  sending?: boolean;
  onSendText: (text: string) => Promise<void> | void;
  onPickImage: (file: File) => Promise<void> | void;
  onSendLocation: () => Promise<void> | void;
  onSendAudio: (result: RecordingResult) => Promise<void> | void;
}

const MAX_RECORD_MS = 60_000;

export default function ChatInput({
  disabled,
  sending,
  onSendText,
  onPickImage,
  onSendLocation,
  onSendAudio,
}: Props) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState<RecordingHandle | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Tick recording timer
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      setElapsed(Date.now() - recording.startedAt);
    }, 200);
    return () => window.clearInterval(id);
  }, [recording]);

  // Auto-stop on max duration
  useEffect(() => {
    if (!recording) return;
    if (elapsed < MAX_RECORD_MS) return;
    void handleStopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, recording]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled || sending) return;
    await onSendText(trimmed);
    setText("");
  }

  async function handleStartRecording() {
    if (disabled || sending || recording) return;
    try {
      const handle = await startRecording();
      setElapsed(0);
      setRecording(handle);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Permission") || msg.toLowerCase().includes("denied")) {
        alert("请在浏览器允许麦克风权限后重试");
      } else {
        alert(`无法开始录音：${msg}`);
      }
    }
  }

  async function handleStopRecording() {
    if (!recording) return;
    const handle = recording;
    setRecording(null);
    try {
      const result = await handle.stop();
      if (result.durationMs < 600) {
        alert("录音太短了");
        return;
      }
      await onSendAudio(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("recording_cancelled")) {
        alert(`发送语音失败：${msg}`);
      }
    }
  }

  function handleCancelRecording() {
    if (!recording) return;
    recording.cancel();
    setRecording(null);
  }

  if (recording) {
    return (
      <div className="border-t border-slate-200 bg-white px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost h-12 w-12 px-0 text-2xl leading-none"
            aria-label="取消录音"
            onClick={handleCancelRecording}
          >
            ✕
          </button>
          <div className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-50 px-3 py-3 text-sm text-rose-700">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
            <span className="font-medium">正在录音</span>
            <span className="font-mono">{formatDuration(elapsed)}</span>
            <span className="text-xs text-rose-500">/ 最长 1:00</span>
          </div>
          <button
            type="button"
            className="btn-primary h-11 px-4"
            onClick={() => void handleStopRecording()}
          >
            发送
          </button>
        </div>
      </div>
    );
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
          className="inline-flex h-14 w-14 shrink-0 overflow-hidden rounded-[1.35rem] bg-cover bg-center bg-no-repeat transition hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundImage: "url(/ui-icons/image.png)" }}
          aria-label="发送图片"
          disabled={disabled || sending}
          onClick={() => fileRef.current?.click()}
        />
        <button
          type="button"
          className="inline-flex h-14 w-14 shrink-0 overflow-hidden rounded-[1.35rem] bg-cover bg-center bg-no-repeat transition hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundImage: "url(/ui-icons/location.png)" }}
          aria-label="发送位置"
          disabled={disabled || sending}
          onClick={() => onSendLocation()}
        />
        <button
          type="button"
          className="inline-flex h-14 w-14 shrink-0 overflow-hidden rounded-[1.35rem] bg-cover bg-center bg-no-repeat transition hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundImage: "url(/ui-icons/voice.png)" }}
          aria-label="录制语音"
          disabled={disabled || sending}
          onClick={() => void handleStartRecording()}
        />
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
