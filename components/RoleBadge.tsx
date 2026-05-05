import { ROLE_LABELS, type FamilyRole } from "@/types/family";

const COLOR: Record<FamilyRole, string> = {
  father: "bg-sky-100 text-sky-700",
  mother: "bg-rose-100 text-rose-700",
  child: "bg-amber-100 text-amber-700",
};

export default function RoleBadge({ role }: { role: FamilyRole }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}
