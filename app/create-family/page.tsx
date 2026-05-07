"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useLanguage } from "@/components/LanguageProvider";
import RoleSelect from "@/components/RoleSelect";
import { saveSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import { createFamily } from "@/lib/familyService";
import type { FamilyRole } from "@/types/family";

export default function CreateFamilyPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [familyName, setFamilyName] = useState("");
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<FamilyRole | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<LocalSession | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!familyName.trim() || !nickname.trim() || !role || !adminPassword) {
      setError(t("createMissingFields"));
      return;
    }
    if (adminPassword.length < 4) {
      setError(t("createPasswordShort"));
      return;
    }
    setLoading(true);
    try {
      const session = await createFamily({
        familyName: familyName.trim(),
        nickname: nickname.trim(),
        role,
        adminPassword,
      });
      saveSession(session);
      setCreated(session);
    } catch (err) {
      setError(humanizeError(err, language));
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <div className="flex flex-1 flex-col px-5 py-8 sm:px-8">
        <h1 className="text-2xl font-bold text-slate-900">{t("createSuccessTitle")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("createSuccessSubtitle")}
        </p>

        <div className="card mt-6 text-center">
          <div className="text-sm text-slate-500">{t("createFamilyCode")}</div>
          <div className="mt-2 select-all text-4xl font-bold tracking-[0.4em] text-brand-600">
            {created.family_code}
          </div>
          <div className="mt-2 text-sm text-slate-600">
            {t("createFamilyNameLine", { name: created.family_name })}
          </div>
        </div>

        <button
          type="button"
          className="btn-primary mt-6"
          onClick={() => router.replace("/chat")}
        >
          {t("createEnterChat")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-8 sm:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{t("createTitle")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("createSubtitle")}
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="card flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="family-name">
            {t("createFamilyName")}
          </label>
          <input
            id="family-name"
            className="field"
            placeholder={t("createFamilyNamePlaceholder")}
            maxLength={30}
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="nickname">
            {t("homeNickname")}
          </label>
          <input
            id="nickname"
            className="field"
            placeholder={t("createNicknamePlaceholder")}
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <div>
          <span className="label">{t("createRole")}</span>
          <RoleSelect value={role} onChange={setRole} />
        </div>

        <div>
          <label className="label" htmlFor="admin-password">
            {t("createAdminPassword")}
          </label>
          <input
            id="admin-password"
            type="password"
            className="field"
            placeholder={t("createAdminPasswordPlaceholder")}
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        {error ? (
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn-primary mt-1" disabled={loading}>
          {loading ? t("createSubmitting") : t("createSubmit")}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        {t("createHaveCode")}
        <Link className="ml-1 text-brand-600 hover:underline" href="/">
          {t("createBackJoin")}
        </Link>
      </div>
    </div>
  );
}
