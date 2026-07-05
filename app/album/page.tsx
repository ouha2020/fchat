"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import AppLoading from "@/components/AppLoading";
import { useDialog } from "@/components/Dialog";
import { useLanguage } from "@/components/LanguageProvider";
import MemberAvatarCircle from "@/components/MemberAvatarCircle";
import { useToast } from "@/components/Toast";
import { listAlbumItems, removeAlbumItem } from "@/lib/albumService";
import { clearSession, loadSession, saveSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import { validateMember } from "@/lib/familyService";
import { useCachedImage } from "@/lib/imageCache";
import { listMembers } from "@/lib/memberService";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import type { AlbumItem } from "@/types/album";
import type { FamilyMember } from "@/types/member";

export default function AlbumPage() {
  return (
    <Suspense fallback={<AppLoading tone="members" message="" />}>
      <AlbumContent />
    </Suspense>
  );
}

function AlbumContent() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const dialog = useDialog();
  const toast = useToast();
  const searchParams = useSearchParams();
  const ownerParam = searchParams.get("member")?.trim() || null;

  const [session, setSession] = useState<LocalSession | null>(null);
  const [owner, setOwner] = useState<FamilyMember | null>(null);
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const local = loadSession();
    if (!local) {
      router.replace("/");
      return () => {
        cancelled = true;
      };
    }

    async function run(localSession: LocalSession) {
      try {
        const fresh = await validateMember(
          localSession.member_id,
          localSession.member_token,
        );
        if (cancelled) return;
        if (!fresh) {
          clearSession();
          setSession(null);
          setLoadError(t("chatSessionExpired"));
          setLoading(false);
          return;
        }
        saveSession(fresh);
        setSession(fresh);
        const ownerId = ownerParam ?? fresh.member_id;
        const [members, albumItems] = await Promise.all([
          listMembers(fresh, { includeRemoved: true }),
          listAlbumItems(fresh, ownerId),
        ]);
        if (cancelled) return;
        setOwner(members.find((m) => m.id === ownerId) ?? null);
        setItems(albumItems);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setLoadError(humanizeError(err, language) || t("albumLoadFailed"));
        setLoading(false);
      }
    }

    run(local);
    return () => {
      cancelled = true;
    };
  }, [ownerParam, router, t, language]);

  const isOwn = !!session && !!owner && owner.id === session.member_id;

  const handleRemove = useCallback(
    async (item: AlbumItem) => {
      if (!session) return;
      const ok = await dialog.confirm({
        title: t("albumRemove"),
        message: t("albumRemoveConfirm"),
      });
      if (!ok) return;
      try {
        await removeAlbumItem(session, item.id);
        setItems((prev) => {
          const next = prev.filter((i) => i.id !== item.id);
          setLightboxIndex((current) => {
            if (current === null) return null;
            if (next.length === 0) return null;
            return Math.min(current, next.length - 1);
          });
          return next;
        });
      } catch (err) {
        toast.error(humanizeError(err, language));
      }
    },
    [session, dialog, t, toast, language],
  );

  if (loading) {
    return <AppLoading tone="members" message={t("commonLoading")} />;
  }

  const title = isOwn
    ? t("albumMineTitle")
    : t("albumOfTitle", { nickname: owner?.nickname ?? "" });

  return (
    <div className="app-page">
      <header className="app-header">
        <div className="min-w-0">
          <Link href="/chat" className="back-link">
            {t("commonBackToChat")}
          </Link>
          <div className="mt-2 flex items-center gap-3">
            {owner ? (
              <MemberAvatarCircle
                session={session}
                avatarRef={owner.avatar_url ?? null}
                name={owner.nickname}
                className="h-10 w-10 rounded-full bg-white text-base font-semibold text-slate-700 shadow-[0_8px_18px_rgba(71,64,49,0.08)] ring-1 ring-white/80"
                ariaHidden
              />
            ) : null}
            <h1 className="page-title">{title}</h1>
          </div>
        </div>
      </header>

      {loadError ? (
        <div className="section-card text-center">
          <p className="text-sm leading-relaxed text-slate-500">{loadError}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="section-card text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl">
            🖼️
          </div>
          <p className="text-sm leading-relaxed text-slate-500">
            {isOwn ? t("albumEmptyOwn") : t("albumEmptyOther")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2">
          {items.map((item, index) => (
            <AlbumThumb
              key={item.id}
              session={session}
              item={item}
              onOpen={() => setLightboxIndex(index)}
            />
          ))}
        </div>
      )}

      {lightboxIndex !== null && items[lightboxIndex] ? (
        <AlbumLightbox
          session={session}
          items={items}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          canRemove={isOwn}
          onClose={() => setLightboxIndex(null)}
          onRemove={() => handleRemove(items[lightboxIndex])}
          removeLabel={t("albumRemove")}
          closeLabel={t("albumBack")}
        />
      ) : null}
    </div>
  );
}

function AlbumThumb({
  session,
  item,
  onOpen,
}: {
  session: LocalSession | null;
  item: AlbumItem;
  onOpen: () => void;
}) {
  const media = useCachedImage(session, item.image_ref);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative aspect-square overflow-hidden rounded-xl bg-slate-200/70 ring-1 ring-black/5 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      {media.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={media.url}
          alt=""
          className="h-full w-full object-cover transition group-hover:brightness-95"
          draggable={false}
        />
      ) : (
        <span
          className={`block h-full w-full ${media.status === "error" ? "" : "animate-pulse"}`}
        />
      )}
    </button>
  );
}

function AlbumLightbox({
  session,
  items,
  index,
  onIndexChange,
  canRemove,
  onClose,
  onRemove,
  removeLabel,
  closeLabel,
}: {
  session: LocalSession | null;
  items: AlbumItem[];
  index: number;
  onIndexChange: (index: number) => void;
  canRemove: boolean;
  onClose: () => void;
  onRemove: () => void;
  removeLabel: string;
  closeLabel: string;
}) {
  const item = items[index];
  const media = useCachedImage(session, item?.image_ref ?? null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const goPrev = useCallback(() => {
    if (index > 0) onIndexChange(index - 1);
  }, [index, onIndexChange]);
  const goNext = useCallback(() => {
    if (index < items.length - 1) onIndexChange(index + 1);
  }, [index, items.length, onIndexChange]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  function handleTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Horizontal swipe only, with a comfortable threshold.
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) goPrev();
    else goNext();
  }

  const arrowClass =
    "absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur transition hover:bg-white/20 active:bg-white/25 disabled:opacity-0";

  return (
    <div
      className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20 active:bg-white/25"
        >
          {closeLabel}
        </button>
        <span className="text-sm font-medium text-white/70">
          {index + 1} / {items.length}
        </span>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="min-h-10 rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-rose-200 backdrop-blur transition hover:bg-white/20 active:bg-white/25"
          >
            {removeLabel}
          </button>
        ) : (
          <span className="min-h-10 w-16" aria-hidden />
        )}
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <button
          type="button"
          onClick={onClose}
          className="flex h-full w-full items-center justify-center p-4"
          aria-label={closeLabel}
        >
          {media.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={media.url}
              alt=""
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          ) : (
            <span className="text-sm text-white/70">···</span>
          )}
        </button>

        {hasPrev ? (
          <button
            type="button"
            onClick={goPrev}
            className={`${arrowClass} left-3`}
            aria-label="Previous"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        ) : null}
        {hasNext ? (
          <button
            type="button"
            onClick={goNext}
            className={`${arrowClass} right-3`}
            aria-label="Next"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}
