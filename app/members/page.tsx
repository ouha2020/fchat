"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import RoleBadge from "@/components/RoleBadge";
import { loadSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import { removeMember } from "@/lib/familyService";
import { formatRelative } from "@/lib/format";
import { listMembers } from "@/lib/memberService";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import type { FamilyMember } from "@/types/member";

export default function MembersPage() {
  const router = useRouter();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const local = loadSession();
    if (!local) {
      router.replace("/");
      return;
    }
    setSession(local);
    listMembers(local.family_id)
      .then(setMembers)
      .catch((err) => alert(humanizeError(err)))
      .finally(() => setLoading(false));
  }, [router]);

  // Live-sync the member list so other admins see removals immediately.
  useEffect(() => {
    if (!session) return;
    const sb = getSupabase();
    const channel = sb
      .channel(`members-page:${session.family_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "family_members",
          filter: `family_id=eq.${session.family_id}`,
        },
        () => {
          listMembers(session.family_id)
            .then(setMembers)
            .catch(() => undefined);
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [session]);

  async function handleRemove(target: FamilyMember) {
    if (!session) return;
    if (target.id === session.member_id) {
      alert("不能移除自己");
      return;
    }
    const ok = window.confirm(
      `确定将「${target.nickname}」移出家庭？\n该成员将无法再访问家庭聊天，可重新邀请加入。`,
    );
    if (!ok) return;
    setBusyId(target.id);
    try {
      await removeMember(session, target.id);
      setMembers((prev) => prev.filter((m) => m.id !== target.id));
    } catch (err) {
      alert(humanizeError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-6 sm:px-8">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <Link href="/chat" className="text-sm text-brand-600 hover:underline">
            ← 返回聊天
          </Link>
          <h1 className="mt-1 text-2xl font-bold">家庭成员</h1>
        </div>
      </header>

      {loading ? (
        <div className="text-sm text-slate-500">加载中…</div>
      ) : (
        <ul className="card divide-y divide-slate-100 p-0">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 px-4 py-3"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-base font-semibold text-slate-700">
                {m.nickname.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.nickname}</span>
                  <RoleBadge role={m.role} />
                  {m.is_admin ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      管理员
                    </span>
                  ) : null}
                  {session?.member_id === m.id ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      我
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-slate-500">
                  最近活跃 {formatRelative(m.last_active_at)}
                </span>
              </div>
              {session?.is_admin && session.member_id !== m.id ? (
                <button
                  type="button"
                  className="btn-ghost h-9 px-3 text-sm text-rose-600 hover:bg-rose-50"
                  disabled={busyId === m.id}
                  onClick={() => handleRemove(m)}
                >
                  {busyId === m.id ? "移除中…" : "移除"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
