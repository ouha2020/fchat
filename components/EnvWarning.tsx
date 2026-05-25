"use client";

import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { useLanguage } from "@/components/LanguageProvider";

export default function EnvWarning() {
  const { t } = useLanguage();
  if (isSupabaseConfigured()) return null;
  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      <div className="font-semibold">{t("envTitle")}</div>
      <p className="mt-1 leading-relaxed">
        {t("envBody")}
      </p>
    </div>
  );
}
