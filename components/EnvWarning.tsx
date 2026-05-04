"use client";

import { isSupabaseConfigured } from "@/lib/supabaseClient";

export default function EnvWarning() {
  if (isSupabaseConfigured()) return null;
  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      <div className="font-semibold">尚未配置 Supabase</div>
      <p className="mt-1 leading-relaxed">
        请将 <code>.env.local.example</code> 复制为 <code>.env.local</code>，
        并填写 <code>NEXT_PUBLIC_SUPABASE_URL</code> 与{" "}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>，再在 Supabase 后台执行{" "}
        <code>supabase/schema.sql</code>。
      </p>
    </div>
  );
}
