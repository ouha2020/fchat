"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import EnvWarning from "@/components/EnvWarning";
import { useToast } from "@/components/Toast";
import { ensureFamilyCode } from "@/lib/accountClient";
import { clearSession, loadSession, saveSession } from "@/lib/authLocal";
import { safeRestoreSession } from "@/lib/familyService";
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
      if (!local || !isSupabaseConfigured()) return;
      const result = await safeRestoreSession(local.member_id, local.member_token);
      if (cancelled) return;
      if (result.status === "valid") {
        saveSession(result.session);
        router.replace("/chat");
        return;
      }
      if (result.status === "expired") {
        clearSession();
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
        toast.info("你已经创建过家庭，正在进入家人聊天室。");
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
    <main className="min-h-[100dvh] bg-[#f6f2ea] text-stone-950">
      <section className="relative mx-auto h-[100dvh] min-h-[640px] w-full max-w-md overflow-hidden bg-[#fffdf8] shadow-2xl shadow-stone-300/40">
        <h1 className="sr-only">HomeTree 家人聊天室</h1>

        <div className="absolute inset-0 overflow-hidden">
          <Image
            src="/welcome-home-main.png?v=no-status-20260530"
            alt=""
            fill
            priority
            aria-hidden="true"
            className="object-cover object-top"
            sizes="(max-width: 448px) 100vw, 448px"
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-b from-transparent via-[#fffdf8]/74 to-[#fffdf8]"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#fffdf8]/80 to-transparent"
            aria-hidden="true"
          />
        </div>

        <div className="relative z-10 flex h-full flex-col justify-end px-5 pb-[max(env(safe-area-inset-bottom),1.125rem)] pt-6 min-[390px]:px-6">
          <div className="rounded-[28px] border border-white/75 bg-[#fffdf8]/82 p-4 shadow-[0_14px_34px_rgba(99,82,49,0.12)] backdrop-blur-md">
            <EnvWarning />
            <p className="mb-3 text-center text-[13px] font-medium leading-6 text-[#665b48]">
              创建家庭需要邮箱，家人加入只要家庭代码。
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                className="native-press flex min-h-[4.25rem] w-full touch-manipulation flex-col items-center justify-center rounded-[18px] bg-[#5f934e] px-3 text-center text-lg font-bold leading-6 text-white shadow-[0_10px_22px_rgba(79,126,61,0.2),inset_0_1px_0_rgba(255,255,255,0.3)] transition hover:bg-[#538544] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8deb5] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
                onClick={handleCreateFamily}
              >
                <span>创建家庭</span>
                <span className="mt-0.5 text-xs font-semibold text-white/78">
                  注册邮箱
                </span>
              </button>

              <Link
                href="/join"
                className="native-press flex min-h-[4.25rem] w-full touch-manipulation flex-col items-center justify-center rounded-[18px] border border-[#b9d1a7] bg-white/78 px-3 text-center text-lg font-bold leading-6 text-[#445f37] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_8px_18px_rgba(96,82,54,0.07)] transition hover:bg-[#f5f9ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8deb5]"
              >
                <span>加入家庭</span>
                <span className="mt-0.5 text-xs font-semibold text-[#7a775f]">
                  输入代码
                </span>
              </Link>
            </div>
            <div className="mt-3 flex min-h-9 items-center justify-center gap-3 text-sm font-medium leading-5 text-[#7a6c58]">
              <span>已有账号？</span>
              <Link
                className="font-semibold text-[#5f934e] underline underline-offset-4"
                href="/login"
              >
                登录
              </Link>
              <span aria-hidden="true" className="text-[#d3c7ad]">
                |
              </span>
              <Link
                className="text-[#7a6c58] underline-offset-4 hover:text-[#5f934e] hover:underline"
                href="/forgot-password"
              >
                忘记密码
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
