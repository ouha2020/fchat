"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useLanguage } from "@/components/LanguageProvider";
import RoleSelect from "@/components/RoleSelect";
import { createFamilyWithVerifiedCode, ensureFamilyCode } from "@/lib/accountClient";
import { saveSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import { getSupabaseAuth } from "@/lib/supabaseAuthClient";
import type { FamilyRole } from "@/types/family";

export default function CreateFamilyPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [familyCode, setFamilyCode] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<FamilyRole | null>(null);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const { data } = await getSupabaseAuth().auth.getSession();
        if (!data.session) {
          router.replace("/login");
          return;
        }

        const status = await ensureFamilyCode(false);
        if (cancelled) return;

        if (status.status === "has_family" && status.session) {
          saveSession(status.session);
          router.replace("/chat");
          return;
        }

        if (status.status !== "verified") {
          router.replace(`/verify-family-code?status=${status.status}`);
          return;
        }
      } catch {
        router.replace("/login");
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!familyCode.trim()) return setError(t("authFamilyCodeFromEmailRequired"));
    if (!familyName.trim()) return setError(t("error_family_name_required"));
    if (!nickname.trim()) return setError(t("error_nickname_required"));
    if (!role) return setError(t("error_invalid_role"));

    setLoading(true);
    try {
      const session = await createFamilyWithVerifiedCode({
        familyCode: familyCode.trim().toUpperCase(),
        familyName: familyName.trim(),
        nickname: nickname.trim(),
        role,
      });
      saveSession(session);
      router.replace("/chat");
    } catch (err) {
      setError(
        err instanceof Error ? humanizeError(err, language) : t("authCreateFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-page-narrow">
      <header className="app-header-stack">
        <Link href="/verify-family-code" className="back-link">
          {t("authBackVerify")}
        </Link>
        <h1 className="page-title">{t("authCreateTitle")}</h1>
        <p className="page-subtitle">
          {t("authCreateSubtitle")}
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="section-card flex flex-col gap-4">
        {checking ? (
          <div className="text-sm text-slate-500">{t("authCheckingEligibility")}</div>
        ) : null}

        <div>
          <label className="label" htmlFor="family-code">
            {t("authFamilyCodeLabel")}
          </label>
          <input
            id="family-code"
            className="field tracking-widest uppercase"
            maxLength={12}
            value={familyCode}
            onChange={(e) => setFamilyCode(e.target.value.toUpperCase())}
            disabled={loading || checking}
            autoComplete="one-time-code"
          />
        </div>

        <div>
          <label className="label" htmlFor="family-name">
            {t("authFamilyNameLabel")}
          </label>
          <input
            id="family-name"
            className="field"
            placeholder={t("authFamilyNamePlaceholder")}
            maxLength={30}
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            disabled={loading || checking}
          />
        </div>

        <div>
          <label className="label" htmlFor="nickname">
            {t("authCreatorNicknameLabel")}
          </label>
          <input
            id="nickname"
            className="field"
            placeholder={t("authNicknamePlaceholder")}
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            disabled={loading || checking}
          />
        </div>

        <div>
          <span className="label">{t("authCreatorRoleLabel")}</span>
          <RoleSelect value={role} onChange={setRole} />
        </div>

        <div className="info-note">
          {t("authAdminNote")}
        </div>

        {error ? (
          <div className="error-note">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={loading || checking}>
          {loading ? t("authCreateBusy") : t("authCreateButton")}
        </button>
      </form>
    </div>
  );
}
