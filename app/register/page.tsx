"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useLanguage } from "@/components/LanguageProvider";
import { registerAccount, signInAccount } from "@/lib/accountClient";
import { humanizeError } from "@/lib/errors";

export default function RegisterPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRegisteredEmail(false);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setError(t("error_email_required"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return setError(t("error_invalid_email"));
    }
    if (!password) return setError(t("error_password_required"));
    if (password.length < 8) return setError(t("error_password_too_short"));
    if (password !== confirmPassword) return setError(t("authPasswordMismatch"));

    setLoading(true);
    try {
      await registerAccount(cleanEmail, password);
      await signInAccount(cleanEmail, password);
      router.replace("/verify-family-code?sent=1");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "email_registered") setRegisteredEmail(true);
      setError(
        err instanceof Error
          ? humanizeError(err, language)
          : t("authRegisterFailed"),
      );
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
        <h1 className="page-title">{t("authRegisterTitle")}</h1>
        <p className="page-subtitle">
          {t("authRegisterSubtitle")}
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="section-card flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="email">{t("authEmailLabel")}</label>
          <input
            id="email"
            className="field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">{t("authPasswordLabel")}</label>
          <input
            id="password"
            className="field"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm-password">
            {t("authConfirmPasswordLabel")}
          </label>
          <input
            id="confirm-password"
            className="field"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        {error ? (
          <div className="error-note">
            {error}
          </div>
        ) : null}

        {registeredEmail ? (
          <div className="grid grid-cols-2 gap-3">
            <Link className="btn-primary" href="/login">{t("authGoLogin")}</Link>
            <Link className="btn-secondary" href="/forgot-password">
              {t("authForgotLink")}
            </Link>
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? t("authRegisterBusy") : t("authRegisterButton")}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        {t("authHaveAccount")}
        <Link className="ml-1 text-brand-600 hover:underline" href="/login">
          {t("authLoginDirect")}
        </Link>
      </div>
    </div>
  );
}
