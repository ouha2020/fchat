"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useToast } from "@/components/Toast";
import { clearSession, loadSession, saveSession } from "@/lib/authLocal";
import { ensureFamilyCode } from "@/lib/accountClient";
import { validateMember } from "@/lib/familyService";
import { getSupabaseAuth } from "@/lib/supabaseAuthClient";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

export default function HomePage() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const local = loadSession();
      if (!local || !isSupabaseConfigured()) {
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
        clearSession();
      } catch {
        clearSession();
      } finally {
        // Home stays usable while session restore runs in the background.
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleCreateFamily() {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await getSupabaseAuth().auth.getSession();
      if (!data.session) {
        router.push("/register");
        return;
      }
      const result = await ensureFamilyCode(false);
      if (result.status === "has_family" && result.session) {
        saveSession(result.session);
        toast.info("你已经创建过家庭，正在进入家庭聊天室。");
        router.replace("/chat");
        return;
      }
      if (result.status === "verified") {
        router.push("/create-family");
        return;
      }
      router.push(`/verify-family-code?status=${result.status}`);
    } catch {
      router.push("/login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-8 sm:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">家人聊天室</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          创建家庭需要邮箱注册。家人加入家庭只需要家庭代码。
        </p>
      </header>

      <EnvWarning />

      <div className="grid gap-4">
        <button
          type="button"
          className="card flex items-center justify-between text-left transition hover:bg-white/80 active:scale-[0.99]"
          disabled={busy}
          onClick={handleCreateFamily}
        >
          <span>
            <span className="block text-lg font-bold text-slate-900">
              创建家庭
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-slate-500">
              注册或登录邮箱，获取家庭代码后创建家庭。
            </span>
          </span>
          <span className="text-2xl text-brand-500">＋</span>
        </button>

        <Link
          href="/join"
          className="card flex items-center justify-between text-left transition hover:bg-white/80 active:scale-[0.99]"
        >
          <span>
            <span className="block text-lg font-bold text-slate-900">
              加入家庭
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-slate-500">
              输入家人分享的家庭代码、昵称和角色即可加入。
            </span>
          </span>
          <span className="text-2xl text-brand-500">→</span>
        </Link>
      </div>

      <div className="mt-6 flex justify-center gap-4 text-sm">
        <Link className="text-brand-600 hover:underline" href="/login">
          已注册？登录
        </Link>
        <Link className="text-slate-500 hover:text-brand-600" href="/forgot-password">
          忘记密码
        </Link>
      </div>
    </div>
  );
}
