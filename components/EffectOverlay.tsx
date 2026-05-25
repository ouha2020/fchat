"use client";

import { useEffect, useMemo, useRef } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { Effect, EffectId } from "@/lib/effects";

interface VisualConfig {
  emojis: string[];
  count: number;
  background: string;
  captionClass: string;
  durationMs: number;
}

const VISUALS: Record<EffectId, VisualConfig> = {
  hearts: {
    emojis: ["❤️", "💕", "💖", "💗", "💝"],
    count: 36,
    background:
      "bg-gradient-to-br from-rose-200/60 via-pink-100/50 to-rose-50/40",
    captionClass: "text-rose-500",
    durationMs: 4500,
  },
  fireworks: {
    emojis: ["🎆", "🎇", "✨", "🌟"],
    count: 30,
    background:
      "bg-gradient-to-br from-indigo-300/60 via-purple-200/50 to-fuchsia-200/40",
    captionClass: "text-indigo-600",
    durationMs: 4500,
  },
  confetti: {
    emojis: ["🎉", "🎊", "🎈", "🪅"],
    count: 40,
    background:
      "bg-gradient-to-br from-amber-200/60 via-emerald-100/50 to-sky-100/40",
    captionClass: "text-emerald-600",
    durationMs: 4500,
  },
  money: {
    emojis: ["💰", "💵", "🧧", "💴"],
    count: 32,
    background:
      "bg-gradient-to-br from-yellow-200/60 via-amber-100/50 to-rose-100/40",
    captionClass: "text-amber-600",
    durationMs: 4500,
  },
  sparkles: {
    emojis: ["✨", "⭐", "🌟", "💫"],
    count: 28,
    background:
      "bg-gradient-to-br from-blue-200/60 via-violet-100/50 to-sky-100/40",
    captionClass: "text-violet-600",
    durationMs: 4500,
  },
  cake: {
    emojis: ["🎂", "🧁", "🎁", "🎈"],
    count: 28,
    background:
      "bg-gradient-to-br from-pink-200/60 via-amber-100/50 to-purple-100/40",
    captionClass: "text-pink-600",
    durationMs: 4500,
  },
};

interface Particle {
  key: string;
  emoji: string;
  left: number;
  delay: number;
  duration: number;
  size: number;
  drift: number;
  rotate: number;
}

export default function EffectOverlay({
  effect,
  onDone,
}: {
  effect: Effect;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const cfg = VISUALS[effect.id];

  const particles = useMemo<Particle[]>(() => {
    const stamp = Date.now();
    return Array.from({ length: cfg.count }, (_, i) => ({
      key: `${stamp}-${i}`,
      emoji: cfg.emojis[Math.floor(Math.random() * cfg.emojis.length)],
      left: Math.random() * 100,
      delay: Math.random() * 1.4,
      duration: 2.6 + Math.random() * 2.2,
      size: 28 + Math.random() * 36,
      drift: (Math.random() - 0.5) * 220,
      rotate: (Math.random() - 0.5) * 720,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect.id]);

  // Keep the latest onDone in a ref so reference changes from the parent
  // don't reset the auto-dismiss timer.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const t = window.setTimeout(() => onDoneRef.current(), cfg.durationMs);
    return () => window.clearTimeout(t);
  }, [cfg.durationMs]);

  return (
    <button
      type="button"
      onClick={onDone}
      aria-label={t("effectCloseAnimation")}
      className={`fixed inset-0 z-[60] flex items-center justify-center overflow-hidden ${cfg.background} backdrop-blur-[2px] transition-opacity`}
    >
      {particles.map((p) => (
        <span
          key={p.key}
          className="pointer-events-none absolute -bottom-16 select-none"
          style={
            {
              left: `${p.left}%`,
              fontSize: `${p.size}px`,
              animation: `effect-float ${p.duration}s ease-out ${p.delay}s forwards`,
              ["--drift" as string]: `${p.drift}px`,
              ["--rotate" as string]: `${p.rotate}deg`,
            } as React.CSSProperties
          }
        >
          {p.emoji}
        </span>
      ))}
      {effect.caption ? (
        <div
          className={`pointer-events-none rounded-full bg-white/90 px-7 py-4 text-3xl font-bold shadow-2xl backdrop-blur ${cfg.captionClass}`}
          style={{ animation: "effect-pop 0.6s ease-out both" }}
        >
          {effect.caption}
        </div>
      ) : null}
    </button>
  );
}
