"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import RoleSelect from "@/components/RoleSelect";
import { createFamilyWithVerifiedCode, ensureFamilyCode } from "@/lib/accountClient";
import { saveSession } from "@/lib/authLocal";
import { getSupabaseAuth } from "@/lib/supabaseAuthClient";
import type { FamilyRole } from "@/types/family";

export default function CreateFamilyPage() {
  const router = useRouter();
  const [familyCode, setFamilyCode] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<FamilyRole | null>(null);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

        if (status.status !== "verified") {
          router.replace(`/verify-family-code?status=${status.status}`);
          return;
        }
      } catch {
        router.replace("/login");
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

    if (!familyCode.trim()) return setError("请输入邮箱中的家庭代码");
    if (!familyName.trim()) return setError("请输入家庭名称");
    if (!nickname.trim()) return setError("请输入昵称");
    if (!role) return setError("请选择角色");

    setLoading(true);
    try {
      const session = await createFamilyWithVerifiedCode({
        familyCode: familyCode.trim().toUpperCase(),
        familyName: familyName.trim(),
        nickname: nickname.trim(),
        role,
      });
      saveSession(session);
      router.replace("/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建家庭失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-page-narrow">
      <header className="app-header-stack">
        <Link href="/verify-family-code" className="back-link">
          返回验证
        </Link>
        <h1 className="page-title">创建新家庭</h1>
        <p className="page-subtitle">
          请使用邮箱中已验证的家庭代码继续创建家庭。
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="section-card flex flex-col gap-4">
        {checking ? (
          <div className="text-sm text-slate-500">正在检查创建资格...</div>
        ) : null}

        <div>
          <label className="label" htmlFor="family-code">
            家庭代码
          </label>
          <input
            id="family-code"
            className="field tracking-widest uppercase"
            maxLength={12}
            value={familyCode}
            onChange={(e) => setFamilyCode(e.target.value.toUpperCase())}
            disabled={loading || checking}
            autoComplete="one-time-code"
          />
        </div>

        <div>
          <label className="label" htmlFor="family-name">
            家庭名称
          </label>
          <input
            id="family-name"
            className="field"
            placeholder="比如：小明的家"
            maxLength={30}
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            disabled={loading || checking}
          />
        </div>

        <div>
          <label className="label" htmlFor="nickname">
            创建者昵称
          </label>
          <input
            id="nickname"
            className="field"
            placeholder="比如：爸爸"
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            disabled={loading || checking}
          />
        </div>

        <div>
          <span className="label">创建者角色</span>
          <RoleSelect value={role} onChange={setRole} />
        </div>

        <div className="rounded-xl bg-sky-50 px-3 py-2 text-sm leading-6 text-sky-700">
          管理操作将使用创建者邮箱账号验证，不再单独设置管理员密码。
        </div>

        {error ? (
          <div className="error-note">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={loading || checking}>
          {loading ? "创建中..." : "创建家庭"}
        </button>
      </form>
    </div>
  );
}
