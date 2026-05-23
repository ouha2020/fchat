"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { useToast } from "@/components/Toast";
import { clearSession, loadSession, saveSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import { validateMember } from "@/lib/familyService";
import { getPersonalDashboard } from "@/lib/personalDashboardService";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import type {
  PersonalDashboard,
  PersonalDashboardScheduleItem,
} from "@/types/personalDashboard";

export default function MePage() {
  const router = useRouter();
  const toast = useToast();
  const { language, t } = useLanguage();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [dashboard, setDashboard] = useState<PersonalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <div className="app-page">
        <div className="status-note">{t("commonLoading")}</div>
      </div>
    );
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
      <header className="app-header">
        <div className="min-w-0">
          <Link href="/chat" className="back-link">
            {t("commonBackToChat")}
          </Link>
          <h1 className="page-title mt-2">
            {t("meTitle")}
          </h1>
          <p className="mt-1 truncate text-sm text-slate-500">
            {profile.nickname} · {roleLabel(profile.role, t)} ·{" "}
            {profile.family_name}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary shrink-0 px-3"
          disabled={refreshing}
          onClick={() => refreshDashboard(session, false)}
        >
          {refreshing ? t("commonLoading") : t("meRefresh")}
        </button>
      </header>

      <section className="section-card mb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-brand-600">
              {t("meIdentity")}
            </p>
            <h2 className="mt-1 truncate text-lg font-bold text-slate-900">
              {profile.nickname}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {roleLabel(profile.role, t)} ·{" "}
              {profile.is_admin ? t("commonAdmin") : t("meMember")}
            </p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-lg font-bold text-brand-700">
            {profile.nickname.slice(0, 1).toUpperCase()}
          </div>
        </div>
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-500">
          {t("meIdentitySaved")}
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
          <Link href="/settings" className="btn-secondary text-center">
            {t("chatSettings")}
          </Link>
          <Link href="/members" className="btn-secondary text-center">
            {t("chatMembers")}
          </Link>
          <Link href="/schedule" className="btn-secondary text-center">
            {t("scheduleTitle")}
          </Link>
        </div>
      </section>

      <DashboardSection
        title={t("meTodayAssigned")}
        empty={t("meTodayAssignedEmpty")}
        items={dashboard.today_assigned}
        language={language}
        t={t}
        onOpen={openSchedule}
      />
      <DashboardSection
        title={t("meUpcoming")}
        empty={t("meUpcomingEmpty")}
        items={dashboard.upcoming}
        language={language}
        t={t}
        onOpen={openSchedule}
        footer={
          dashboard.upcoming.length >= 8 ? (
            <Link href="/schedule" className="text-sm font-semibold text-brand-600">
              {t("meViewSchedule")}
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
      />
      <DashboardSection
        title={t("meRecentDone")}
        empty={t("meRecentDoneEmpty")}
        items={dashboard.recent_done}
        language={language}
        t={t}
        onOpen={openSchedule}
        done
      />
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
  done = false,
}: {
  title: string;
  empty: string;
  items: PersonalDashboardScheduleItem[];
  language: string;
  t: ReturnType<typeof useLanguage>["t"];
  onOpen: (item: PersonalDashboardScheduleItem) => void;
  footer?: ReactNode;
  done?: boolean;
}) {
  return (
    <section className="section-card mb-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {footer}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`w-full rounded-2xl bg-white p-3 text-left ring-1 ring-slate-100 transition hover:ring-brand-200 ${
                done ? "opacity-75" : ""
              }`}
              onClick={() => onOpen(item)}
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="w-14 shrink-0 text-center">
                  <div className="text-sm font-bold text-brand-600">
                    {formatTime(item.starts_at, language)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {formatShortDate(item.starts_at, language)}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`min-w-0 flex-1 break-words text-sm font-semibold ${
                        done ? "line-through text-slate-500" : "text-slate-900"
                      }`}
                    >
                      {item.title}
                    </span>
                    {item.visibility === "private" ? <LockBadge /> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className="meta-chip">{itemTypeLabel(item.item_type, t)}</span>
                    <span className="meta-chip">
                      {t("scheduleAssignee")}: {item.assignee_nickname}
                    </span>
                    {item.recurrence_rule && item.recurrence_rule !== "none" ? (
                      <span className="meta-chip">
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

function LockBadge() {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 ring-1 ring-violet-100">
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
