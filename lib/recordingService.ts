"use client";

export interface RecordingHandle {
  startedAt: number;
  stop: () => Promise<RecordingResult>;
  cancel: () => void;
}

export interface RecordingResult {
  blob: Blob;
  durationMs: number;
  mimeType: string;
}

const PREFERRED_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of PREFERRED_MIMES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export async function startRecording(): Promise<RecordingHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("recording_unsupported");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("media_recorder_unsupported");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  let chunks: BlobPart[] = [];
  let stopped = false;
  let cancelled = false;
  let stopRequested = false;
  let stopPromise: Promise<RecordingResult> | null = null;
  let settledResult: RecordingResult | null = null;
  let settledError: Error | null = null;
  let resolveStop: ((result: RecordingResult) => void) | null = null;
  let rejectStop: ((error: Error) => void) | null = null;

  const startedAt = Date.now();

  function teardown() {
    stream.getTracks().forEach((track) => track.stop());
  }

  function settle() {
    if (!resolveStop || !rejectStop) return;
    if (settledError) {
      rejectStop(settledError);
      return;
    }
    if (settledResult) {
      resolveStop(settledResult);
    }
  }

  function finalize(error?: Error) {
    if (stopped) return;
    stopped = true;

    const type = recorder.mimeType || mimeType || "audio/webm";
    const blob = new Blob(chunks, { type });
    chunks = [];
    teardown();

    if (error) {
      settledError = error;
    } else if (cancelled) {
      settledError = new Error("recording_cancelled");
    } else {
      settledResult = {
        blob,
        durationMs: Date.now() - startedAt,
        mimeType: type,
      };
    }

    settle();
  }

  recorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  });
  recorder.addEventListener("stop", () => finalize(), { once: true });
  recorder.addEventListener(
    "error",
    (event) => {
      const error = (event as ErrorEvent).error;
      finalize(error instanceof Error ? error : new Error("recording_failed"));
    },
    { once: true },
  );

  try {
    recorder.start();
  } catch (error) {
    teardown();
    chunks = [];
    throw error;
  }

  function requestStop() {
    if (stopRequested) return;
    stopRequested = true;
    if (recorder.state === "inactive") {
      finalize();
      return;
    }
    recorder.stop();
  }

  return {
    startedAt,
    stop(): Promise<RecordingResult> {
      if (settledResult) return Promise.resolve(settledResult);
      if (settledError) return Promise.reject(settledError);
      if (!stopPromise) {
        stopPromise = new Promise((resolve, reject) => {
          resolveStop = resolve;
          rejectStop = reject;
          settle();
        });
      }
      requestStop();
      return stopPromise;
    },
    cancel() {
      cancelled = true;
      teardown();
      requestStop();
    },
  };
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(1, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
