"use client";

import Image from "next/image";

import { ROLE_OPTIONS, type FamilyRole } from "@/types/family";
import { useLanguage } from "@/components/LanguageProvider";

interface Props {
  value: FamilyRole | null;
  onChange: (role: FamilyRole) => void;
}

const ROLE_ICONS: Record<FamilyRole, string> = {
  father: "/ui-icons/role-father.png",
  mother: "/ui-icons/role-mother.png",
  child: "/ui-icons/role-child.png",
};

const ROLE_KEYS: Record<FamilyRole, "roleFather" | "roleMother" | "roleChild"> = {
  father: "roleFather",
  mother: "roleMother",
  child: "roleChild",
};

export default function RoleSelect({ value, onChange }: Props) {
  const { t } = useLanguage();
  return (
    <div
      className="grid grid-cols-3 gap-2 min-[390px]:gap-3"
      role="radiogroup"
      aria-label={t("homeSelectRole")}
    >
      {ROLE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        const label = t(ROLE_KEYS[opt.value]);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            role="radio"
            aria-checked={active}
            className={`relative flex min-h-28 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-2 py-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 ${
              active
                ? "border-brand-500 bg-brand-50 text-brand-700 shadow-sm"
                : "border-slate-200 bg-white text-slate-700 hover:border-brand-200"
            }`}
          >
            {active ? (
              <span
                className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-white shadow-sm"
                aria-hidden="true"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m5 12 4 4L19 6" />
                </svg>
              </span>
            ) : null}
            <Image
              src={ROLE_ICONS[opt.value]}
              alt=""
              width={56}
              height={56}
              className="h-12 w-12 object-contain min-[390px]:h-14 min-[390px]:w-14"
            />
            <span className="max-w-full break-words text-sm font-medium leading-5">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
