"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import RoleSelect from "@/components/RoleSelect";
import { saveSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import { createFamily } from "@/lib/familyService";
import type { FamilyRole } from "@/types/family";

export default function CreateFamilyPage() {
  const router = useRouter();
  const [familyName, setFamilyName] = useState("");
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<FamilyRole | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<LocalSession | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!familyName.trim() || !nickname.trim() || !role || !adminPassword) {
      setError("请填写完整信息并选择角色");
      return;
    }
    if (adminPassword.length < 4) {
      setError("管理员密码至少 4 位");
      return;
    }
    setLoading(true);
    try {
      const session = await createFamily({
        familyName: familyName.trim(),
        nickname: nickname.trim(),
        role,
        adminPassword,
      });
      saveSession(session);
      setCreated(session);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <div className="flex flex-1 flex-col px-5 py-8 sm:px-8">
        <h1 className="text-2xl font-bold text-slate-900">家庭创建成功 🎉</h1>
        <p className="mt-1 text-sm text-slate-500">
          请把家庭代码发给家人，让他们也能加入。
        </p>

        <div className="card mt-6 text-center">
          <div className="text-sm text-slate-500">家庭代码</div>
          <div className="mt-2 select-all text-4xl font-bold tracking-[0.4em] text-brand-600">
            {created.family_code}
          </div>
          <div className="mt-2 text-sm text-slate-600">
            家庭名称：{created.family_name}
          </div>
        </div>

        <button
          type="button"
          className="btn-primary mt-6"
          onClick={() => router.replace("/chat")}
        >
          进入聊天室
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-8 sm:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">创建新家庭</h1>
        <p className="mt-1 text-sm text-slate-500">
          创建后会得到一个 6 位家庭代码，发给家人即可加入。
        </p>
      </header>

      <EnvWarning />

      <form onSubmit={onSubmit} className="card flex flex-col gap-4">
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
          />
        </div>

        <div>
          <label className="label" htmlFor="nickname">
            你的昵称
          </label>
          <input
            id="nickname"
            className="field"
            placeholder="比如：爸爸"
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <div>
          <span className="label">你的角色</span>
          <RoleSelect value={role} onChange={setRole} />
        </div>

        <div>
          <label className="label" htmlFor="admin-password">
            管理员密码
          </label>
          <input
            id="admin-password"
            type="password"
            className="field"
            placeholder="用于以后修改家庭设置（至少 4 位）"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        {error ? (
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn-primary mt-1" disabled={loading}>
          {loading ? "创建中…" : "创建家庭"}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        已经有家庭代码？
        <Link className="ml-1 text-brand-600 hover:underline" href="/">
          返回加入
        </Link>
      </div>
    </div>
  );
}
