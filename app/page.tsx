"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import RoleSelect from "@/components/RoleSelect";
import { loadSession, saveSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import { joinFamily, validateMember } from "@/lib/familyService";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import type { FamilyRole } from "@/types/family";

export default function HomePage() {
  const router = useRouter();
  const [familyCode, setFamilyCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<FamilyRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const local = loadSession();
      if (!local || !isSupabaseConfigured()) {
        setRestoring(false);
        return;
      }
      try {
        const session = await validateMember(local.member_id, local.member_token);
        if (cancelled) return;
        if (session) {
          saveSession(session);
          router.replace("/chat");
          return;
        }
      } catch {
        // ignore — fall through to manual entry
      }
      if (!cancelled) setRestoring(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!familyCode.trim() || !nickname.trim() || !role) {
      setError("请填写家庭代码、昵称并选择角色");
      return;
    }
    setLoading(true);
    try {
      const session = await joinFamily({
        familyCode: familyCode.trim().toUpperCase(),
        nickname: nickname.trim(),
        role,
      });
      saveSession(session);
      router.replace("/chat");
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setLoading(false);
    }
  }

  if (restoring) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-500">
        正在恢复会话…
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-8 sm:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">家人聊天室</h1>
        <p className="mt-1 text-sm text-slate-500">
          打开网址，输入家庭代码就能用，无需注册。
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
            placeholder="例如 A8K3Q2"
            maxLength={8}
            value={familyCode}
            onChange={(e) => setFamilyCode(e.target.value.toUpperCase())}
            autoComplete="off"
          />
        </div>

        <div>
          <label className="label" htmlFor="nickname">
            你的昵称
          </label>
          <input
            id="nickname"
            className="field"
            placeholder="比如：小明"
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div>
          <span className="label">选择角色</span>
          <RoleSelect value={role} onChange={setRole} />
        </div>

        {error ? (
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          className="btn-primary mt-1"
          disabled={loading}
        >
          {loading ? "加入中…" : "进入家庭聊天室"}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        还没有家庭？
        <Link className="ml-1 text-brand-600 hover:underline" href="/create-family">
          创建一个新家庭
        </Link>
      </div>
    </div>
  );
}
