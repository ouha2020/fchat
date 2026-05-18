"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useLanguage } from "@/components/LanguageProvider";
import RoleSelect from "@/components/RoleSelect";
import {
  rejoinFamilyMemberWithAccount,
  resendExistingFamilyCode,
} from "@/lib/accountClient";
import { clearSession, loadSession, saveSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import {
  joinFamily,
  resolveJoinFamilyState,
  validateMember,
} from "@/lib/familyService";
import { savePendingOwnerRejoin } from "@/lib/ownerRejoinPending";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { getSupabaseAuth } from "@/lib/supabaseAuthClient";
import type { FamilyRole } from "@/types/family";

export default function JoinPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [familyCode, setFamilyCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<FamilyRole | null>(null);
  const [needsAdminPassword, setNeedsAdminPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [recoverNotice, setRecoverNotice] = useState<string | null>(null);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const local = loadSession();
      if (!local || !isSupabaseConfigured()) return;
      try {
        const session = await validateMember(local.member_id, local.member_token);
        if (cancelled) return;
        if (session) {
          saveSession(session);
          router.replace("/chat");
        }
      } catch {
        clearSession();
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleRecoverCode() {
    setRecoverError(null);
    setRecoverNotice(null);
    const email = recoverEmail.trim().toLowerCase();
    if (!email) {
      setRecoverError("请输入创建家庭时使用的邮箱");
      return;
    }
    setRecoverLoading(true);
    try {
      await resendExistingFamilyCode(email);
      setRecoverNotice("如果这个邮箱创建过家庭，家庭代码会发送到该邮箱。");
    } catch (err) {
      setRecoverError(humanizeError(err, language));
    } finally {
      setRecoverLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const code = familyCode.trim().toUpperCase();
    const name = nickname.trim();
    if (!code || !name) {
      setError(t("homeMissingFields"));
      return;
    }
    if (!needsAdminPassword && !role) {
      setError("请选择角色");
      return;
    }

    setLoading(true);
    try {
      if (needsAdminPassword) {
        const { data } = await getSupabaseAuth().auth.getSession();
        if (!data.session) {
          savePendingOwnerRejoin(code, name);
          router.push("/login?next=owner-rejoin");
          return;
        }
        const session = await rejoinFamilyMemberWithAccount(code, name);
        saveSession(session);
        router.replace("/chat");
        return;
      }

      const state = await resolveJoinFamilyState({
        familyCode: code,
        nickname: name,
      });

      if (state === "rejoin_required") {
        setNeedsAdminPassword(true);
        return;
      }
      if (state !== "can_join") {
        throw new Error(state);
      }

      const session = await joinFamily({
        familyCode: code,
        nickname: name,
        role: role!,
      });
      saveSession(session);
      router.replace("/chat");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : String((err as { message?: string })?.message ?? err);
      if (!needsAdminPassword && message.includes("nickname_taken")) {
        setNeedsAdminPassword(true);
      } else {
        setError(humanizeError(err, language));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-8 sm:px-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-brand-600 hover:underline">
          返回首页
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">加入家庭</h1>
        <p className="mt-1 text-sm text-slate-500">
          家人加入家庭只需要家庭代码，不需要注册。
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="card flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="code">
            家庭代码
          </label>
          <input
            id="code"
            className="field tracking-widest uppercase"
            placeholder={t("homeCodePlaceholder")}
            maxLength={12}
            value={familyCode}
            onChange={(e) => {
              setFamilyCode(e.target.value.toUpperCase());
              setNeedsAdminPassword(false);
            }}
            autoComplete="off"
          />
          <button
            type="button"
            className="mt-2 text-sm font-medium text-brand-600 hover:underline"
            onClick={() => {
              setRecoverOpen((open) => !open);
              setRecoverError(null);
              setRecoverNotice(null);
            }}
          >
            忘记家庭代码？找回代码
          </button>
        </div>

        {recoverOpen ? (
          <div className="rounded-2xl bg-slate-50 p-3">
            <label className="label" htmlFor="recover-email">
              创建家庭的邮箱
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="recover-email"
                className="field"
                type="email"
                value={recoverEmail}
                onChange={(e) => {
                  setRecoverEmail(e.target.value);
                  setRecoverError(null);
                  setRecoverNotice(null);
                }}
                autoComplete="email"
                placeholder="name@example.com"
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                disabled={recoverLoading}
                onClick={handleRecoverCode}
              >
                {recoverLoading ? "发送中..." : "发送代码"}
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              家庭代码只会发送到创建家庭时使用的邮箱，页面不会直接显示代码。
            </p>
            {recoverNotice ? (
              <div className="mt-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-700">
                {recoverNotice}
              </div>
            ) : null}
            {recoverError ? (
              <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {recoverError}
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <label className="label" htmlFor="nickname">
            你的昵称
          </label>
          <input
            id="nickname"
            className="field"
            placeholder={t("homeNicknamePlaceholder")}
            maxLength={20}
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value);
              setNeedsAdminPassword(false);
            }}
            autoComplete="off"
          />
        </div>

        {needsAdminPassword ? (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
            这个昵称已经存在。请使用创建家庭的邮箱账号登录，登录成功后就可以恢复这个身份。
            <Link
              className="ml-1 font-semibold text-brand-600 underline"
              href="/login?next=owner-rejoin"
              onClick={() => {
                savePendingOwnerRejoin(
                  familyCode.trim().toUpperCase(),
                  nickname.trim(),
                );
              }}
            >
              去登录
            </Link>
          </div>
        ) : (
          <div>
            <span className="label">你的角色</span>
            <RoleSelect value={role} onChange={setRole} />
          </div>
        )}

        {error ? (
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn-primary mt-1" disabled={loading}>
          {loading
            ? t("homeJoining")
            : needsAdminPassword
              ? t("homeRejoin")
              : "加入聊天"}
        </button>
      </form>
    </div>
  );
}
