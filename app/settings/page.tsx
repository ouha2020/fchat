"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { clearSession, loadSession, saveSession, updateSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import {
  fetchFamilyPublic,
  leaveFamily,
  resetFamilyCode,
  setJoinEnabled,
  updateFamilyName,
} from "@/lib/familyService";
import { LANGUAGE_OPTIONS } from "@/lib/i18n";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

export default function SettingsPage() {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [joinOn, setJoinOn] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const local = loadSession();
    if (!local) {
      router.replace("/");
      return;
    }
    setSession(local);
    fetchFamilyPublic(local.family_id)
      .then((row) => {
        if (row) {
          setJoinOn(row.join_enabled);
          if (row.name !== local.family_name || row.family_code !== local.family_code) {
            const next = updateSession({
              family_name: row.name,
              family_code: row.family_code,
            });
            if (next) setSession(next);
          }
        }
      })
      .catch(() => undefined);
  }, [router]);

  async function withAdmin(action: string, fn: (password: string) => Promise<void>) {
    if (!session?.is_admin) {
      alert(t("settingsAdminOnly"));
      return;
    }
    const password = window.prompt(t("settingsAdminPasswordPrompt", { action }));
    if (!password) return;
    setBusy(action);
    try {
      await fn(password);
    } catch (err) {
      alert(humanizeError(err, language));
    } finally {
      setBusy(null);
    }
  }

  async function handleRename() {
    if (!session) return;
    const newName = window.prompt(t("settingsRenamePrompt"), session.family_name);
    if (!newName || !newName.trim()) return;
    await withAdmin(t("settingsRenameFamily"), async (password) => {
      await updateFamilyName(session, password, newName.trim());
      const next = updateSession({ family_name: newName.trim() });
      if (next) setSession(next);
    });
  }

  async function handleResetCode() {
    if (!session) return;
    const ok = window.confirm(t("settingsResetCodeConfirm"));
    if (!ok) return;
    await withAdmin(t("settingsResetCode"), async (password) => {
      const newCode = await resetFamilyCode(session, password);
      const next = updateSession({ family_code: newCode });
      if (next) setSession(next);
    });
  }

  async function handleToggleJoin(next: boolean) {
    if (!session) return;
    await withAdmin(next ? t("settingsEnableJoin") : t("settingsDisableJoin"), async (password) => {
      await setJoinEnabled(session, password, next);
      setJoinOn(next);
    });
  }

  async function handleLeave() {
    if (!session) return;
    const ok = window.confirm(t("settingsLeaveConfirm"));
    if (!ok) return;
    setBusy("leave");
    try {
      await leaveFamily(session);
      clearSession();
      router.replace("/");
    } catch (err) {
      alert(humanizeError(err, language));
    } finally {
      setBusy(null);
    }
  }

  function handleSwitch() {
    const ok = window.confirm(t("settingsSwitchConfirm"));
    if (!ok) return;
    clearSession();
    router.replace("/");
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col px-5 py-6 sm:px-8">
      <header className="mb-4">
        <Link href="/chat" className="text-sm text-brand-600 hover:underline">
          {t("commonBackToChat")}
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{t("settingsTitle")}</h1>
      </header>

      <section className="card flex flex-col gap-3">
        <Row label={t("settingsFamilyName")} value={session.family_name} />
        <Row
          label={t("settingsFamilyCode")}
          value={
            <span className="select-all font-mono text-base tracking-widest">
              {session.family_code}
            </span>
          }
        />
        <Row label={t("settingsMyNickname")} value={session.nickname} />
        <Row label={t("settingsMyRole")} value={
          { father: t("roleFather"), mother: t("roleMother"), child: t("roleChild") }[session.role]
        } />
        <Row label={t("settingsIsAdmin")} value={session.is_admin ? t("commonYes") : t("commonNo")} />
      </section>

      <section className="card mt-4 flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("settingsLanguage")}</h2>
        <div className="grid grid-cols-3 gap-2">
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                language === opt.value
                  ? "bg-brand-500 text-white"
                  : "bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
              }`}
              onClick={() => setLanguage(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {session.is_admin ? (
        <section className="card mt-4 flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t("settingsAdminActions")}</h2>
          <button
            type="button"
            className="btn-secondary"
            disabled={!!busy}
            onClick={handleRename}
          >
            {t("settingsRenameFamily")}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!!busy}
            onClick={handleResetCode}
          >
            {t("settingsResetCode")}
          </button>
          <label className="flex items-center justify-between rounded-xl px-1 py-2">
            <span className="text-sm text-slate-700">{t("settingsAllowJoin")}</span>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={joinOn}
              disabled={!!busy}
              onChange={(e) => handleToggleJoin(e.target.checked)}
            />
          </label>
        </section>
      ) : null}

      <section className="card mt-4 flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("settingsSession")}</h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={handleSwitch}
          disabled={!!busy}
        >
          {t("settingsSwitchFamily")}
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={handleLeave}
          disabled={busy === "leave"}
        >
          {busy === "leave" ? t("settingsLeaving") : t("settingsLeaveFamily")}
        </button>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value}</span>
    </div>
  );
}
