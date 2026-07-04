"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useLanguage } from "@/components/LanguageProvider";
import { updateAccountPassword } from "@/lib/accountClient";
import { humanizeError } from "@/lib/errors";
import { getSupabaseAuth } from "@/lib/supabaseAuthClient";

// The recovery link lands here with the token in the URL hash; creating the
// auth client parses it (detectSessionInUrl) and getSession waits for that.
type LinkState = "checking" | "ready" | "invalid";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    try {
      getSupabaseAuth()
        .auth.getSession()
        .then(({ data }) => {
          if (!cancelled) setLinkState(data.session ? "ready" : "invalid");
        })
        .catch(() => {
          if (!cancelled) setLinkState("invalid");
        });
    } catch {
      setLinkState("invalid");
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError(t("error_password_too_short"));
    if (password !== confirmPassword) return setError(t("authPasswordMismatch"));
    setLoading(true);
    try {
      await updateAccountPassword(password);
      router.replace("/login?reset=1");
    } catch (err) {
      setError(
        err instanceof Error ? humanizeError(err, language) : t("authUpdateFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-page-narrow">
      <header className="app-header-stack">
        <Link href="/login" className="back-link">
          {t("authBackLogin")}
        </Link>
        <h1 className="page-title">{t("authResetTitle")}</h1>
        <p className="page-subtitle">
          {t("authResetSubtitle")}
        </p>
      </header>

      <EnvWarning />

      {linkState === "invalid" ? (
        <div className="section-card">
          <h2 className="text-base font-semibold text-slate-900">
            {t("authLinkInvalidTitle")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {t("authLinkInvalidBody")}
          </p>
          <Link href="/login" className="btn-primary mt-4">
            {t("authBackLogin")}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="section-card flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="password">
              {t("authNewPasswordLabel")}
            </label>
            <input
              id="password"
              className="field"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || linkState === "checking"}
            />
          </div>
          <div>
            <label className="label" htmlFor="confirm-password">
              {t("authConfirmNewPasswordLabel")}
            </label>
            <input
              id="confirm-password"
              className="field"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading || linkState === "checking"}
            />
          </div>
          {error ? (
            <div className="error-note">
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            className="btn-primary"
            disabled={loading || linkState === "checking"}
          >
            {loading
              ? t("authUpdatePasswordBusy")
              : linkState === "checking"
                ? t("authCheckingLink")
                : t("authUpdatePasswordButton")}
          </button>
        </form>
      )}
    </div>
  );
}
