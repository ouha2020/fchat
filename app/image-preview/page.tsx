"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { useDialog } from "@/components/Dialog";
import { loadSession, type LocalSession } from "@/lib/authLocal";
import { setChatBackground } from "@/lib/chatBackground";
import { getMessageById } from "@/lib/messageService";
import { useCachedImage } from "@/lib/imageCache";
import { safeHttpUrl } from "@/lib/security";

export default function ImagePreviewPage() {
  return (
    <Suspense
      fallback={
        <main className="fixed inset-0 z-50 bg-black" aria-label="Loading image preview" />
      }
    >
      <ImagePreviewContent />
    </Suspense>
  );
}

function ImagePreviewContent() {
  const router = useRouter();
  const { t } = useLanguage();
  const dialog = useDialog();
  const searchParams = useSearchParams();
  const messageId = searchParams.get("mid")?.trim() ?? null;
  const legacySrc = safeHttpUrl(searchParams.get("src")?.trim() ?? "");
  const lastTouchAtRef = useRef(0);
  const [session, setSession] = useState<LocalSession | null>(null);
  const [mediaRef, setMediaRef] = useState<string | null>(legacySrc);
  // Distinguishes "still figuring out which image to show" from "there is
  // conclusively nothing to show" so the error screen doesn't flash while
  // the message lookup and URL signing are in flight.
  const [refMissing, setRefMissing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const media = useCachedImage(session, mediaRef, {
    messageId,
  });
  const src = media.url;

  useEffect(() => {
    setRefMissing(false);
    const currentSession = loadSession();
    setSession(currentSession);
    if (!messageId || !currentSession) {
      setMediaRef(legacySrc);
      if (!legacySrc) setRefMissing(true);
      return;
    }
    let cancelled = false;
    getMessageById(currentSession, messageId)
      .then((message) => {
        if (cancelled) return;
        const ref =
          message?.message_type === "image" && !message.deleted_at
            ? message.image_url
            : null;
        setMediaRef(ref);
        if (!ref) setRefMissing(true);
      })
      .catch(() => {
        if (cancelled) return;
        setMediaRef(null);
        setRefMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [legacySrc, messageId]);

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/chat");
  }

  async function handleSetBackground() {
    if (!mediaRef) return;
    if (!session) {
      setNotice(t("previewNeedSession"));
      return;
    }
    const ok = await dialog.confirm({
      title: t("previewSetBackground"),
      message: t("previewSetBackgroundConfirm"),
    });
    if (!ok) return;
    setChatBackground(session.family_id, mediaRef, messageId);
    setNotice(t("previewBackgroundSet"));
  }

  function handlePreviewTouchEnd(e: React.TouchEvent<HTMLImageElement>) {
    const now = Date.now();
    if (now - lastTouchAtRef.current <= 320) {
      e.preventDefault();
      lastTouchAtRef.current = 0;
      handleSetBackground();
      return;
    }
    lastTouchAtRef.current = now;
  }

  return (
    <main className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col bg-black text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent px-4 pb-12 pt-4">
        <div className="pointer-events-auto flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="min-h-10 rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20 active:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            aria-label={t("previewBack")}
          >
            {t("previewBack")}
          </button>
          {src ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSetBackground}
                className="min-h-10 rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20 active:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                aria-label={t("previewSetBackground")}
              >
                {t("previewSetBackground")}
              </button>
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="min-h-10 rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20 active:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                aria-label={t("previewOpenOriginal")}
              >
                {t("previewOpenOriginal")}
              </a>
            </div>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-10 flex justify-center px-4">
          <div className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white backdrop-blur">
            {notice}
          </div>
        </div>
      ) : null}

      {src ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={t("previewAlt")}
            className="max-h-[100dvh] max-w-[100vw] object-contain"
            draggable={false}
            onDoubleClick={handleSetBackground}
            onTouchEnd={handlePreviewTouchEnd}
          />
        </div>
      ) : refMissing || (mediaRef !== null && media.status === "error") ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div>
            <h1 className="text-lg font-semibold">{t("previewErrorTitle")}</h1>
            <p className="mt-2 text-sm text-white/70">{t("previewErrorBody")}</p>
          </div>
          <Link
            href="/chat"
            className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-white/90"
          >
            {t("previewBackChat")}
          </Link>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-white/70">{t("commonLoading")}</p>
        </div>
      )}
    </main>
  );
}
