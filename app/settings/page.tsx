"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { clearSession, loadSession, saveSession, updateSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import {
  fetchFamilyPublic,
  leaveFamily,
  resetFamilyCode,
  setJoinEnabled,
  updateFamilyName,
} from "@/lib/familyService";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

export default function SettingsPage() {
  const router = useRouter();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [joinOn, setJoinOn] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const local = loadSession();
    if (!local) {
      router.replace("/");
      return;
    }
    setSession(local);
    fetchFamilyPublic(local.family_id)
      .then((row) => {
        if (row) {
          setJoinOn(row.join_enabled);
          if (row.name !== local.family_name || row.family_code !== local.family_code) {
            const next = updateSession({
              family_name: row.name,
              family_code: row.family_code,
            });
            if (next) setSession(next);
          }
        }
      })
      .catch(() => undefined);
  }, [router]);

  async function withAdmin(action: string, fn: (password: string) => Promise<void>) {
    if (!session?.is_admin) {
      alert("仅管理员可操作");
      return;
    }
    const password = window.prompt(`请输入管理员密码以${action}`);
    if (!password) return;
    setBusy(action);
    try {
      await fn(password);
    } catch (err) {
      alert(humanizeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRename() {
    if (!session) return;
    const newName = window.prompt("输入新的家庭名称", session.family_name);
    if (!newName || !newName.trim()) return;
    await withAdmin("修改家庭名称", async (password) => {
      await updateFamilyName(session, password, newName.trim());
      const next = updateSession({ family_name: newName.trim() });
      if (next) setSession(next);
    });
  }

  async function handleResetCode() {
    if (!session) return;
    const ok = window.confirm("重置家庭代码后，旧代码立即失效。继续吗？");
    if (!ok) return;
    await withAdmin("重置家庭代码", async (password) => {
      const newCode = await resetFamilyCode(session, password);
      const next = updateSession({ family_code: newCode });
      if (next) setSession(next);
    });
  }

  async function handleToggleJoin(next: boolean) {
    if (!session) return;
    await withAdmin(next ? "开启新成员加入" : "关闭新成员加入", async (password) => {
      await setJoinEnabled(session, password, next);
      setJoinOn(next);
    });
  }

  async function handleLeave() {
    if (!session) return;
    const ok = window.confirm("确定要退出这个家庭吗？该设备的会话也会被清除。");
    if (!ok) return;
    setBusy("leave");
    try {
      await leaveFamily(session);
      clearSession();
      router.replace("/");
    } catch (err) {
      alert(humanizeError(err));
    } finally {
      setBusy(null);
    }
  }

  function handleSwitch() {
    const ok = window.confirm("切换家庭会清除当前设备的会话，确认吗？");
    if (!ok) return;
    clearSession();
    router.replace("/");
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col px-5 py-6 sm:px-8">
      <header className="mb-4">
        <Link href="/chat" className="text-sm text-brand-600 hover:underline">
          ← 返回聊天
        </Link>
        <h1 className="mt-1 text-2xl font-bold">家庭设置</h1>
      </header>

      <section className="card flex flex-col gap-3">
        <Row label="家庭名称" value={session.family_name} />
        <Row
          label="家庭代码"
          value={
            <span className="select-all font-mono text-base tracking-widest">
              {session.family_code}
            </span>
          }
        />
        <Row label="我的昵称" value={session.nickname} />
        <Row label="我的角色" value={
          { father: "爸爸", mother: "妈妈", child: "孩子" }[session.role]
        } />
        <Row label="管理员" value={session.is_admin ? "是" : "否"} />
      </section>

      {session.is_admin ? (
        <section className="card mt-4 flex flex-col gap-3">
          <h2 className="text-base font-semibold">管理员操作</h2>
          <button
            type="button"
            className="btn-secondary"
            disabled={!!busy}
            onClick={handleRename}
          >
            修改家庭名称
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!!busy}
            onClick={handleResetCode}
          >
            重置家庭代码
          </button>
          <label className="flex items-center justify-between rounded-xl px-1 py-2">
            <span className="text-sm text-slate-700">允许新成员加入</span>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={joinOn}
              disabled={!!busy}
              onChange={(e) => handleToggleJoin(e.target.checked)}
            />
          </label>
        </section>
      ) : null}

      <section className="card mt-4 flex flex-col gap-3">
        <h2 className="text-base font-semibold">会话</h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={handleSwitch}
          disabled={!!busy}
        >
          切换到其他家庭
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={handleLeave}
          disabled={busy === "leave"}
        >
          {busy === "leave" ? "退出中…" : "退出该家庭"}
        </button>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value}</span>
    </div>
  );
}
