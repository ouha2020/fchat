"use client";

import PageHeader from "@/components/ui/PageHeader";

import {
  ArrowPathIcon,
  CameraIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  ClockIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import AppLoading from "@/components/AppLoading";
import { useDialog } from "@/components/Dialog";
import {
  CalendarDaysIcon,
  UsersIcon,
} from "@/components/ui/FamilyIcons";
import { useLanguage } from "@/components/LanguageProvider";
import MemberAvatarCircle from "@/components/MemberAvatarCircle";
import { useToast } from "@/components/Toast";
import { clearSession, loadSession, saveSession, type LocalSession } from "@/lib/authLocal";
import { updateMemberAvatar, uploadAvatar } from "@/lib/avatarService";
import { humanizeError } from "@/lib/errors";
import { cacheImageBlob } from "@/lib/imageCache";
import { prepareAvatarImage } from "@/lib/imageCompression";
import { validateMember } from "@/lib/familyService";
import { notifyMemberProfileChanged } from "@/lib/memberProfileEvents";
import { getPersonalDashboard } from "@/lib/personalDashboardService";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import type {
  PersonalDashboard,
  PersonalDashboardScheduleItem,
} from "@/types/personalDashboard";

export default function MePage() {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  const { language, t } = useLanguage();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [dashboard, setDashboard] = useState<PersonalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const refreshDashboard = useCallback(
    async (activeSession: LocalSession, quiet = false) => {
      if (!quiet) setRefreshing(true);
      try {
        const todayStart = startOfDay(new Date());
        const todayEnd = addDays(todayStart, 1);
        const rows = await getPersonalDashboard(
          activeSession,
          todayStart,
          todayEnd,
          new Date(),
        );
        setDashboard(rows);
      } catch (err) {
        const message = humanizeError(err, language) || t("meLoadFailed");
        if (quiet) toast.error(message);
        else setLoadError(message);
      } finally {
        if (!quiet) setRefreshing(false);
      }
    },
    [language, t, toast],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    if (!isSupabaseConfigured()) {
      setLoading(false);
      setLoadError(t("envTitle"));
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
    const localSession = local;

    async function run() {
      try {
        const fresh = await validateMember(
          localSession.member_id,
          localSession.member_token,
        );
        if (cancelled) return;
        if (!fresh) {
          clearSession();
          setLoadError(t("chatSessionExpired"));
          setLoading(false);
          return;
        }
        saveSession(fresh);
        setSession(fresh);
        await refreshDashboard(fresh, false);
      } catch (err) {
        if (!cancelled) {
          setLoadError(humanizeError(err, language) || t("meLoadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [language, refreshDashboard, router, t]);

  useEffect(() => {
    if (!session) return;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshDashboard(session, true);
      }
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refreshDashboard, session]);

  function openSchedule(item: PersonalDashboardScheduleItem) {
    router.push(`/schedule?item=${encodeURIComponent(item.id)}`);
  }

  async function handleAvatarFile(file: File | null) {
    if (!file || !session) return;
    setAvatarBusy(true);
    try {
      // Phone photos routinely exceed the 2MB upload cap — resize/re-encode
      // first (also converts HEIC), same as chat images.
      const prepared = await prepareAvatarImage(file);
      const url = await uploadAvatar(session, prepared);
      const savedUrl = await updateMemberAvatar(session, url);
      // Keep a local copy of exactly the bytes we uploaded, so the new avatar
      // shows instantly everywhere without a round-trip to storage.
      await cacheImageBlob(savedUrl ?? url, prepared).catch(() => undefined);
      setDashboard((current) =>
        current
          ? {
              ...current,
              profile: {
                ...current.profile,
                avatar_url: savedUrl,
              },
            }
          : current,
      );
      notifyMemberProfileChanged({
        familyId: session.family_id,
        memberId: session.member_id,
        avatarUrl: savedUrl,
      });
      toast.success(t("meAvatarUpdated"));
    } catch (err) {
      toast.error(humanizeError(err, language) || t("meAvatarUploadFailed"));
    } finally {
      setAvatarBusy(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  async function handleRemoveAvatar() {
    if (!session || !dashboard?.profile.avatar_url) return;
    const ok = await dialog.confirm({
      title: t("meAvatarRemove"),
      message: t("meAvatarRemoveConfirm"),
      danger: true,
    });
    if (!ok) return;
    setAvatarBusy(true);
    try {
      await updateMemberAvatar(session, null);
      setDashboard((current) =>
        current
          ? {
              ...current,
              profile: {
                ...current.profile,
                avatar_url: null,
              },
            }
          : current,
      );
      notifyMemberProfileChanged({
        familyId: session.family_id,
        memberId: session.member_id,
        avatarUrl: null,
      });
      toast.success(t("meAvatarRemoved"));
    } catch (err) {
      toast.error(humanizeError(err, language) || t("meAvatarUploadFailed"));
    } finally {
      setAvatarBusy(false);
    }
  }

  if (loading) {
    return <AppLoading tone="profile" message={t("commonLoading")} />;
  }

  if (loadError || !session || !dashboard) {
    return (
      <div className="app-page">
        <div className="section-card text-center">
          <h1 className="text-lg font-bold text-slate-900">{t("meTitle")}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {loadError ?? t("meLoadFailed")}
          </p>
          <Link href="/" className="btn-primary mt-5">
            {t("chatBackHome")}
          </Link>
        </div>
      </div>
    );
  }

  const profile = dashboard.profile;

  return (
    <div className="app-page">
      <PageHeader
        title={t("meTitle")}
        backLabel={t("commonBackToChat")}
        action={
          <button
            type="button"
            className="btn-ghost shrink-0 gap-1.5 px-3"
            disabled={refreshing}
            aria-busy={refreshing}
            onClick={() => refreshDashboard(session, false)}
          >
            <ArrowPathIcon
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span>{refreshing ? t("commonLoading") : t("meRefresh")}</span>
          </button>
        }
      />

      <section className="relative mb-4 overflow-hidden rounded-[28px] bg-[#f2f7e9] px-4 py-5 ring-1 ring-brand-100/80 min-[390px]:px-5">
        <span
          className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full bg-brand-200/35"
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute -bottom-14 left-8 h-24 w-24 rounded-full bg-amber-100/55"
          aria-hidden="true"
        />

        <div className="relative flex min-w-0 items-center gap-4">
          <div className="relative shrink-0">
            <MemberAvatarCircle
              session={session}
              avatarRef={profile.avatar_url}
              name={profile.nickname}
              className="h-20 w-20 rounded-full bg-white text-2xl font-bold text-brand-700 shadow-sm ring-4 ring-white min-[390px]:h-24 min-[390px]:w-24"
            />
            <span
              className="absolute bottom-1 right-0 h-4 w-4 rounded-full border-[3px] border-white bg-brand-500"
              aria-hidden="true"
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-700">
              {t("meIdentity")}
            </p>
            <h2 className="mt-1 break-words text-2xl font-bold leading-tight text-slate-950">
              {profile.nickname}
            </h2>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="tone-chip tone-chip-success">
                {roleLabel(profile.role, t)}
              </span>
              <span className="tone-chip tone-chip-muted">
                {profile.is_admin ? t("commonAdmin") : t("meMember")}
              </span>
            </div>
            <p className="mt-2 min-w-0 break-words text-sm leading-5 text-slate-600">
              {profile.family_name}
            </p>
          </div>
        </div>

        <input
          ref={avatarInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={(event) => {
            void handleAvatarFile(event.target.files?.[0] ?? null);
          }}
        />

        <div
          className={`relative mt-5 grid grid-cols-1 gap-2 ${
            profile.avatar_url ? "min-[390px]:grid-cols-2" : ""
          }`}
        >
          <button
            type="button"
            className="btn-secondary min-w-0 gap-2 bg-white/85 px-3 text-sm"
            disabled={avatarBusy}
            onClick={() => avatarInputRef.current?.click()}
          >
            <CameraIcon className="h-4 w-4" aria-hidden="true" />
            {avatarBusy
              ? t("commonLoading")
              : profile.avatar_url
                ? t("meAvatarChange")
                : t("meAvatarUpload")}
          </button>
          {profile.avatar_url ? (
            <button
              type="button"
              className="btn-ghost min-w-0 gap-2 bg-white/45 px-3 text-sm text-rose-600 hover:bg-rose-50"
              disabled={avatarBusy}
              onClick={() => {
                void handleRemoveAvatar();
              }}
            >
              <TrashIcon className="h-4 w-4" aria-hidden="true" />
              {t("meAvatarRemove")}
            </button>
          ) : null}
        </div>

        <div className="relative mt-4 flex min-w-0 items-start gap-2 border-t border-brand-200/70 pt-3 text-xs leading-5 text-slate-600">
          <CheckCircleIcon
            className="mt-0.5 h-4 w-4 shrink-0 text-brand-700"
            aria-hidden="true"
          />
          <p className="min-w-0 break-words">{t("meIdentitySaved")}</p>
        </div>
      </section>

      <nav className="grid grid-cols-3 gap-2" aria-label={t("meTitle")}>
        <Link
          href="/settings"
          className="group flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl bg-white px-2 py-3 text-center ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:ring-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <Cog6ToothIcon className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="min-w-0 max-w-full truncate text-xs font-semibold text-slate-700">
            {t("chatSettings")}
          </span>
        </Link>
        <Link
          href="/members"
          className="group flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl bg-white px-2 py-3 text-center ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:ring-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <UsersIcon className="h-10 w-10" />
          <span className="min-w-0 max-w-full truncate text-xs font-semibold text-slate-700">
            {t("chatMembers")}
          </span>
        </Link>
        <Link
          href="/schedule"
          className="group flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl bg-white px-2 py-3 text-center ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:ring-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <CalendarDaysIcon className="h-10 w-10" />
          <span className="min-w-0 max-w-full truncate text-xs font-semibold text-slate-700">
            {t("scheduleTitle")}
          </span>
        </Link>
      </nav>

      <div className="mt-7 space-y-6">
        <DashboardSection
          title={t("meTodayAssigned")}
          empty={t("meTodayAssignedEmpty")}
          items={dashboard.today_assigned}
          language={language}
          t={t}
          onOpen={openSchedule}
          tone="brand"
        />
        <DashboardSection
          title={t("meUpcoming")}
          empty={t("meUpcomingEmpty")}
          items={dashboard.upcoming}
          language={language}
          t={t}
          onOpen={openSchedule}
          tone="amber"
          footer={
            dashboard.upcoming.length >= 8 ? (
              <Link
                href="/schedule"
                className="inline-flex min-h-9 items-center gap-1 rounded-full px-1 text-sm font-semibold text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
              >
                {t("meViewSchedule")}
                <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : null
          }
        />
        <DashboardSection
          title={t("meCreatedByMe")}
          empty={t("meCreatedByMeEmpty")}
          items={dashboard.created_by_me}
          language={language}
          t={t}
          onOpen={openSchedule}
          tone="sky"
        />
        <DashboardSection
          title={t("meRecentDone")}
          empty={t("meRecentDoneEmpty")}
          items={dashboard.recent_done}
          language={language}
          t={t}
          onOpen={openSchedule}
          tone="slate"
          done
        />
      </div>
    </div>
  );
}

function DashboardSection({
  title,
  empty,
  items,
  language,
  t,
  onOpen,
  footer,
  tone,
  done = false,
}: {
  title: string;
  empty: string;
  items: PersonalDashboardScheduleItem[];
  language: string;
  t: ReturnType<typeof useLanguage>["t"];
  onOpen: (item: PersonalDashboardScheduleItem) => void;
  footer?: ReactNode;
  tone: DashboardTone;
  done?: boolean;
}) {
  const sectionTone = dashboardTone(tone);

  return (
    <section className="min-w-0 border-b border-stone-200/70 px-1 pb-6 last:border-b-0">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${sectionTone.dot}`}
            aria-hidden="true"
          />
          <h2 className="min-w-0 break-words text-base font-bold text-slate-900">
            {title}
          </h2>
          <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-100">
            {items.length}
          </span>
        </div>
        {footer}
      </div>
      {items.length === 0 ? (
        <div
          className={`flex min-w-0 items-center gap-3 rounded-2xl border border-dashed px-4 py-4 ${sectionTone.empty}`}
        >
          <ClockIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 break-words text-sm leading-6">{empty}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="group min-w-0 w-full rounded-[22px] bg-white p-3 text-left shadow-[0_8px_24px_rgba(45,55,35,0.04)] ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:ring-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              onClick={() => onOpen(item)}
            >
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className={`w-[72px] shrink-0 rounded-2xl px-2 py-2.5 text-center ${
                    done ? "bg-slate-100" : sectionTone.date
                  }`}
                >
                  <div
                    className={`whitespace-nowrap text-xs font-bold ${
                      done ? "text-slate-500" : sectionTone.time
                    }`}
                  >
                    {formatTime(item.starts_at, language)}
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-slate-500">
                    {formatShortDate(item.starts_at, language)}
                  </div>
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  <div className="flex min-w-0 items-start gap-1.5">
                    <span
                      className={`min-w-0 flex-1 break-words text-sm font-bold leading-5 ${
                        done ? "line-through text-slate-500" : "text-slate-900"
                      }`}
                    >
                      {item.title}
                    </span>
                    {item.visibility === "private" ? (
                      <LockBadge label={t("scheduleVisibilityPrivate")} />
                    ) : null}
                    <ChevronRightIcon
                      className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                    <span
                      className={`tone-chip min-w-0 whitespace-normal break-words ${itemTypeTone(
                        item.item_type,
                      )}`}
                    >
                      {itemTypeLabel(item.item_type, t)}
                    </span>
                    <span className="meta-chip min-w-0 whitespace-normal break-words">
                      {t("scheduleAssignee")}: {item.assignee_nickname}
                    </span>
                    {item.recurrence_rule && item.recurrence_rule !== "none" ? (
                      <span className="meta-chip min-w-0 whitespace-normal break-words">
                        {recurrenceLabel(item.recurrence_rule, t)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

type DashboardTone = "brand" | "amber" | "sky" | "slate";

function dashboardTone(tone: DashboardTone): {
  dot: string;
  date: string;
  time: string;
  empty: string;
} {
  if (tone === "amber") {
    return {
      dot: "bg-amber-400",
      date: "bg-amber-50",
      time: "text-amber-700",
      empty: "border-amber-200 bg-amber-50/60 text-amber-800",
    };
  }
  if (tone === "sky") {
    return {
      dot: "bg-sky-400",
      date: "bg-sky-50",
      time: "text-sky-700",
      empty: "border-sky-200 bg-sky-50/60 text-sky-800",
    };
  }
  if (tone === "slate") {
    return {
      dot: "bg-slate-400",
      date: "bg-slate-100",
      time: "text-slate-600",
      empty: "border-slate-200 bg-white/60 text-slate-500",
    };
  }
  return {
    dot: "bg-brand-500",
    date: "bg-brand-50",
    time: "text-brand-700",
    empty: "border-brand-200 bg-brand-50/60 text-brand-800",
  };
}

function itemTypeTone(type: string): string {
  if (type === "todo") return "tone-chip-private";
  if (type === "reminder") return "tone-chip-warning";
  return "tone-chip-success";
}

function LockBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 ring-1 ring-violet-100">
      <span className="sr-only">{label}</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    </span>
  );
}

function roleLabel(role: string, t: ReturnType<typeof useLanguage>["t"]): string {
  if (role === "mother") return t("roleMother");
  if (role === "child") return t("roleChild");
  return t("roleFather");
}

function itemTypeLabel(
  type: string,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  if (type === "todo") return t("scheduleTypeTodo");
  if (type === "reminder") return t("scheduleTypeReminder");
  return t("scheduleTypeSchedule");
}

function recurrenceLabel(
  rule: string,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  if (rule === "daily") return t("scheduleRepeatDaily");
  if (rule === "weekly") return t("scheduleRepeatWeekly");
  if (rule === "monthly") return t("scheduleRepeatMonthly");
  return t("scheduleRepeatNone");
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatTime(value: string, language: string): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatShortDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function localeFor(language: string): string {
  if (language === "ja") return "ja-JP";
  if (language === "en") return "en-US";
  return "zh-CN";
}
