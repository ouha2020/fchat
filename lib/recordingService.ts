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
  const recorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType } : undefined,
  );
  const chunks: BlobPart[] = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  });

  const startedAt = Date.now();
  recorder.start();

  let cancelled = false;

  function teardown() {
    stream.getTracks().forEach((t) => t.stop());
  }

  return {
    startedAt,
    async stop(): Promise<RecordingResult> {
      return new Promise((resolve, reject) => {
        recorder.addEventListener(
          "stop",
          () => {
            teardown();
            if (cancelled) {
              reject(new Error("recording_cancelled"));
              return;
            }
            const type = recorder.mimeType || mimeType || "audio/webm";
            const blob = new Blob(chunks, { type });
            resolve({
              blob,
              durationMs: Date.now() - startedAt,
              mimeType: type,
            });
          },
          { once: true },
        );
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      });
    },
    cancel() {
      cancelled = true;
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      teardown();
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
