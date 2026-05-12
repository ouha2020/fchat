"use client";

import { useEffect, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { humanizeError } from "@/lib/errors";
import {
  formatDuration,
  startRecording,
  type RecordingHandle,
  type RecordingResult,
} from "@/lib/recordingService";

interface Props {
  disabled?: boolean;
  sending?: boolean;
  onSendText: (text: string) => Promise<void> | void;
  onPickImage: (file: File) => Promise<void> | void;
  onSendLocation: () => Promise<void> | void;
  onSendAudio: (result: RecordingResult) => Promise<void> | void;
}

type RecordingState =
  | { status: "idle" }
  | {
      status: "recording";
      handle: RecordingHandle;
      elapsedMs: number;
      stopping: boolean;
    }
  | {
      status: "preview";
      result: RecordingResult;
      objectUrl: string;
      notice?: string;
    }
  | {
      status: "uploading";
      result: RecordingResult;
      objectUrl: string;
    }
  | {
      status: "failed";
      result: RecordingResult;
      objectUrl: string;
      error: string;
    };

const MAX_RECORD_MS = 60_000;
const MIN_RECORD_MS = 600;
const CONSENT_KEY = "family-chat:voice-recording-consent:v1";
const iconButtonClass =
  "inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-cover bg-center bg-no-repeat shadow-sm ring-1 ring-slate-200/70 transition hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50";
const inputShellClass =
  "fixed inset-x-0 bottom-0 z-50 mx-auto min-h-[61px] w-full max-w-3xl border-t border-slate-200 bg-white";

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
  const [recordingState, setRecordingState] = useState<RecordingState>({
    status: "idle",
  });
  const [actionsOpen, setActionsOpen] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingStateRef = useRef<RecordingState>(recordingState);

  useEffect(() => {
    recordingStateRef.current = recordingState;
  }, [recordingState]);

  useEffect(() => {
    return () => {
      cleanupRecordingState(recordingStateRef.current);
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (recordingState.status !== "recording") return;
    const id = window.setInterval(() => {
      setRecordingState((current) => {
        if (current.status !== "recording") return current;
        return {
          ...current,
          elapsedMs: Date.now() - current.handle.startedAt,
        };
      });
    }, 200);
    return () => window.clearInterval(id);
  }, [recordingState.status]);

  useEffect(() => {
    if (recordingState.status !== "recording") return;
    if (recordingState.stopping) return;
    if (recordingState.elapsedMs < MAX_RECORD_MS) return;
    void stopRecording("max");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingState]);

  useEffect(() => {
    if (recordingState.status !== "recording") return;

    function discardForPrivacy() {
      const current = recordingStateRef.current;
      if (current.status !== "recording") return;
      current.handle.cancel();
      setRecordingState({ status: "idle" });
      setPrivacyNotice(t("inputRecordingBackgroundStopped"));
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") discardForPrivacy();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", discardForPrivacy);
    window.addEventListener("pagehide", discardForPrivacy);
    window.addEventListener("beforeunload", discardForPrivacy);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", discardForPrivacy);
      window.removeEventListener("pagehide", discardForPrivacy);
      window.removeEventListener("beforeunload", discardForPrivacy);
    };
  }, [recordingState.status, t]);

  useEffect(() => {
    if (!actionsOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (moreMenuRef.current?.contains(target)) return;
      if (moreButtonRef.current?.contains(target)) return;
      setActionsOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActionsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [actionsOpen]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled || sending || recordingState.status !== "idle") return;
    setActionsOpen(false);
    await onSendText(trimmed);
    setText("");
  }

  async function handleStartRecording() {
    if (disabled || sending || recordingState.status !== "idle") return;
    setActionsOpen(false);
    setPrivacyNotice(null);

    if (!hasRecordingConsent()) {
      const ok = window.confirm(t("inputRecordingConsent"));
      if (!ok) return;
      saveRecordingConsent();
    }

    try {
      const handle = await startRecording();
      setRecordingState({
        status: "recording",
        handle,
        elapsedMs: 0,
        stopping: false,
      });
    } catch (err) {
      alert(recordingStartErrorMessage(err));
    }
  }

  async function stopRecording(reason: "manual" | "max") {
    const current = recordingStateRef.current;
    if (current.status !== "recording" || current.stopping) return;

    setRecordingState({ ...current, stopping: true });
    try {
      const result = await current.handle.stop();
      if (result.durationMs < MIN_RECORD_MS) {
        alert(t("inputRecordingTooShort"));
        setRecordingState({ status: "idle" });
        return;
      }

      const objectUrl = URL.createObjectURL(result.blob);
      setRecordingState({
        status: "preview",
        result,
        objectUrl,
        notice: reason === "max" ? t("inputMaxDurationReached") : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("recording_cancelled")) {
        alert(t("inputRecordStartError", { message: humanizeError(err, language) }));
      }
      setRecordingState({ status: "idle" });
    }
  }

  function handleCancelRecording() {
    const current = recordingStateRef.current;
    if (current.status !== "recording" || current.stopping) return;
    current.handle.cancel();
    setRecordingState({ status: "idle" });
  }

  function deletePreview() {
    const current = recordingStateRef.current;
    cleanupRecordingState(current);
    setRecordingState({ status: "idle" });
  }

  async function playPreview() {
    const current = recordingStateRef.current;
    if (current.status !== "preview" && current.status !== "failed") return;
    try {
      audioRef.current?.pause();
      audioRef.current = new Audio(current.objectUrl);
      await audioRef.current.play();
    } catch {
      alert(t("inputPreviewPlayFailed"));
    }
  }

  async function sendPreview() {
    const current = recordingStateRef.current;
    if (current.status !== "preview" && current.status !== "failed") return;
    setRecordingState({
      status: "uploading",
      result: current.result,
      objectUrl: current.objectUrl,
    });

    try {
      await onSendAudio(current.result);
      revokeObjectUrl(current.objectUrl);
      audioRef.current?.pause();
      audioRef.current = null;
      setRecordingState({ status: "idle" });
    } catch {
      setRecordingState({
        status: "failed",
        result: current.result,
        objectUrl: current.objectUrl,
        error: t("inputAudioSendFailed"),
      });
    }
  }

  function handlePickImage() {
    if (disabled || sending || recordingState.status !== "idle") return;
    setActionsOpen(false);
    fileRef.current?.click();
  }

  function handleSendLocation() {
    if (disabled || sending || recordingState.status !== "idle") return;
    setActionsOpen(false);
    void onSendLocation();
  }

  function recordingStartErrorMessage(err: unknown): string {
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (
      rawMsg.includes("Permission") ||
      rawMsg.toLowerCase().includes("denied") ||
      rawMsg.includes("NotAllowedError")
    ) {
      return t("inputMicPermission");
    }
    if (
      rawMsg.includes("recording_unsupported") ||
      rawMsg.includes("media_recorder_unsupported")
    ) {
      return t("inputRecordingUnsupported");
    }
    return t("inputRecordStartError", {
      message: humanizeError(err, language),
    });
  }

  if (recordingState.status === "recording") {
    return (
      <div
        className={inputShellClass}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
          <button
            type="button"
            className="btn-secondary h-10 px-3 text-sm"
            disabled={recordingState.stopping}
            onClick={handleCancelRecording}
          >
            {t("inputCancelRecordingShort")}
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-rose-50 px-3 py-3 text-sm text-rose-700 ring-1 ring-rose-100">
            <span
              aria-hidden
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500 ${
                recordingState.stopping ? "" : "animate-pulse"
              }`}
            />
            <span className="truncate font-semibold">{t("inputRecording")}</span>
            <span className="font-mono tabular-nums">
              {formatDuration(recordingState.elapsedMs)}
            </span>
          </div>
          <button
            type="button"
            className="btn-primary h-10 px-4 text-sm"
            disabled={recordingState.stopping}
            onClick={() => void stopRecording("manual")}
          >
            {t("inputStopRecording")}
          </button>
        </div>
      </div>
    );
  }

  if (
    recordingState.status === "preview" ||
    recordingState.status === "uploading" ||
    recordingState.status === "failed"
  ) {
    const result = recordingState.result;
    const isUploading = recordingState.status === "uploading";
    const failedMessage =
      recordingState.status === "failed" ? recordingState.error : null;
    const notice =
      recordingState.status === "preview" ? recordingState.notice : null;

    return (
      <div
        className={inputShellClass}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="space-y-2 px-3 py-2 sm:px-4">
          {notice ? (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-100">
              {notice}
            </div>
          ) : null}
          {failedMessage ? (
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-100">
              {failedMessage}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-40 flex-1 items-center justify-center gap-2 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-100">
              <span className="truncate font-semibold">
                {t("inputRecordingDone")}
              </span>
              <span className="font-mono tabular-nums">
                {formatDuration(result.durationMs)}
              </span>
            </div>
            <button
              type="button"
              className="btn-secondary h-10 px-3 text-sm"
              disabled={isUploading}
              onClick={() => void playPreview()}
            >
              {t("inputPreviewAudio")}
            </button>
            <button
              type="button"
              className="btn-secondary h-10 px-3 text-sm"
              disabled={isUploading}
              onClick={deletePreview}
            >
              {t("inputDeleteRecording")}
            </button>
            <button
              type="button"
              className="btn-primary h-10 px-4 text-sm"
              disabled={isUploading}
              onClick={() => void sendPreview()}
            >
              {isUploading
                ? t("inputRecordingSending")
                : recordingState.status === "failed"
                  ? t("inputRetryAudioSend")
                  : t("inputSendRecording")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={inputShellClass}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {actionsOpen ? (
        <div
          ref={moreMenuRef}
          className="absolute bottom-full left-3 mb-2 flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/95 p-2 shadow-lg shadow-slate-200/70 backdrop-blur sm:left-4"
          role="menu"
        >
          <button
            type="button"
            className={iconButtonClass}
            style={{ backgroundImage: "url(/ui-icons/image.png)" }}
            aria-label={t("inputSendImage")}
            title={t("inputSendImage")}
            role="menuitem"
            disabled={disabled || sending}
            onClick={handlePickImage}
          />
          <button
            type="button"
            className={iconButtonClass}
            style={{ backgroundImage: "url(/ui-icons/location.png)" }}
            aria-label={t("inputSendLocation")}
            title={t("inputSendLocation")}
            role="menuitem"
            disabled={disabled || sending}
            onClick={handleSendLocation}
          />
        </div>
      ) : null}
      {privacyNotice ? (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          {privacyNotice}
        </div>
      ) : null}
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
          ref={moreButtonRef}
          type="button"
          className={iconButtonClass}
          style={{ backgroundImage: "url(/ui-icons/plus.png)" }}
          aria-label={t("inputMoreActions")}
          title={t("inputMoreActions")}
          disabled={disabled || sending}
          aria-haspopup="menu"
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((open) => !open)}
        />
        <button
          type="button"
          className={iconButtonClass}
          style={{ backgroundImage: "url(/ui-icons/voice.png)" }}
          aria-label={t("inputRecordVoice")}
          title={t("inputRecordVoice")}
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
          className="btn-primary h-10 px-4"
          disabled={disabled || sending || !text.trim()}
          onClick={() => void submit()}
        >
          {t("commonSend")}
        </button>
      </div>
    </div>
  );
}

function hasRecordingConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) === "yes";
  } catch {
    return false;
  }
}

function saveRecordingConsent(): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, "yes");
  } catch {
    // Best effort only. If localStorage is blocked, ask again next time.
  }
}

function cleanupRecordingState(state: RecordingState): void {
  if (state.status === "recording") {
    state.handle.cancel();
    return;
  }
  if (
    state.status === "preview" ||
    state.status === "uploading" ||
    state.status === "failed"
  ) {
    revokeObjectUrl(state.objectUrl);
  }
}

function revokeObjectUrl(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Best effort only.
  }
}
