"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { useDialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";
import {
  getOwnerAccountStatus,
  resetFamilyCodeWithAccount,
  setJoinEnabledWithAccount,
  updateAccountPassword,
  updateFamilyNameWithAccount,
} from "@/lib/accountClient";
import { clearSession, loadSession, saveSession, updateSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import {
  fetchFamilySettings,
  leaveFamily,
  validateMember,
} from "@/lib/familyService";
import { LANGUAGE_OPTIONS } from "@/lib/i18n";
import {
  fetchPushDiagnostics,
  pushNotificationErrorMessage,
  type PushDiagnostics,
} from "@/lib/pushNotificationService";
import { getScheduleReminderHealth } from "@/lib/scheduleService";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { getSupabaseAuth } from "@/lib/supabaseAuthClient";
import { usePushNotificationControls } from "@/lib/usePushNotificationControls";
import type { ScheduleReminderHealth } from "@/types/schedule";

export default function SettingsPage() {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const dialog = useDialog();
  const toast = useToast();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [joinOn, setJoinOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [isOwnerAccount, setIsOwnerAccount] = useState(false);
  const [showFamilyCode, setShowFamilyCode] = useState(false);
  const push = usePushNotificationControls(session);
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [reminderHealth, setReminderHealth] =
    useState<ScheduleReminderHealth | null>(null);
  const [reminderHealthLoading, setReminderHealthLoading] = useState(false);

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
      toast.success(t("settingsPushDiagnosticsTestSuccess"));
    } catch {
      toast.error(t("settingsPushDiagnosticsTestFailed"));
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
        setIsOwnerAccount(await getOwnerAccountStatus(fresh));
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

  async function withOwnerAccount(action: string, fn: () => Promise<void>) {
    if (!session?.is_admin) {
      toast.info(t("settingsAdminOnly"));
      return;
    }
    const { data } = await getSupabaseAuth().auth.getSession();
    if (!data.session) {
      toast.info("请先用创建家庭的邮箱账号登录");
      router.push("/login");
      return;
    }
    setBusy(action);
    try {
      await fn();
    } catch (err) {
      toast.error(humanizeError(err, language));
    } finally {
      setBusy(null);
    }
  }

  async function loadReminderHealth() {
    if (!session?.is_admin) return;
    setReminderHealthLoading(true);
    try {
      setReminderHealth(await getScheduleReminderHealth(session));
    } catch (err) {
      toast.error(humanizeError(err, language));
    } finally {
      setReminderHealthLoading(false);
    }
  }

  async function handleChangeAccountPassword() {
    if (!session?.is_admin) {
      toast.info(t("settingsAdminOnly"));
      return;
    }
    const { data } = await getSupabaseAuth().auth.getSession();
    if (!data.session) {
      toast.info("请先用创建家庭的邮箱账号登录");
      router.push("/login");
      return;
    }
    const result = await dialog.accountPassword();
    if (!result) return;

    setBusy("changeAccountPassword");
    try {
      await updateAccountPassword(result.newPassword);
      toast.success("密码已修改，请重新登录");
      await getSupabaseAuth().auth.signOut();
      setIsOwnerAccount(false);
      router.replace("/login?reset=1");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : humanizeError(err, language));
    } finally {
      setBusy(null);
    }
  }

  async function handleRename() {
    if (!session) return;
    const newName = await dialog.prompt({
      title: t("settingsRenameFamily"),
      message: t("settingsRenamePrompt"),
      defaultValue: session.family_name,
      validate: (v) => (!v.trim() ? "名称不能为空" : null),
    });
    if (!newName || !newName.trim()) return;
    await withOwnerAccount(t("settingsRenameFamily"), async () => {
      await updateFamilyNameWithAccount(session, newName.trim());
      const next = updateSession({ family_name: newName.trim() });
      if (next) setSession(next);
    });
  }

  async function handleResetCode() {
    if (!session) return;
    const ok = await dialog.confirm({
      title: t("settingsResetCode"),
      message: t("settingsResetCodeConfirm"),
      danger: true,
    });
    if (!ok) return;
    await withOwnerAccount(t("settingsResetCode"), async () => {
      const newCode = await resetFamilyCodeWithAccount(session);
      const next = updateSession({ family_code: newCode });
      if (next) setSession(next);
    });
  }

  function handleCopyFamilyCode() {
    if (!session) return;
    navigator.clipboard?.writeText(session.family_code).catch(() => undefined);
    toast.success("家庭代码已复制");
  }

  function handleCopyInviteText() {
    if (!session) return;
    const text = `加入「${session.family_name}」家庭聊天室，家庭代码：${session.family_code}`;
    navigator.clipboard?.writeText(text).catch(() => undefined);
    toast.success("邀请文案已复制");
  }

  async function handleToggleJoin(next: boolean) {
    if (!session) return;
    await withOwnerAccount(next ? t("settingsEnableJoin") : t("settingsDisableJoin"), async () => {
      await setJoinEnabledWithAccount(session, next);
      setJoinOn(next);
    });
  }

  async function handleLeave() {
    if (!session) return;
    const ok = await dialog.confirm({
      title: t("settingsLeaveFamily"),
      message: t("settingsLeaveConfirm"),
      danger: true,
    });
    if (!ok) return;
    setBusy("leave");
    try {
      await leaveFamily(session);
      clearSession();
      await getSupabaseAuth().auth.signOut();
      setIsOwnerAccount(false);
      router.replace("/");
    } catch (err) {
      toast.error(humanizeError(err, language));
    } finally {
      setBusy(null);
    }
  }

  async function handleSwitch() {
    const ok = await dialog.confirm({
      title: t("settingsSwitchFamily"),
      message: t("settingsSwitchConfirm"),
    });
    if (!ok) return;
    clearSession();
    await getSupabaseAuth().auth.signOut();
    setIsOwnerAccount(false);
    router.replace("/");
  }

  async function handleEnablePush() {
    if (!session) return;
    setBusy("push");
    try {
      await push.enable();
      toast.success(t("settingsPushEnabledAlert"));
    } catch (err) {
      toast.error(pushNotificationErrorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function handleDisablePush() {
    if (!session) return;
    setBusy("push");
    try {
      await push.disable();
      toast.success(t("settingsPushDisabledAlert"));
    } catch {
      toast.error(t("settingsPushDisableFailed"));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="app-page">
        <div className="status-note">{t("commonLoading")}</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app-page">
        <div className="section-card text-center">
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
              className="btn-secondary"
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
  const canManageFamily = session.is_admin;

  return (
    <div className="app-page">
      <header className="app-header-stack">
        <Link href="/chat" className="back-link">
          {t("commonBackToChat")}
        </Link>
        <h1 className="page-title">{t("settingsTitle")}</h1>
      </header>

      <section className="section-card flex flex-col gap-3">
        <Row label={t("settingsFamilyName")} value={session.family_name} />
        {canManageFamily ? (
          <Row
            label={t("settingsFamilyCode")}
            value={
              <span className="inline-flex items-center justify-end gap-2">
                <span className="select-all font-mono text-base tracking-widest">
                  {showFamilyCode ? session.family_code : maskFamilyCode(session.family_code)}
                </span>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                  aria-label={
                    showFamilyCode
                      ? t("settingsHideFamilyCode")
                      : t("settingsShowFamilyCode")
                  }
                  title={
                    showFamilyCode
                      ? t("settingsHideFamilyCode")
                      : t("settingsShowFamilyCode")
                  }
                  aria-pressed={showFamilyCode}
                  onClick={() => setShowFamilyCode((visible) => !visible)}
                >
                  {showFamilyCode ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </span>
            }
          />
        ) : null}
        <Row label={t("settingsMyNickname")} value={session.nickname} />
        <Row label={t("settingsMyRole")} value={
          { father: t("roleFather"), mother: t("roleMother"), child: t("roleChild") }[session.role]
        } />
        <Row label={t("settingsIsAdmin")} value={session.is_admin ? t("commonYes") : t("commonNo")} />
        {canManageFamily ? (
          <div className="grid grid-cols-2 gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={handleCopyFamilyCode}>
              复制家庭代码
            </button>
            <button type="button" className="btn-secondary" onClick={handleCopyInviteText}>
              复制邀请文案
            </button>
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-500">
            当前身份保存在此浏览器中。如果更换手机或清除浏览器数据，可能需要重新输入家庭代码加入。
          </p>
        )}
        <Link href="/me" className="btn-secondary text-center">
          {t("meTitle")}
        </Link>
      </section>

      <section className="section-card mt-4 flex flex-col gap-3">
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

      <section className="section-card mt-4 flex flex-col gap-3">
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
        <section className="section-card mt-4 flex flex-col gap-3">
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
              isCurrentEndpointSaved(diagnostics)
                ? t("settingsPushDiagnosticsEndpointSaved")
                : diagnostics.subscriptionEndpointFingerprint
                  ? t("settingsPushDiagnosticsEndpointNotSaved")
                  : "-"
            }
            ok={isCurrentEndpointSaved(diagnostics)}
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

      {canManageFamily ? (
        <section className="section-card mt-4 flex flex-col gap-3">
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
          <button
            type="button"
            className="btn-secondary"
            disabled={!!busy}
            onClick={handleChangeAccountPassword}
          >
            {busy === "changeAccountPassword" ? t("commonLoading") : "修改密码"}
          </button>
          <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm leading-6 text-sky-700">
            管理操作使用创建者邮箱账号验证，不再单独使用管理员密码。
          </p>
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
          <div className="mt-2 rounded-2xl bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {t("scheduleReminderHealthTitle")}
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {t("scheduleReminderHealthDescription")}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary shrink-0 px-3 py-2 text-sm"
                disabled={reminderHealthLoading}
                onClick={loadReminderHealth}
              >
                {reminderHealthLoading ? t("commonLoading") : t("chatRetry")}
              </button>
            </div>
            {reminderHealth ? (
              <ReminderHealthPanel health={reminderHealth} t={t} />
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="section-card mt-4 flex flex-col gap-3">
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

function ReminderHealthPanel({
  health,
  t,
}: {
  health: ScheduleReminderHealth;
  t: ReturnType<typeof useLanguage>["t"];
}) {
  const rows = [
    [t("scheduleReminderStatusPending"), health.pending],
    [t("scheduleReminderStatusSent"), health.sent],
    [t("scheduleReminderStatusFailed"), health.failed],
    [t("scheduleReminderStatusGone"), health.gone],
    [t("scheduleReminderStatusSkipped"), health.skipped],
  ] as const;

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white p-2 text-center ring-1 ring-slate-100">
            <div className="text-lg font-bold text-slate-900">{value}</div>
            <div className="mt-0.5 text-xs text-slate-500">{label}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-white p-3 text-sm ring-1 ring-slate-100">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-800">
            {t("scheduleReminderPrivateFailureCount")}
          </span>
          <span className="text-slate-600">{health.private_failed}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {t("scheduleReminderHealthPrivacyNote")}
        </p>
      </div>
      {health.recentFailures.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-900">
            {t("scheduleReminderRecentFailures")}
          </h4>
          {health.recentFailures.slice(0, 5).map((failure) => (
            <div
              key={failure.deliveryId}
              className="rounded-xl bg-white p-3 text-xs text-slate-600 ring-1 ring-slate-100"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono">{failure.deliveryId.slice(0, 8)}</span>
                <span>{failure.status}</span>
              </div>
              <div className="mt-1">
                {t("scheduleReminderAttemptCount")}: {failure.attemptCount}
              </div>
              {failure.nextRetryAt ? (
                <div className="mt-1">
                  {t("scheduleReminderNextRetryAt")}:{" "}
                  {new Date(failure.nextRetryAt).toLocaleString()}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-white p-3 text-sm text-slate-500 ring-1 ring-slate-100">
          {t("scheduleReminderNoRecentFailures")}
        </p>
      )}
    </div>
  );
}

function maskFamilyCode(code: string): string {
  return "•".repeat(Math.max(code.length, 6));
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6" />
      <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18.6 18.6 0 0 1-3.1 4.2" />
      <path d="M6.6 6.6C3.6 8.7 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.1-.8" />
    </svg>
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

function isCurrentEndpointSaved(diagnostics: PushDiagnostics): boolean {
  return Boolean(
    diagnostics.subscriptionEndpointFingerprint &&
      diagnostics.serverSubscriptions.some(
        (sub) => sub.endpointFingerprint === diagnostics.subscriptionEndpointFingerprint,
      ),
  );
}
