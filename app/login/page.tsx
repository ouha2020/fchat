"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useToast } from "@/components/Toast";
import {
  ensureFamilyCode,
  rejoinFamilyMemberWithAccount,
  signInAccount,
} from "@/lib/accountClient";
import { saveSession } from "@/lib/authLocal";
import {
  clearPendingOwnerRejoin,
  loadPendingOwnerRejoin,
} from "@/lib/ownerRejoinPending";

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setError("请输入邮箱");
    if (!password) return setError("请输入密码");
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
          toast.info(`已恢复 ${pending.nickname} 的家庭身份`);
          router.replace("/chat");
          return;
        }
      }
      const result = await ensureFamilyCode(false);
      if (result.status === "has_family" && result.session) {
        saveSession(result.session);
        toast.info("你已经创建过家庭，正在进入家庭聊天室。");
        router.replace("/chat");
        return;
      }
      if (result.status === "verified") {
        router.replace("/create-family");
        return;
      }
      router.replace(`/verify-family-code?status=${result.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试");
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
        <h1 className="mt-2 text-2xl font-bold text-slate-900">登录</h1>
        <p className="mt-1 text-sm text-slate-500">
          登录后会继续未完成的家庭创建流程。
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        {error ? (
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "登录中…" : "登录"}
        </button>
      </form>

      <div className="mt-6 flex justify-center gap-4 text-sm">
        <Link className="text-brand-600 hover:underline" href="/register">
          注册邮箱
        </Link>
        <Link className="text-slate-500 hover:text-brand-600" href="/forgot-password">
          忘记密码
        </Link>
      </div>
    </div>
  );
}
