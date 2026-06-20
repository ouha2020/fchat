import { useLanguage } from "@/components/LanguageProvider";
import type { FamilyRole } from "@/types/family";

const COLOR: Record<FamilyRole, string> = {
  father: "bg-sky-50 text-sky-700 ring-sky-100",
  mother: "bg-rose-50 text-rose-700 ring-rose-100",
  child: "bg-amber-50 text-amber-700 ring-amber-100",
};

const ROLE_KEYS: Record<FamilyRole, "roleFather" | "roleMother" | "roleChild"> = {
  father: "roleFather",
  mother: "roleMother",
  child: "roleChild",
};

export default function RoleBadge({ role }: { role: FamilyRole }) {
  const { t } = useLanguage();
  const label = t(ROLE_KEYS[role]);
  return (
    <span
      className={`tone-chip ${COLOR[role]}`}
      title={label}
    >
      {label}
    </span>
  );
}
