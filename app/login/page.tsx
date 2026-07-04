"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useLanguage } from "@/components/LanguageProvider";
import { useToast } from "@/components/Toast";
import {
  ensureFamilyCode,
  rejoinFamilyMemberWithAccount,
  signInAccount,
} from "@/lib/accountClient";
import { saveSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import {
  clearPendingOwnerRejoin,
  loadPendingOwnerRejoin,
} from "@/lib/ownerRejoinPending";

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const { language, t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setError(t("error_email_required"));
    if (!password) return setError(t("error_password_required"));
    setLoading(true);
    try {
      await signInAccount(cleanEmail, password);
      const next = new URLSearchParams(window.location.search).get("next");
      if (next === "owner-rejoin") {
        const pending = loadPendingOwnerRejoin();
        if (pending) {
          const session = await rejoinFamilyMemberWithAccount(
            pending.familyCode,
            pending.nickname,
          );
          clearPendingOwnerRejoin();
          saveSession(session);
          toast.info(t("authRejoinRestored", { nickname: pending.nickname }));
          router.replace("/chat");
          return;
        }
      }
      const result = await ensureFamilyCode(false);
      if (result.status === "has_family" && result.session) {
        saveSession(result.session);
        toast.info(t("error_account_already_has_family"));
        router.replace("/chat");
        return;
      }
      if (result.status === "verified") {
        router.replace("/create-family");
        return;
      }
      router.replace(`/verify-family-code?status=${result.status}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? humanizeError(err, language)
          : t("authLoginFailed"),
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
        <h1 className="page-title">{t("authLoginTitle")}</h1>
        <p className="page-subtitle">
          {t("authLoginSubtitle")}
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        {error ? (
          <div className="error-note">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? t("authLoginBusy") : t("authLoginButton")}
        </button>
      </form>

      <div className="mt-6 flex justify-center gap-4 text-sm">
        <Link className="text-brand-600 hover:underline" href="/register">
          {t("authRegisterLink")}
        </Link>
        <Link className="text-slate-500 hover:text-brand-600" href="/forgot-password">
          {t("authForgotLink")}
        </Link>
      </div>
    </div>
  );
}
