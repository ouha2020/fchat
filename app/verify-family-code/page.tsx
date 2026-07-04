"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useLanguage } from "@/components/LanguageProvider";
import { useToast } from "@/components/Toast";
import { ensureFamilyCode, verifyFamilyCode } from "@/lib/accountClient";
import { saveSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import { getSupabaseAuth } from "@/lib/supabaseAuthClient";

export default function VerifyFamilyCodePage() {
  const router = useRouter();
  const toast = useToast();
  const { language, t } = useLanguage();
  const [familyCode, setFamilyCode] = useState("");
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("sent")
      ? t("authCodeSentNotice")
      : null;
  });

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
        if (status.status === "verified") {
          setNotice(t("authCodeVerifiedNotice"));
          return;
        }
        if (status.status === "expired") {
          setError(t("error_family_code_expired"));
          return;
        }
        setNotice(t("authCodeSentNotice"));
      } catch (err) {
        setError(humanizeError(err, language));
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [language, router, t]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!familyCode.trim()) {
      setError(t("authFamilyCodeRequired"));
      return;
    }
    setLoading(true);
    try {
      await verifyFamilyCode(familyCode);
      toast.success(t("authCodeVerifySuccess"));
      router.replace("/create-family");
    } catch (err) {
      setError(humanizeError(err, language));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError(null);
    setLoading(true);
    try {
      await ensureFamilyCode(true);
      setNotice(t("authCodeResent"));
    } catch (err) {
      setError(humanizeError(err, language));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-page-narrow">
      <header className="app-header-stack">
        <Link href="/" className="back-link">
          {t("authBackHome")}
        </Link>
        <h1 className="page-title">{t("authVerifyTitle")}</h1>
        <p className="page-subtitle">
          {t("authVerifySubtitle")}
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="section-card flex flex-col gap-4">
        {checking ? (
          <div className="text-sm text-slate-500">{t("authCheckingAccount")}</div>
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
            disabled={loading}
            autoComplete="one-time-code"
          />
        </div>

        {notice ? <div className="info-note">{notice}</div> : null}
        {error ? (
          <div className="error-note">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={loading || checking}>
          {loading ? t("authVerifyBusy") : t("authVerifyButton")}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={loading || checking}
          onClick={handleResend}
        >
          {t("authResendButton")}
        </button>
      </form>
    </div>
  );
}
