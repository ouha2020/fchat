"use client";

import Link from "next/link";
import { useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useLanguage } from "@/components/LanguageProvider";
import { resetPasswordEmail } from "@/lib/accountClient";
import { humanizeError } from "@/lib/errors";

export default function ForgotPasswordPage() {
  const { language, t } = useLanguage();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setError(t("error_email_required"));
    setLoading(true);
    try {
      await resetPasswordEmail(cleanEmail);
      setMessage(t("authResetEmailSent"));
    } catch (err) {
      setError(
        err instanceof Error ? humanizeError(err, language) : t("authSendFailed"),
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
        <h1 className="page-title">{t("authForgotTitle")}</h1>
        <p className="page-subtitle">
          {t("authForgotSubtitle")}
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
        {message ? (
          <div className="success-note">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="error-note">
            {error}
          </div>
        ) : null}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? t("authSendResetBusy") : t("authSendResetButton")}
        </button>
      </form>
    </div>
  );
}
