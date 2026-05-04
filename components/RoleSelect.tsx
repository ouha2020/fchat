"use client";

import { ROLE_OPTIONS, type FamilyRole } from "@/types/family";

interface Props {
  value: FamilyRole | null;
  onChange: (role: FamilyRole) => void;
}

export default function RoleSelect({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {ROLE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex flex-col items-center gap-1 rounded-2xl border-2 px-2 py-3 transition ${
              active
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-slate-200 bg-white text-slate-700 hover:border-brand-200"
            }`}
          >
            <span className="text-2xl">{opt.emoji}</span>
            <span className="text-sm font-medium">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
