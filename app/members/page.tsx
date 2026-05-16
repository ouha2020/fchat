"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { useDialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";
import RoleBadge from "@/components/RoleBadge";
import { clearSession, loadSession, saveSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import { removeMember, validateMember } from "@/lib/familyService";
import { formatRelative } from "@/lib/format";
import { listMembers } from "@/lib/memberService";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import type { FamilyMember } from "@/types/member";

export default function MembersPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const dialog = useDialog();
  const toast = useToast();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

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
          setSession(null);
          setLoadError(t("chatSessionExpired"));
          setLoading(false);
          return;
        }
        saveSession(fresh);
        setSession(fresh);
        const rows = await listMembers(fresh);
        if (cancelled) return;
        setMembers(rows);
      } catch (err) {
        if (!cancelled) {
          setLoadError(humanizeError(err, language) || t("chatLoadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [language, retryNonce, router, t]);

  // Live-sync the member list so other admins see removals immediately.
  useEffect(() => {
    if (!session) return;
    const sb = getSupabase();
    const channel = sb
      .channel(`members-page:${session.family_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "family_members",
          filter: `family_id=eq.${session.family_id}`,
        },
        () => {
          listMembers(session)
            .then(setMembers)
            .catch(() => undefined);
        },
      )
      .subscribe();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      listMembers(session)
        .then(setMembers)
        .catch(() => undefined);
    }, 10000);
    return () => {
      sb.removeChannel(channel);
      window.clearInterval(interval);
    };
  }, [session]);

  async function handleRemove(target: FamilyMember) {
    if (!session) return;
    if (target.id === session.member_id) {
      toast.info(t("membersCannotRemoveSelf"));
      return;
    }
    const ok = await dialog.confirm({
      title: t("membersRemove"),
      message: t("membersRemoveConfirm", { nickname: target.nickname }),
      danger: true,
    });
    if (!ok) return;
    setBusyId(target.id);
    try {
      await removeMember(session, target.id);
      setMembers((prev) => prev.filter((m) => m.id !== target.id));
    } catch (err) {
      toast.error(humanizeError(err, language));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-6 sm:px-8">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <Link href="/chat" className="text-sm text-brand-600 hover:underline">
            {t("commonBackToChat")}
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{t("membersTitle")}</h1>
        </div>
      </header>

      {loading ? (
        <div className="text-sm text-slate-500">{t("commonLoading")}</div>
      ) : loadError ? (
        <div className="card text-center">
          <h2 className="text-lg font-bold text-slate-900">
            {t("chatLoadFailedTitle")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            {loadError}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setRetryNonce((value) => value + 1)}
            >
              {t("chatRetry")}
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
              onClick={() => {
                clearSession();
                router.replace("/");
              }}
            >
              {t("chatBackHome")}
            </button>
          </div>
        </div>
      ) : (
        <ul className="card divide-y divide-slate-100 p-0">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 px-4 py-3"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-base font-semibold text-slate-700">
                {m.nickname.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.nickname}</span>
                  <RoleBadge role={m.role} />
                  {m.is_admin ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {t("membersAdmin")}
                    </span>
                  ) : null}
                  {session?.member_id === m.id ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {t("membersMe")}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-slate-500">
                  {t("membersLastActive", {
                    time: formatRelative(m.last_active_at, language),
                  })}
                </span>
              </div>
              {session?.is_admin && session.member_id !== m.id ? (
                <button
                  type="button"
                  className="btn-ghost h-9 px-3 text-sm text-rose-600 hover:bg-rose-50"
                  disabled={busyId === m.id}
                  onClick={() => handleRemove(m)}
                >
                  {busyId === m.id ? t("membersRemoving") : t("membersRemove")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
