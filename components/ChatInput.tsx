"use client";

import { useEffect, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { humanizeError } from "@/lib/errors";
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
  const { language, t } = useLanguage();
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
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = humanizeError(err, language);
      if (rawMsg.includes("Permission") || rawMsg.toLowerCase().includes("denied")) {
        alert(t("inputMicPermission"));
      } else {
        alert(t("inputRecordStartError", { message: msg }));
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
        alert(t("inputRecordingTooShort"));
        return;
      }
      await onSendAudio(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("recording_cancelled")) {
        alert(t("inputAudioSendError", { message: msg }));
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
      <div
        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-3xl border-t border-slate-200 bg-white"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
          <button
            type="button"
            className="btn-ghost h-12 w-12 px-0 text-2xl leading-none"
            aria-label={t("inputCancelRecording")}
            onClick={handleCancelRecording}
          >
            ✕
          </button>
          <div className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-50 px-3 py-3 text-sm text-rose-700">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
            <span className="font-medium">{t("inputRecording")}</span>
            <span className="font-mono">{formatDuration(elapsed)}</span>
            <span className="text-xs text-rose-500">{t("inputMaxDuration")}</span>
          </div>
          <button
            type="button"
            className="btn-primary h-11 px-4"
            onClick={() => void handleStopRecording()}
          >
            {t("commonSend")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-3xl border-t border-slate-200 bg-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
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
          aria-label={t("inputSendImage")}
          disabled={disabled || sending}
          onClick={() => fileRef.current?.click()}
        />
        <button
          type="button"
          className="inline-flex h-14 w-14 shrink-0 overflow-hidden rounded-[1.35rem] bg-cover bg-center bg-no-repeat transition hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundImage: "url(/ui-icons/location.png)" }}
          aria-label={t("inputSendLocation")}
          disabled={disabled || sending}
          onClick={() => onSendLocation()}
        />
        <button
          type="button"
          className="inline-flex h-14 w-14 shrink-0 overflow-hidden rounded-[1.35rem] bg-cover bg-center bg-no-repeat transition hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundImage: "url(/ui-icons/voice.png)" }}
          aria-label={t("inputRecordVoice")}
          disabled={disabled || sending}
          onClick={() => void handleStartRecording()}
        />
        <textarea
          rows={1}
          className="field max-h-32 min-h-[44px] flex-1 resize-none py-3"
          placeholder={t("inputPlaceholder")}
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
          {t("commonSend")}
        </button>
      </div>
    </div>
  );
}
