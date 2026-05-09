"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatDuration } from "@/lib/recordingService";

interface Props {
  messageId: string;
  url: string;
  durationMs: number | null;
  isMine: boolean;
  highlighted?: boolean;
}

const BAR_COUNT = 14;
const PLAYED_AUDIO_PREFIX = "family-chat:played-audio:";

export default function AudioBubble({
  messageId,
  url,
  durationMs,
  isMine,
  highlighted,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(isMine);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (isMine) {
      setPlayed(true);
      return;
    }
    setPlayed(
      window.localStorage.getItem(`${PLAYED_AUDIO_PREFIX}${messageId}`) === "1",
    );
  }, [isMine, messageId]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!audioRef.current) {
      const a = new Audio(url);
      a.preload = "metadata";
      a.addEventListener("ended", () => setPlaying(false));
      a.addEventListener("pause", () => setPlaying(false));
      a.addEventListener("error", () => setPlaying(false));
      audioRef.current = a;
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => {
          setPlaying(true);
          setPlayed(true);
          window.localStorage.setItem(`${PLAYED_AUDIO_PREFIX}${messageId}`, "1");
        })
        .catch(() => setPlaying(false));
    }
  }

  // Width grows with duration up to ~60s. Capped to keep bubbles readable.
  const seconds = Math.max(1, Math.round((durationMs ?? 1000) / 1000));
  const capped = Math.min(seconds, 60);
  const width = Math.min(260, 164 + capped * 1.8);

  const baseColors = isMine
    ? "bg-brand-500 text-white"
    : "bg-white text-slate-800 ring-1 ring-slate-100";
  const subColors = isMine ? "text-white/80" : "text-slate-500";
  const buttonRing = isMine
    ? "bg-white/20 hover:bg-white/30"
    : "bg-brand-500/10 text-brand-600 hover:bg-brand-500/20";
  const barColor = isMine ? "bg-white/80" : "bg-slate-400";

  // Pseudo-random but stable bar heights derived from the URL hash.
  const heights = useMemo(() => makeWaveform(url, BAR_COUNT), [url]);

  return (
    <button
      type="button"
      onClick={toggle}
      style={{ width: `${width}px`, maxWidth: "100%" }}
      className={`relative flex items-center gap-2 rounded-full px-3 py-2 text-sm shadow-sm transition active:scale-[0.98] ${baseColors} ${
        isMine ? "flex-row-reverse" : "flex-row"
      } ${highlighted ? "ring-2 ring-amber-300" : ""}`}
    >
      {!isMine && !played ? (
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />
      ) : null}
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${buttonRing}`}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7L8 5z" />
          </svg>
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden">
        {heights.map((h, i) => (
          <span
            key={i}
            className={`inline-block w-[2px] rounded-full ${barColor}`}
            style={{
              height: `${h}px`,
              opacity: playing ? 0.95 : 0.65,
              animation: playing
                ? `audio-wave ${0.6 + (i % 4) * 0.15}s ease-in-out ${
                    (i % 5) * 0.07
                  }s infinite alternate`
                : undefined,
              transformOrigin: "center",
            }}
          />
        ))}
      </span>
      <span className={`min-w-[2.25rem] shrink-0 text-right text-xs tabular-nums ${subColors}`}>
        {formatDuration(durationMs ?? 0)}
      </span>
    </button>
  );
}

function makeWaveform(seed: string, count: number): number[] {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    const v = (h % 1000) / 1000;
    out.push(6 + Math.round(v * 14));
  }
  return out;
}
