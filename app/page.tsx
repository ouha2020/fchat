"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useLanguage } from "@/components/LanguageProvider";
import RoleSelect from "@/components/RoleSelect";
import { clearSession, loadSession, saveSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import {
  joinFamily,
  rejoinFamilyMember,
  validateMember,
} from "@/lib/familyService";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import type { FamilyRole } from "@/types/family";

export default function HomePage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [familyCode, setFamilyCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<FamilyRole | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [needsAdminPassword, setNeedsAdminPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const local = loadSession();
      if (!local || !isSupabaseConfigured()) {
        setRestoring(false);
        return;
      }
      try {
        const session = await validateMember(local.member_id, local.member_token);
        if (cancelled) return;
        if (session) {
          saveSession(session);
          router.replace("/chat");
          return;
        }
      } catch {
        clearSession();
      }
      if (!cancelled) setRestoring(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (
      !familyCode.trim() ||
      !nickname.trim() ||
      (!needsAdminPassword && !role)
    ) {
      setError(t("homeMissingFields"));
      return;
    }
    if (needsAdminPassword && !adminPassword) {
      setError(t("homeRejoinMissingPassword"));
      return;
    }
    setLoading(true);
    try {
      const code = familyCode.trim().toUpperCase();
      const name = nickname.trim();
      const session = needsAdminPassword
        ? await rejoinFamilyMember({
            familyCode: code,
            nickname: name,
            adminPassword,
          })
        : await joinFamily({
            familyCode: code,
            nickname: name,
            role: role!,
          });
      saveSession(session);
      router.replace("/chat");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : String((err as { message?: string })?.message ?? err);
      if (!needsAdminPassword && message.includes("nickname_taken")) {
        setNeedsAdminPassword(true);
        setError(t("homeRejoinPrompt"));
      } else {
        setError(humanizeError(err, language));
      }
    } finally {
      setLoading(false);
    }
  }

  if (restoring) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-500">
        {t("homeRestoring")}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-8 sm:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{t("appTitle")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("homeSubtitle")}
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="card flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="code">
            {t("homeFamilyCode")}
          </label>
          <input
            id="code"
            className="field tracking-widest uppercase"
            placeholder={t("homeCodePlaceholder")}
            maxLength={12}
            value={familyCode}
            onChange={(e) => {
              setFamilyCode(e.target.value.toUpperCase());
              setNeedsAdminPassword(false);
              setAdminPassword("");
            }}
            autoComplete="off"
          />
        </div>

        <div>
          <label className="label" htmlFor="nickname">
            {t("homeNickname")}
          </label>
          <input
            id="nickname"
            className="field"
            placeholder={t("homeNicknamePlaceholder")}
            maxLength={20}
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value);
              setNeedsAdminPassword(false);
              setAdminPassword("");
            }}
            autoComplete="off"
          />
        </div>

        {needsAdminPassword ? (
          <div>
            <label className="label" htmlFor="admin-password">
              {t("homeAdminPassword")}
            </label>
            <input
              id="admin-password"
              className="field"
              type="password"
              placeholder={t("homeAdminPasswordPlaceholder")}
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              autoComplete="current-password"
            />
            <p className="mt-2 text-xs text-slate-500">
              {t("homeRejoinHelp")}
            </p>
          </div>
        ) : (
          <div>
            <span className="label">{t("homeSelectRole")}</span>
            <RoleSelect value={role} onChange={setRole} />
          </div>
        )}

        {error ? (
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          className="btn-primary mt-1"
          disabled={loading}
        >
          {loading
            ? t("homeJoining")
            : needsAdminPassword
              ? t("homeRejoin")
              : t("homeJoin")}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        {t("homeNoFamily")}
        <Link className="ml-1 text-brand-600 hover:underline" href="/create-family">
          {t("homeCreateFamily")}
        </Link>
      </div>
    </div>
  );
}
