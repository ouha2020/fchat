"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { updateAccountPassword } from "@/lib/accountClient";
import { getSupabaseAuth } from "@/lib/supabaseAuthClient";

// The recovery link lands here with the token in the URL hash; creating the
// auth client parses it (detectSessionInUrl) and getSession waits for that.
type LinkState = "checking" | "ready" | "invalid";

export default function ResetPasswordPage() {
  const router = useRouter();
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
    if (password.length < 8) return setError("新密码至少 8 位");
    if (password !== confirmPassword) return setError("两次密码必须一致");
    setLoading(true);
    try {
      await updateAccountPassword(password);
      router.replace("/login?reset=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "密码更新失败，请重新打开邮件链接");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-page-narrow">
      <header className="app-header-stack">
        <Link href="/login" className="back-link">
          返回登录
        </Link>
        <h1 className="page-title">重置密码</h1>
        <p className="page-subtitle">
          设置一个新的登录密码。
        </p>
      </header>

      <EnvWarning />

      {linkState === "invalid" ? (
        <div className="section-card">
          <h2 className="text-base font-semibold text-slate-900">
            链接无效或已过期
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            重置链接只能使用一次，且有时效。请回到登录页重新点击“忘记密码”，
            再从新邮件里的链接进入。
          </p>
          <Link href="/login" className="btn-primary mt-4">
            返回登录
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="section-card flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="password">新密码</label>
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
            <label className="label" htmlFor="confirm-password">确认新密码</label>
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
              ? "更新中…"
              : linkState === "checking"
                ? "正在校验链接…"
                : "更新密码"}
          </button>
        </form>
      )}
    </div>
  );
}
