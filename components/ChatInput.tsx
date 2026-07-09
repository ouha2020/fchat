"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { useDialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";
import {
  shouldClearTextAfterSend,
  type SendTextResult,
} from "@/lib/chatInputDraft";
import { humanizeError } from "@/lib/errors";
import {
  formatDuration,
  startRecording,
  type RecordingHandle,
  type RecordingResult,
} from "@/lib/recordingService";
import type { FamilyMember } from "@/types/member";

interface Props {
  disabled?: boolean;
  sending?: boolean;
  onSendText: (text: string) => Promise<SendTextResult> | SendTextResult;
  onPickImage: (file: File) => Promise<void> | void;
  onSendLocation: () => Promise<void> | void;
  onSendAudio: (result: RecordingResult) => Promise<void> | void;
  members?: FamilyMember[];
  currentMemberId?: string | null;
  whisperTargetId?: string | null;
  onSelectWhisper?: (memberId: string) => void;
  keeperMode?: boolean;
  onOpenKeeper?: () => void;
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
const POPOVER_VIEWPORT_MARGIN = 8;
const POPOVER_MAX_HEIGHT = 320;
const POPOVER_MIN_HEIGHT = 72;
const iconButtonClass =
  "native-icon-button native-press inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-[14px] bg-white bg-cover bg-center bg-no-repeat ring-1 ring-white/80 hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200";
const inputShellClass =
  "native-input-bar relative z-50 mx-auto min-h-[61px] w-full max-w-3xl shrink-0 overflow-visible border-t border-white/70";

export default function ChatInput({
  disabled,
  sending,
  onSendText,
  onPickImage,
  onSendLocation,
  onSendAudio,
  members = [],
  currentMemberId = null,
  whisperTargetId = null,
  onSelectWhisper,
  keeperMode = false,
  onOpenKeeper,
}: Props) {
  const { language, t } = useLanguage();
  const dialog = useDialog();
  const toast = useToast();
  const [text, setText] = useState("");
  const [recordingState, setRecordingState] = useState<RecordingState>({
    status: "idle",
  });
  const [actionsOpen, setActionsOpen] = useState(false);
  const [whisperPickerOpen, setWhisperPickerOpen] = useState(false);
  const [popoverMaxHeight, setPopoverMaxHeight] = useState(POPOVER_MAX_HEIGHT);
  const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);
  const inputShellRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const whisperPickerRef = useRef<HTMLDivElement>(null);
  const whisperButtonRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingStateRef = useRef<RecordingState>(recordingState);
  const voiceButtonRef = useRef<HTMLButtonElement>(null);
  const recordingBarRef = useRef<HTMLDivElement>(null);
  const safeRectRef = useRef<DOMRect | null>(null);
  const [slideOffActive, setSlideOffActive] = useState(false);
  const isHoldingRef = useRef(false);
  const docPointerCleanupRef = useRef<(() => void) | null>(null);
  const whisperCandidates = members.filter(
    (member) => member.status === "active" && member.id !== currentMemberId,
  );
  const canPickWhisper = Boolean(onSelectWhisper) && whisperCandidates.length > 0;

  useEffect(() => {
    recordingStateRef.current = recordingState;
  }, [recordingState]);

  useEffect(() => {
    return () => {
      removeDocPointerListeners();
      cleanupRecordingState(recordingStateRef.current);
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (recordingState.status === "recording" && recordingBarRef.current) {
      safeRectRef.current = recordingBarRef.current.getBoundingClientRect();
    }
  }, [recordingState.status]);

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
    void stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingState]);

  useEffect(() => {
    if (recordingState.status !== "recording") return;
    const visualViewport = window.visualViewport;
    let viewportFrame = 0;

    function discardForPrivacy() {
      const current = recordingStateRef.current;
      if (current.status !== "recording") return;
      removeDocPointerListeners();
      current.handle.cancel();
      setRecordingState({ status: "idle" });
      setPrivacyNotice(t("inputRecordingBackgroundStopped"));
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") discardForPrivacy();
    }

    function queueViewportDiscard() {
      if (viewportFrame) return;
      viewportFrame = window.requestAnimationFrame(() => {
        viewportFrame = 0;
        discardForPrivacy();
      });
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", discardForPrivacy);
    window.addEventListener("pagehide", discardForPrivacy);
    window.addEventListener("beforeunload", discardForPrivacy);
    visualViewport?.addEventListener("resize", queueViewportDiscard);
    visualViewport?.addEventListener("scroll", queueViewportDiscard);
    window.addEventListener("resize", queueViewportDiscard);
    window.addEventListener("orientationchange", queueViewportDiscard);
    return () => {
      if (viewportFrame) window.cancelAnimationFrame(viewportFrame);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", discardForPrivacy);
      window.removeEventListener("pagehide", discardForPrivacy);
      window.removeEventListener("beforeunload", discardForPrivacy);
      visualViewport?.removeEventListener("resize", queueViewportDiscard);
      visualViewport?.removeEventListener("scroll", queueViewportDiscard);
      window.removeEventListener("resize", queueViewportDiscard);
      window.removeEventListener("orientationchange", queueViewportDiscard);
    };
  }, [recordingState.status, t]);

  useEffect(() => {
    if (!actionsOpen && !whisperPickerOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (moreMenuRef.current?.contains(target)) return;
      if (moreButtonRef.current?.contains(target)) return;
      if (whisperPickerRef.current?.contains(target)) return;
      if (whisperButtonRef.current?.contains(target)) return;
      setActionsOpen(false);
      setWhisperPickerOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActionsOpen(false);
        setWhisperPickerOpen(false);
        moreButtonRef.current?.focus({ preventScroll: true });
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [actionsOpen, whisperPickerOpen]);

  useLayoutEffect(() => {
    if (!actionsOpen && !whisperPickerOpen) return;
    const visualViewport = window.visualViewport;
    let frame = 0;

    const updateMaxHeight = () => {
      frame = 0;
      const shellRect = inputShellRef.current?.getBoundingClientRect();
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const fallbackTop = viewportTop + viewportHeight;
      const shellTop = shellRect?.top ?? fallbackTop;
      const availableHeight =
        shellTop - viewportTop - POPOVER_VIEWPORT_MARGIN * 2;
      const nextHeight = Math.floor(
        Math.min(
          POPOVER_MAX_HEIGHT,
          Math.max(POPOVER_MIN_HEIGHT, availableHeight),
        ),
      );
      setPopoverMaxHeight((current) =>
        current === nextHeight ? current : nextHeight,
      );
    };

    const queueUpdate = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateMaxHeight);
    };

    queueUpdate();
    visualViewport?.addEventListener("resize", queueUpdate);
    visualViewport?.addEventListener("scroll", queueUpdate);
    window.addEventListener("resize", queueUpdate);
    window.addEventListener("orientationchange", queueUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      visualViewport?.removeEventListener("resize", queueUpdate);
      visualViewport?.removeEventListener("scroll", queueUpdate);
      window.removeEventListener("resize", queueUpdate);
      window.removeEventListener("orientationchange", queueUpdate);
    };
  }, [actionsOpen, whisperPickerOpen]);

  useEffect(() => {
    if (!actionsOpen && !whisperPickerOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const target = whisperPickerOpen
        ? whisperPickerRef.current
        : moreMenuRef.current;
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actionsOpen, whisperPickerOpen]);

  useEffect(() => {
    if (whisperPickerOpen && !canPickWhisper) {
      setWhisperPickerOpen(false);
    }
  }, [canPickWhisper, whisperPickerOpen]);

  function expandRect(rect: DOMRect, margin: number): DOMRect {
    return new DOMRect(
      rect.left - margin,
      rect.top - margin,
      rect.width + margin * 2,
      rect.height + margin * 2,
    );
  }

  function removeDocPointerListeners() {
    docPointerCleanupRef.current?.();
    docPointerCleanupRef.current = null;
    setSlideOffActive(false);
    isHoldingRef.current = false;
  }

  function addDocPointerListeners() {
    function isInZone(clientX: number, clientY: number): boolean {
      const rect = safeRectRef.current;
      if (!rect) return true;
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    }

    function handlePointerMove(e: PointerEvent) {
      setSlideOffActive(!isInZone(e.clientX, e.clientY));
    }

    function handlePointerUp(e: PointerEvent) {
      removeDocPointerListeners();
      const current = recordingStateRef.current;
      if (current.status !== "recording" || current.stopping) return;
      if (isInZone(e.clientX, e.clientY)) {
        void stopRecording();
      } else {
        handleCancelRecording();
      }
    }

    function handlePointerCancel() {
      removeDocPointerListeners();
      const current = recordingStateRef.current;
      if (current.status !== "recording" || current.stopping) return;
      handleCancelRecording();
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);

    docPointerCleanupRef.current = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
    };
  }

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled || sending || recordingState.status !== "idle") return;
    setActionsOpen(false);
    setWhisperPickerOpen(false);
    const shouldClear = await onSendText(trimmed);
    if (shouldClearTextAfterSend(shouldClear)) {
      setText("");
    }
  }

  async function handleVoicePointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
  ) {
    if (disabled || sending || recordingState.status !== "idle") return;
    e.preventDefault();

    safeRectRef.current = expandRect(
      e.currentTarget.getBoundingClientRect(),
      40,
    );
    addDocPointerListeners();
    isHoldingRef.current = true;

    setActionsOpen(false);
    setWhisperPickerOpen(false);
    setPrivacyNotice(null);

    if (!hasRecordingConsent()) {
      const ok = await dialog.confirm({
        title: t("inputRecordVoice"),
        message: t("inputRecordingConsent"),
      });
      if (!ok) {
        removeDocPointerListeners();
        return;
      }
      saveRecordingConsent();
    }

    try {
      const handle = await startRecording();
      if (!isHoldingRef.current) {
        handle.cancel();
        return;
      }
      setRecordingState({
        status: "recording",
        handle,
        elapsedMs: 0,
        stopping: false,
      });
    } catch (err) {
      removeDocPointerListeners();
      toast.error(recordingStartErrorMessage(err));
    }
  }

  async function stopRecording() {
    const current = recordingStateRef.current;
    if (current.status !== "recording" || current.stopping) return;

    removeDocPointerListeners();
    setRecordingState({ ...current, stopping: true });
    try {
      const result = await current.handle.stop();
      if (result.durationMs < MIN_RECORD_MS) {
        toast.info(t("inputRecordingTooShort"));
        setRecordingState({ status: "idle" });
        return;
      }

      const objectUrl = URL.createObjectURL(result.blob);
      setRecordingState({ status: "uploading", result, objectUrl });

      try {
        await onSendAudio(result);
        revokeObjectUrl(objectUrl);
        audioRef.current?.pause();
        audioRef.current = null;
        setRecordingState({ status: "idle" });
      } catch {
        setRecordingState({
          status: "failed",
          result,
          objectUrl,
          error: t("inputAudioSendFailed"),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("recording_cancelled")) {
        toast.error(t("inputRecordStartError", { message: humanizeError(err, language) }));
      }
      setRecordingState({ status: "idle" });
    }
  }

  function handleCancelRecording() {
    const current = recordingStateRef.current;
    if (current.status !== "recording" || current.stopping) return;
    removeDocPointerListeners();
    current.handle.cancel();
    setRecordingState({ status: "idle" });
  }

  function dismissFailed() {
    const current = recordingStateRef.current;
    cleanupRecordingState(current);
    setRecordingState({ status: "idle" });
  }

  async function retrySend() {
    const current = recordingStateRef.current;
    if (current.status !== "failed") return;
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
    setWhisperPickerOpen(false);
    fileRef.current?.click();
  }

  function handleSendLocation() {
    if (disabled || sending || recordingState.status !== "idle") return;
    setActionsOpen(false);
    setWhisperPickerOpen(false);
    void onSendLocation();
  }

  function handleOpenWhisperPicker() {
    if (disabled || sending || recordingState.status !== "idle" || !canPickWhisper) return;
    setActionsOpen(false);
    setWhisperPickerOpen(true);
  }

  function handleSelectWhisper(memberId: string) {
    onSelectWhisper?.(memberId);
    setActionsOpen(false);
    setWhisperPickerOpen(false);
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
        ref={recordingBarRef}
        className={inputShellClass}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
      >
        <div className="px-3 py-2 sm:px-4">
          <div
            className={
              slideOffActive
                ? "flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-100/90 px-4 text-sm text-slate-500 shadow-sm ring-1 ring-white/70 transition-colors"
                : "flex h-11 items-center justify-center gap-2 rounded-2xl bg-rose-50/95 px-4 text-sm text-rose-700 shadow-sm ring-1 ring-rose-100/80 transition-colors"
            }
          >
            <span
              aria-hidden
              className={
                slideOffActive
                  ? "inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400"
                  : recordingState.stopping
                    ? "inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500"
                    : "inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500"
              }
            />
            <span className="truncate font-semibold">
              {slideOffActive
                ? t("inputRecordingReleaseCancel")
                : t("inputRecordingHoldHint")}
            </span>
            <span className="font-mono tabular-nums">
              {formatDuration(recordingState.elapsedMs)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (recordingState.status === "uploading") {
    return (
      <div
        className={inputShellClass}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
      >
        <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
          <div className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-50/95 px-3 text-sm text-blue-700 shadow-sm ring-1 ring-blue-100/80">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-blue-500"
            />
            <span className="truncate font-semibold">{t("inputRecordingSending")}</span>
            <span className="font-mono tabular-nums">
              {formatDuration(recordingState.result.durationMs)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (recordingState.status === "failed") {
    return (
      <div
        className={inputShellClass}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
      >
        <div className="space-y-2 px-3 py-2 sm:px-4">
          <div className="rounded-2xl bg-rose-50/95 px-3 py-2 text-xs text-rose-700 shadow-sm ring-1 ring-rose-100/80">
            {recordingState.error}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-40 flex-1 items-center justify-center gap-2 rounded-2xl bg-white/90 px-3 py-3 text-sm text-slate-700 shadow-sm ring-1 ring-white/80">
              <span className="truncate font-semibold">
                {t("inputRecordingDone")}
              </span>
              <span className="font-mono tabular-nums">
                {formatDuration(recordingState.result.durationMs)}
              </span>
            </div>
            <button
              type="button"
              className="btn-secondary h-10 px-3 text-sm"
              onClick={dismissFailed}
            >
              {t("inputDeleteRecording")}
            </button>
            <button
              type="button"
              className="btn-primary native-press h-10 px-4 text-sm shadow-[0_10px_18px_rgba(79,108,247,0.2)]"
              onClick={() => void retrySend()}
            >
              {t("inputRetryAudioSend")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={inputShellRef}
      className={inputShellClass}
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
    >
      {actionsOpen ? (
        <div
          id="chat-input-actions-menu"
          ref={moreMenuRef}
          tabIndex={-1}
          className="chat-input-actions-popover native-scroll"
          style={{ maxHeight: popoverMaxHeight }}
          role="menu"
          aria-label={t("inputMoreActions")}
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
          <button
            ref={whisperButtonRef}
            type="button"
            className={iconButtonClass}
            style={{ backgroundImage: "url(/ui-icons/whisper-lock.png)" }}
            aria-label={t("inputWhisper")}
            title={canPickWhisper ? t("inputWhisper") : t("inputWhisperNoMembers")}
            role="menuitem"
            aria-haspopup="dialog"
            aria-expanded={whisperPickerOpen}
            aria-controls={
              whisperPickerOpen ? "chat-input-whisper-picker" : undefined
            }
            disabled={disabled || sending || !canPickWhisper}
            onClick={handleOpenWhisperPicker}
          />
          {onOpenKeeper ? (
            <button
              type="button"
              className="native-icon-button native-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-emerald-50 text-sm font-black text-emerald-700 ring-1 ring-white/80 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
              aria-label={t("keeperTalk")}
              title={t("keeperTalk")}
              role="menuitem"
              disabled={disabled || sending}
              onClick={() => {
                setActionsOpen(false);
                setWhisperPickerOpen(false);
                onOpenKeeper();
              }}
            >
              家
            </button>
          ) : null}
        </div>
      ) : null}
      {whisperPickerOpen ? (
        <div
          id="chat-input-whisper-picker"
          ref={whisperPickerRef}
          tabIndex={-1}
          className="chat-input-whisper-popover"
          style={{ maxHeight: popoverMaxHeight }}
          role="dialog"
          aria-label={t("inputWhisperPick")}
        >
          <div className="flex items-center gap-2 border-b border-violet-50 px-3 py-2 text-sm font-semibold text-violet-800">
            <span
              aria-hidden
              className="h-5 w-5 shrink-0 rounded-md bg-cover bg-center"
              style={{ backgroundImage: "url(/ui-icons/whisper-lock.png)" }}
            />
            <span className="truncate">{t("inputWhisperPick")}</span>
          </div>
          <div className="native-scroll chat-input-whisper-list">
            {whisperCandidates.map((member) => (
              <button
                key={member.id}
                type="button"
                className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-200"
                onClick={() => handleSelectWhisper(member.id)}
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700"
                >
                  {member.nickname.trim().slice(0, 1) || "?"}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {member.nickname}
                </span>
                {member.id === whisperTargetId ? (
                  <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                    {t("inputWhisperCurrent")}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="w-full border-t border-slate-100 px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-200"
            onClick={() => setWhisperPickerOpen(false)}
          >
            {t("commonCancel")}
          </button>
        </div>
      ) : null}
      {privacyNotice ? (
        <div className="border-b border-amber-100/70 bg-amber-50/90 px-4 py-2 text-xs text-amber-700">
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
          aria-controls={actionsOpen ? "chat-input-actions-menu" : undefined}
          onClick={() => {
            setWhisperPickerOpen(false);
            setActionsOpen((open) => !open);
          }}
        />
        <button
          ref={voiceButtonRef}
          type="button"
          className={iconButtonClass}
          style={{
            backgroundImage: "url(/ui-icons/voice.png)",
            touchAction: "none",
          }}
          aria-label={t("inputRecordVoice")}
          title={t("inputRecordVoice")}
          disabled={disabled || sending}
          onPointerDown={(e) => {
            void handleVoicePointerDown(e);
          }}
        />
        <textarea
          rows={1}
          className="field max-h-32 min-h-[44px] flex-1 resize-none rounded-[18px] border-[#dedbd2] bg-white/95 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_5px_14px_rgba(71,64,49,0.05)] focus:border-brand-300"
          placeholder={keeperMode ? t("keeperInputPlaceholder") : t("inputPlaceholder")}
          value={text}
          disabled={disabled}
          style={{ fontSize: 16 }}
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
          className="btn-primary native-press h-10 rounded-[16px] px-4 shadow-[0_10px_18px_rgba(79,108,247,0.22)]"
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
  if (state.status === "uploading" || state.status === "failed") {
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
