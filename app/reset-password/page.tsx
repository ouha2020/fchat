"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { updateAccountPassword } from "@/lib/accountClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex flex-1 flex-col px-5 py-8 sm:px-8">
      <header className="mb-6">
        <Link href="/login" className="text-sm text-brand-600 hover:underline">
          返回登录
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">重置密码</h1>
        <p className="mt-1 text-sm text-slate-500">
          设置一个新的登录密码。
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="card flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="password">新密码</label>
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
          <label className="label" htmlFor="confirm-password">确认新密码</label>
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
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "更新中…" : "更新密码"}
        </button>
      </form>
    </div>
  );
}
