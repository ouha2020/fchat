"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { clearSession, loadSession, saveSession, updateSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import {
  fetchFamilySettings,
  leaveFamily,
  resetFamilyCode,
  setJoinEnabled,
  updateFamilyName,
  validateMember,
} from "@/lib/familyService";
import { LANGUAGE_OPTIONS } from "@/lib/i18n";
import {
  fetchPushDiagnostics,
  pushNotificationErrorMessage,
  type PushDiagnostics,
  type ServerSubscriptionInfo,
} from "@/lib/pushNotificationService";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { usePushNotificationControls } from "@/lib/usePushNotificationControls";

export default function SettingsPage() {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [joinOn, setJoinOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const push = usePushNotificationControls(session);
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  async function loadDiagnostics() {
    if (!session) return;
    setDiagLoading(true);
    try {
      setDiagnostics(await fetchPushDiagnostics(session));
    } catch {
      // ignore
    } finally {
      setDiagLoading(false);
    }
  }

  async function handleTestNotification() {
    if (!session) return;
    setBusy("test");
    try {
      let shown = false;
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration("/");
        if (reg?.showNotification) {
          await reg.showNotification(t("settingsPushTitle"), {
            body: t("settingsPushDiagnosticsTestSuccess"),
            icon: "/icon.png",
            badge: "/icon.png",
            tag: "family-chat-test",
          });
          shown = true;
        }
      }
      if (!shown) {
        // eslint-disable-next-line no-new
        new Notification(t("settingsPushTitle"), {
          body: t("settingsPushDiagnosticsTestSuccess"),
          icon: "/icon.png",
          tag: "family-chat-test",
        });
      }
      alert(t("settingsPushDiagnosticsTestSuccess"));
    } catch {
      alert(t("settingsPushDiagnosticsTestFailed"));
    } finally {
      setBusy(null);
    }
  }

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
        const row = await fetchFamilySettings(fresh);
        if (cancelled) return;
        if (row) {
          setJoinOn(row.join_enabled);
          const active = loadSession();
          if (active && (row.name !== active.family_name || row.family_code !== active.family_code)) {
            const next = updateSession({
              family_name: row.name,
              family_code: row.family_code,
            });
            if (next) setSession(next);
          }
        }
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

  useEffect(() => {
    if (session && push.support?.supported) {
      void loadDiagnostics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, push.enabled, push.support?.supported]);

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

  async function handleEnablePush() {
    if (!session) return;
    setBusy("push");
    try {
      await push.enable();
      alert(t("settingsPushEnabledAlert"));
    } catch (err) {
      alert(pushNotificationErrorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function handleDisablePush() {
    if (!session) return;
    setBusy("push");
    try {
      await push.disable();
      alert(t("settingsPushDisabledAlert"));
    } catch {
      alert(t("settingsPushDisableFailed"));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col px-5 py-6 sm:px-8">
        <div className="text-sm text-slate-500">{t("commonLoading")}</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col px-5 py-6 sm:px-8">
        <div className="card text-center">
          <h1 className="text-lg font-bold text-slate-900">
            {t("chatLoadFailedTitle")}
          </h1>
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
      </div>
    );
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

      <section className="card mt-4 flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("settingsPushTitle")}</h2>
        <p className="text-sm leading-6 text-slate-500">
          {t("settingsPushDescription")}
        </p>

        {!push.support ? (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
            {t("commonLoading")}
          </p>
        ) : push.support.reason === "ios_not_standalone" ? (
          <div className="rounded-xl bg-brand-50 p-3 text-sm leading-6 text-slate-700">
            <p className="font-medium text-slate-900">
              {t("settingsPushIosGuideTitle")}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>{t("settingsPushIosGuide1")}</li>
              <li>{t("settingsPushIosGuide2")}</li>
              <li>{t("settingsPushIosGuide3")}</li>
              <li>{t("settingsPushIosGuide4")}</li>
              <li>{t("settingsPushIosGuide5")}</li>
            </ol>
          </div>
        ) : push.support.supported ? (
          <>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={!!busy || push.busy || push.enabled}
                onClick={handleEnablePush}
              >
                {t("settingsPushEnable")}
              </button>
              <button
                type="button"
                className="btn-secondary flex-1"
                disabled={!!busy || push.busy || !push.enabled}
                onClick={handleDisablePush}
              >
                {t("settingsPushDisable")}
              </button>
            </div>
            {push.support.permission === "denied" ? (
              <p className="text-sm text-rose-600">{t("settingsPushDenied")}</p>
            ) : null}
            <div className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-700">
                  {t("settingsPushNewMessages")}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    push.enabled
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {push.enabled ? t("commonYes") : t("commonNo")}
                </span>
              </div>
              <p className="mt-2 text-slate-500">
                {t("settingsPushPrivacyNote")}
              </p>
            </div>
          </>
        ) : (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
            {push.support.reason === "missing_vapid_key"
              ? t("settingsPushMissingConfig")
              : t("settingsPushUnsupported")}
          </p>
        )}
      </section>

      {push.support?.supported && diagnostics ? (
        <section className="card mt-4 flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t("settingsPushDiagnostics")}</h2>

          <DiagRow
            label={t("settingsPushDiagnosticsPermission")}
            value={
              diagnostics.permission === "granted"
                ? t("settingsPushDiagnosticsPermissionGranted")
                : diagnostics.permission === "denied"
                  ? t("settingsPushDiagnosticsPermissionDenied")
                  : t("settingsPushDiagnosticsPermissionDefault")
            }
            ok={diagnostics.permission === "granted"}
          />
          <DiagRow
            label={t("settingsPushDiagnosticsSW")}
            value={
              diagnostics.swRegistered
                ? t("settingsPushDiagnosticsSWRegistered")
                : t("settingsPushDiagnosticsSWNotRegistered")
            }
            ok={diagnostics.swRegistered}
          />
          <DiagRow
            label={t("settingsPushDiagnosticsSubscription")}
            value={
              diagnostics.subscriptionExists
                ? t("settingsPushDiagnosticsSubscriptionActive")
                : t("settingsPushDiagnosticsSubscriptionNone")
            }
            ok={diagnostics.subscriptionExists}
          />
          <DiagRow
            label={t("settingsPushDiagnosticsEndpoint")}
            value={
              diagnostics.serverSubscriptions.some(
                (s) => s.endpoint === diagnostics.subscriptionEndpoint,
              )
                ? t("settingsPushDiagnosticsEndpointSaved")
                : diagnostics.subscriptionEndpoint
                  ? t("settingsPushDiagnosticsEndpointNotSaved")
                  : "—"
            }
            ok={diagnostics.serverSubscriptions.some(
              (s) => s.endpoint === diagnostics.subscriptionEndpoint,
            )}
          />
          <DiagRow
            label={t("settingsPushDiagnosticsPlatform")}
            value={diagnostics.platform}
            ok={true}
          />
          <DiagRow
            label={t("settingsPushDiagnosticsLastNotified")}
            value={
              diagnostics.serverSubscriptions[0]?.last_notified_at
                ? new Date(
                    diagnostics.serverSubscriptions[0].last_notified_at,
                  ).toLocaleString()
                : t("settingsPushDiagnosticsNever")
            }
            ok={true}
          />
          {diagnostics.presence ? (
            <DiagRow
              label={t("settingsPushDiagnosticsPresence")}
              value={
                diagnostics.presence.is_active
                  ? t("commonYes")
                  : t("commonNo")
              }
              ok={diagnostics.presence.is_active}
            />
          ) : null}

          <button
            type="button"
            className="btn-secondary mt-1"
            disabled={!!busy || diagLoading}
            onClick={handleTestNotification}
          >
            {busy === "test"
              ? t("commonLoading")
              : t("settingsPushDiagnosticsTestButton")}
          </button>

          {diagnostics.platform === "android" ? (
            <div className="rounded-xl bg-brand-50 p-3 text-sm leading-6 text-slate-700">
              <p className="font-medium text-slate-900">
                {t("settingsPushDiagnosticsAndroidTip")}
              </p>
              <p className="mt-1 text-slate-600">
                {t("settingsPushDiagnosticsAndroidTipText")}
              </p>
            </div>
          ) : null}

          <button
            type="button"
            className="text-sm text-brand-600 hover:underline self-start"
            onClick={loadDiagnostics}
            disabled={diagLoading}
          >
            {diagLoading ? t("commonLoading") : "↻ " + t("chatRetry")}
          </button>
        </section>
      ) : null}

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

function DiagRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span
        className={`text-sm font-medium ${
          ok ? "text-emerald-700" : "text-rose-600"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
