"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useToast } from "@/components/Toast";
import { ensureFamilyCode, verifyFamilyCode } from "@/lib/accountClient";
import { saveSession } from "@/lib/authLocal";
import { getSupabaseAuth } from "@/lib/supabaseAuthClient";

export default function VerifyFamilyCodePage() {
  const router = useRouter();
  const toast = useToast();
  const [familyCode, setFamilyCode] = useState("");
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("sent")
      ? "家庭代码已发送到你的邮箱。请查看邮箱，并输入家庭代码继续创建家庭。"
      : null;
  });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const { data } = await getSupabaseAuth().auth.getSession();
        if (!data.session) {
          router.replace("/login");
          return;
        }
        const status = await ensureFamilyCode(false);
        if (cancelled) return;
        if (status.status === "has_family" && status.session) {
          saveSession(status.session);
          router.replace("/chat");
          return;
        }
        if (status.status === "verified") {
          setNotice("家庭代码已验证，可以继续创建家庭。");
          return;
        }
        if (status.status === "expired") {
          setError("家庭代码已过期，请重新发送。");
          return;
        }
        setNotice("家庭代码已发送到你的邮箱，请输入家庭代码继续创建家庭。");
      } catch (err) {
        setError(err instanceof Error ? err.message : "网络不稳定，请稍后再试");
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!familyCode.trim()) {
      setError("请输入家庭代码");
      return;
    }
    setLoading(true);
    try {
      await verifyFamilyCode(familyCode);
      toast.success("家庭代码验证成功");
      router.replace("/create-family");
    } catch (err) {
      setError(err instanceof Error ? err.message : "家庭代码不正确，请检查邮箱中的代码。");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError(null);
    setLoading(true);
    try {
      await ensureFamilyCode(true);
      setNotice("家庭代码已重新发送到邮箱。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "家庭代码邮件发送失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-page-narrow">
      <header className="app-header-stack">
        <Link href="/" className="back-link">
          返回首页
        </Link>
        <h1 className="page-title">验证家庭代码</h1>
        <p className="page-subtitle">
          请输入发送到你邮箱中的家庭代码。
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="section-card flex flex-col gap-4">
        {checking ? (
          <div className="text-sm text-slate-500">正在检查账号状态…</div>
        ) : null}

        <div>
          <label className="label" htmlFor="family-code">家庭代码</label>
          <input
            id="family-code"
            className="field tracking-widest uppercase"
            maxLength={12}
            value={familyCode}
            onChange={(e) => setFamilyCode(e.target.value.toUpperCase())}
            disabled={loading}
            autoComplete="one-time-code"
          />
        </div>

        {notice ? (
          <div className="rounded-xl bg-sky-50 px-3 py-2 text-sm leading-6 text-sky-700">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="error-note">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={loading || checking}>
          {loading ? "验证中…" : "验证家庭代码"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={loading || checking}
          onClick={handleResend}
        >
          重新发送家庭代码
        </button>
      </form>
    </div>
  );
}
