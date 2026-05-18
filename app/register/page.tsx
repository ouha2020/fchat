"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { registerAccount, signInAccount } from "@/lib/accountClient";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRegisteredEmail(false);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setError("请输入邮箱");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return setError("邮箱格式不正确");
    }
    if (!password) return setError("请输入密码");
    if (password.length < 8) return setError("密码至少 8 位");
    if (password !== confirmPassword) return setError("两次密码必须一致");

    setLoading(true);
    try {
      await registerAccount(cleanEmail, password);
      await signInAccount(cleanEmail, password);
      router.replace("/verify-family-code?sent=1");
    } catch (err) {
      const message = err instanceof Error ? err.message : "注册失败，请稍后重试";
      if (message.includes("已经注册")) setRegisteredEmail(true);
      setError(message);
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
        <h1 className="mt-2 text-2xl font-bold text-slate-900">注册邮箱</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          创建家庭需要先注册邮箱。家庭代码会发送到这个邮箱。
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="card flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="email">邮箱</label>
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
          <label className="label" htmlFor="password">密码</label>
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
          <label className="label" htmlFor="confirm-password">确认密码</label>
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

        {registeredEmail ? (
          <div className="grid grid-cols-2 gap-3">
            <Link className="btn-primary" href="/login">去登录</Link>
            <Link className="btn-secondary" href="/forgot-password">忘记密码</Link>
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "注册中…" : "注册并发送家庭代码"}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        已经注册？
        <Link className="ml-1 text-brand-600 hover:underline" href="/login">
          直接登录
        </Link>
      </div>
    </div>
  );
}
