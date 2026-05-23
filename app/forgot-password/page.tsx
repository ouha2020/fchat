"use client";

import Link from "next/link";
import { useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { resetPasswordEmail } from "@/lib/accountClient";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setError("请输入邮箱");
    setLoading(true);
    try {
      await resetPasswordEmail(cleanEmail);
      setMessage("密码重置邮件已发送，请查看邮箱。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败，请稍后重试");
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
        <h1 className="page-title">忘记密码</h1>
        <p className="page-subtitle">
          输入注册邮箱，我们会发送密码重置邮件。
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="section-card flex flex-col gap-4">
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
        {message ? (
          <div className="success-note">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="error-note">
            {error}
          </div>
        ) : null}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "发送中…" : "发送重置邮件"}
        </button>
      </form>
    </div>
  );
}
