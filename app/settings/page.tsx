"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { useDialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";
import {
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
      <main className="min-h-dvh bg-[#fbfff7] px-4 py-6 text-slate-900">
        <div className="mx-auto w-full max-w-2xl rounded-[22px] bg-white/95 px-4 py-3 text-sm leading-6 text-[#526452] shadow-[0_14px_36px_rgba(79,168,95,0.10)] ring-1 ring-[#dff3d8]">
          {t("commonLoading")}
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="min-h-dvh bg-[#fbfff7] px-4 py-6 text-slate-900">
        <div className="mx-auto w-full max-w-2xl rounded-[26px] bg-white/95 p-5 text-center shadow-[0_18px_50px_rgba(79,168,95,0.12)] ring-1 ring-[#dff3d8]">
          <h1 className="text-lg font-bold text-slate-900">
            {t("chatLoadFailedTitle")}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#526452]">
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
      </main>
    );
  }

  if (!session) return null;
  const canManageFamily = session.is_admin;

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#fbfff7] text-slate-900">
      <div
        className="mx-auto w-full max-w-2xl px-4 pb-8 sm:px-6"
        style={{
          paddingTop: "max(env(safe-area-inset-top), 14px)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 28px)",
        }}
      >
        <header className="mb-5 flex items-center justify-between gap-3">
          <Link
            href="/chat"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/95 px-3 text-sm font-semibold text-[#2f7d42] shadow-[0_10px_28px_rgba(79,168,95,0.12)] ring-1 ring-[#dff3d8] backdrop-blur-xl transition hover:bg-white active:translate-y-px active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72c982]"
          >
            <span>{t("commonBackToChat")}</span>
          </Link>
          <span className="min-w-0 truncate rounded-full bg-[#ddf8d7] px-3 py-1.5 text-xs font-semibold text-[#2f7d42] shadow-[0_6px_18px_rgba(79,168,95,0.10)]">
            {session.family_name}
          </span>
        </header>

        <section className="mb-5 rounded-[28px] bg-gradient-to-br from-white via-[#fbfff7] to-[#eaf9e2] p-4 shadow-[0_18px_50px_rgba(79,168,95,0.14)] ring-1 ring-[#dff3d8] backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#4fa85f] text-lg font-black text-white shadow-[0_10px_24px_rgba(79,168,95,0.28)]">
              家
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[26px] font-bold leading-tight tracking-normal text-slate-950">
                {t("settingsTitle")}
              </h1>
              <p className="mt-1 truncate text-sm text-[#526452]">
                {session.nickname} ·{" "}
                {
                  {
                    father: t("roleFather"),
                    mother: t("roleMother"),
                    child: t("roleChild"),
                  }[session.role]
                }
              </p>
            </div>
            <StatusBadge ok={session.is_admin}>
              {session.is_admin ? t("commonAdmin") : t("commonMe")}
            </StatusBadge>
          </div>
        </section>

        <SettingsSection>
          <SettingsGroup>
            <SettingsRow
              label={t("settingsFamilyName")}
              value={session.family_name}
            />
            {canManageFamily ? (
              <SettingsRow
                label={t("settingsFamilyCode")}
                value={
                  <span className="inline-flex min-w-0 items-center justify-end gap-2">
                    <span className="min-w-0 select-all truncate font-mono text-base tracking-widest text-slate-900">
                      {showFamilyCode
                        ? session.family_code
                        : maskFamilyCode(session.family_code)}
                    </span>
                    <IconButton
                      ariaLabel={
                        showFamilyCode
                          ? t("settingsHideFamilyCode")
                          : t("settingsShowFamilyCode")
                      }
                      title={
                        showFamilyCode
                          ? t("settingsHideFamilyCode")
                          : t("settingsShowFamilyCode")
                      }
                      pressed={showFamilyCode}
                      onClick={() => setShowFamilyCode((visible) => !visible)}
                    >
                      {showFamilyCode ? <EyeOffIcon /> : <EyeIcon />}
                    </IconButton>
                  </span>
                }
              />
            ) : null}
            <SettingsRow label={t("settingsMyNickname")} value={session.nickname} />
            <SettingsRow
              label={t("settingsMyRole")}
              value={
                {
                  father: t("roleFather"),
                  mother: t("roleMother"),
                  child: t("roleChild"),
                }[session.role]
              }
            />
            <SettingsRow
              label={t("settingsIsAdmin")}
              value={session.is_admin ? t("commonYes") : t("commonNo")}
            />
          </SettingsGroup>

          {canManageFamily ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <SoftButton onClick={handleCopyFamilyCode}>
                复制家庭代码
              </SoftButton>
              <SoftButton onClick={handleCopyInviteText}>
                复制邀请文案
              </SoftButton>
            </div>
          ) : (
            <InfoPanel className="mt-3">
              当前身份保存在此浏览器中。如果更换手机或清除浏览器数据，可能需要重新输入家庭代码加入。
            </InfoPanel>
          )}

          <Link href="/me" className="mt-3 flex min-h-12 items-center justify-center rounded-2xl bg-white/95 px-4 text-sm font-semibold text-[#2f7d42] shadow-[0_10px_26px_rgba(79,168,95,0.10)] ring-1 ring-[#dff3d8] transition hover:bg-white active:translate-y-px active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72c982]">
            {t("meTitle")}
          </Link>
        </SettingsSection>

        <SettingsSection title={t("settingsLanguage")}>
          <div className="grid grid-cols-3 rounded-[18px] bg-[#e2f8dc] p-1 shadow-inner ring-1 ring-[#cdeec8]">
            {LANGUAGE_OPTIONS.map((opt) => {
              const selected = language === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`min-h-10 rounded-[14px] px-2 text-sm font-semibold transition active:translate-y-px active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72c982] ${
                    selected
                      ? "bg-white text-[#2f7d42] shadow-[0_8px_20px_rgba(79,168,95,0.16)]"
                      : "text-[#5b735d] hover:text-[#244f2c]"
                  }`}
                  onClick={() => setLanguage(opt.value)}
                >
                  <span className="block truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </SettingsSection>

        <SettingsSection
          title={t("settingsPushTitle")}
          description={t("settingsPushDescription")}
        >
          {!push.support ? (
            <InfoPanel>{t("commonLoading")}</InfoPanel>
          ) : push.support.reason === "ios_not_standalone" ? (
            <InfoPanel tone="green">
              <p className="font-semibold text-slate-900">
                {t("settingsPushIosGuideTitle")}
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>{t("settingsPushIosGuide1")}</li>
                <li>{t("settingsPushIosGuide2")}</li>
                <li>{t("settingsPushIosGuide3")}</li>
                <li>{t("settingsPushIosGuide4")}</li>
                <li>{t("settingsPushIosGuide5")}</li>
              </ol>
            </InfoPanel>
          ) : push.support.supported ? (
            <>
              <SettingsGroup>
                <SettingsRow
                  label={t("settingsPushNewMessages")}
                  value={
                    <StatusBadge ok={push.enabled}>
                      {push.enabled ? t("commonYes") : t("commonNo")}
                    </StatusBadge>
                  }
                />
              </SettingsGroup>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <SoftButton
                  variant="primary"
                  disabled={!!busy || push.busy || push.enabled}
                  onClick={handleEnablePush}
                >
                  {t("settingsPushEnable")}
                </SoftButton>
                <SoftButton
                  disabled={!!busy || push.busy || !push.enabled}
                  onClick={handleDisablePush}
                >
                  {t("settingsPushDisable")}
                </SoftButton>
              </div>
              {push.support.permission === "denied" ? (
                <InfoPanel tone="danger" className="mt-3">
                  {t("settingsPushDenied")}
                </InfoPanel>
              ) : null}
              <InfoPanel className="mt-3">
                {t("settingsPushPrivacyNote")}
              </InfoPanel>
            </>
          ) : (
            <InfoPanel>
              {push.support.reason === "missing_vapid_key"
                ? t("settingsPushMissingConfig")
                : t("settingsPushUnsupported")}
            </InfoPanel>
          )}
        </SettingsSection>

        {push.support?.supported && diagnostics ? (
          <SettingsSection title={t("settingsPushDiagnostics")}>
            <SettingsGroup>
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
            </SettingsGroup>

            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <SoftButton
                disabled={!!busy || diagLoading}
                onClick={handleTestNotification}
              >
                {busy === "test"
                  ? t("commonLoading")
                  : t("settingsPushDiagnosticsTestButton")}
              </SoftButton>
              <SoftButton
                disabled={diagLoading}
                onClick={loadDiagnostics}
              >
                {diagLoading ? t("commonLoading") : t("chatRetry")}
              </SoftButton>
            </div>

            {diagnostics.platform === "android" ? (
              <InfoPanel tone="green" className="mt-3">
                <p className="font-semibold text-slate-900">
                  {t("settingsPushDiagnosticsAndroidTip")}
                </p>
                <p className="mt-1 text-[#526452]">
                  {t("settingsPushDiagnosticsAndroidTipText")}
                </p>
              </InfoPanel>
            ) : null}
          </SettingsSection>
        ) : null}

        {canManageFamily ? (
          <SettingsSection title={t("settingsAdminActions")}>
            <SettingsGroup>
              <ActionRow
                label={t("settingsRenameFamily")}
                disabled={!!busy}
                onClick={handleRename}
              />
              <ActionRow
                label={t("settingsResetCode")}
                disabled={!!busy}
                onClick={handleResetCode}
              />
              <ActionRow
                label={busy === "changeAccountPassword" ? t("commonLoading") : "修改密码"}
                disabled={!!busy}
                onClick={handleChangeAccountPassword}
              />
              <ToggleRow
                label={t("settingsAllowJoin")}
                checked={joinOn}
                disabled={!!busy}
                onChange={handleToggleJoin}
              />
            </SettingsGroup>
            <InfoPanel tone="blue" className="mt-3">
              管理操作使用创建者邮箱账号验证，不再单独使用管理员密码。
            </InfoPanel>

            <div className="mt-3 rounded-[22px] bg-white/95 p-3 shadow-[0_12px_30px_rgba(79,168,95,0.10)] ring-1 ring-[#dff3d8]">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-slate-900">
                    {t("scheduleReminderHealthTitle")}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-[#627263]">
                    {t("scheduleReminderHealthDescription")}
                  </p>
                </div>
                <SoftButton
                  className="shrink-0 px-3"
                  disabled={reminderHealthLoading}
                  onClick={loadReminderHealth}
                >
                  {reminderHealthLoading ? t("commonLoading") : t("chatRetry")}
                </SoftButton>
              </div>
              {reminderHealth ? (
                <ReminderHealthPanel health={reminderHealth} t={t} />
              ) : null}
            </div>
          </SettingsSection>
        ) : null}

        <SettingsSection title={t("settingsSession")}>
          <SettingsGroup>
            <ActionRow
              label={t("settingsSwitchFamily")}
              disabled={!!busy}
              onClick={handleSwitch}
            />
            <ActionRow
              label={busy === "leave" ? t("settingsLeaving") : t("settingsLeaveFamily")}
              disabled={busy === "leave"}
              danger
              onClick={handleLeave}
            />
          </SettingsGroup>
        </SettingsSection>
      </div>
    </main>
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
          <div
            key={label}
            className="rounded-2xl bg-[#f8fff4] p-2.5 text-center shadow-inner ring-1 ring-[#dff3d8]"
          >
            <div className="text-lg font-bold leading-tight text-slate-900">
              {value}
            </div>
            <div className="mt-1 truncate text-xs text-[#627263]">{label}</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl bg-[#f8fff4] p-3 text-sm ring-1 ring-[#dff3d8]">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate font-semibold text-slate-800">
            {t("scheduleReminderPrivateFailureCount")}
          </span>
          <span className="shrink-0 text-[#526452]">{health.private_failed}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-[#627263]">
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
              className="rounded-2xl bg-[#f8fff4] p-3 text-xs text-[#526452] ring-1 ring-[#dff3d8]"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono">
                  {failure.deliveryId.slice(0, 8)}
                </span>
                <span className="shrink-0">{failure.status}</span>
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
        <p className="rounded-2xl bg-[#f8fff4] p-3 text-sm text-[#627263] ring-1 ring-[#dff3d8]">
          {t("scheduleReminderNoRecentFailures")}
        </p>
      )}
    </div>
  );
}

function maskFamilyCode(code: string): string {
  return "•".repeat(Math.max(code.length, 6));
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-5">
      {title ? (
        <div className="mb-2 px-1">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#2f7d42]">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-[#526452]">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[22px] bg-white/95 shadow-[0_14px_36px_rgba(79,168,95,0.10)] ring-1 ring-[#dff3d8] backdrop-blur-xl">
      {children}
    </div>
  );
}

function SettingsRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-[#dff3d8]/80 px-4 py-3 last:border-b-0">
      <span className="min-w-0 max-w-[45%] shrink-0 truncate text-sm font-medium text-[#627263]">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-right text-sm font-semibold leading-5 text-slate-800 [overflow-wrap:anywhere]">
        {value}
      </span>
    </div>
  );
}

function ActionRow({
  label,
  disabled,
  danger = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex min-h-[52px] w-full items-center justify-between gap-3 border-b border-[#dff3d8]/80 px-4 py-3 text-left text-sm font-semibold transition last:border-b-0 active:translate-y-px active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#72c982] disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? "text-rose-600" : "text-slate-800 hover:bg-[#f4fff0]"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="min-w-0 truncate">{label}</span>
      <ChevronRightIcon />
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-[52px] items-center justify-between gap-3 border-b border-[#dff3d8]/80 px-4 py-3 transition active:translate-y-px active:scale-[0.985] last:border-b-0">
      <span className="min-w-0 truncate text-sm font-semibold text-slate-800">
        {label}
      </span>
      <span className="relative inline-flex h-8 w-[52px] shrink-0 items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="absolute inset-0 rounded-full bg-[#dce9db] transition peer-checked:bg-[#4fa85f] peer-focus-visible:ring-2 peer-focus-visible:ring-[#72c982] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white peer-disabled:opacity-50" />
        <span className="absolute left-1 h-6 w-6 rounded-full bg-white shadow-[0_4px_12px_rgba(71,64,49,0.22)] transition peer-checked:translate-x-5 peer-disabled:opacity-80" />
      </span>
    </label>
  );
}

function SoftButton({
  children,
  disabled,
  variant = "secondary",
  className = "",
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
  onClick: () => void;
}) {
  const tone =
    variant === "primary"
      ? "bg-[#4fa85f] text-white shadow-[0_12px_26px_rgba(79,168,95,0.26)] hover:bg-[#3f9650]"
      : "bg-white/95 text-[#2f7d42] shadow-[0_10px_24px_rgba(79,168,95,0.10)] ring-1 ring-[#dff3d8] hover:bg-[#fbfff7]";
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 min-w-0 items-center justify-center rounded-2xl px-4 text-sm font-semibold transition active:translate-y-px active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72c982] disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="truncate">{children}</span>
    </button>
  );
}

function InfoPanel({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "blue" | "danger";
  className?: string;
}) {
  const toneClass = {
    neutral: "bg-white/92 text-[#526452] ring-[#dff3d8]",
    green: "bg-[#e7f9df] text-[#355f3b] ring-[#cdeec8]",
    blue: "bg-sky-50/90 text-sky-800 ring-sky-100",
    danger: "bg-rose-50/90 text-rose-700 ring-rose-100",
  }[tone];
  return (
    <div className={`rounded-[18px] px-3.5 py-3 text-sm leading-6 ring-1 ${toneClass} ${className}`}>
      {children}
    </div>
  );
}

function StatusBadge({
  ok,
  children,
}: {
  ok: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-bold ${
        ok
          ? "bg-[#ddf8d7] text-[#2f7d42]"
          : "bg-[#edf6eb] text-[#5b735d]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          ok ? "bg-[#4fa85f]" : "bg-[#8fa08f]"
        }`}
      />
      <span className="truncate">{children}</span>
    </span>
  );
}

function IconButton({
  children,
  ariaLabel,
  title,
  pressed,
  onClick,
}: {
  children: ReactNode;
  ariaLabel: string;
  title: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e7f9df] text-[#2f7d42] transition hover:bg-[#ddf8d7] hover:text-[#244f2c] active:translate-y-px active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72c982]"
      aria-label={ariaLabel}
      title={title}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
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
    <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-[#dff3d8]/80 px-4 py-3 last:border-b-0">
      <span className="min-w-0 max-w-[45%] shrink-0 truncate text-sm font-medium text-[#627263]">
        {label}
      </span>
      <span
        className={`inline-flex min-w-0 items-center justify-end gap-2 text-right text-sm font-semibold leading-5 ${
          ok ? "text-[#4f7d47]" : "text-rose-600"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${
            ok ? "bg-[#4fa85f]" : "bg-rose-400"
          }`}
        />
        <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
      </span>
    </div>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-slate-300"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
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
