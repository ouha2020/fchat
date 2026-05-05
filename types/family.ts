export type FamilyRole = "father" | "mother" | "child";

export const ROLE_LABELS: Record<FamilyRole, string> = {
  father: "爸爸",
  mother: "妈妈",
  child: "孩子",
};

export const ROLE_OPTIONS: { value: FamilyRole; label: string; emoji: string }[] = [
  { value: "father", label: "爸爸", emoji: "👨" },
  { value: "mother", label: "妈妈", emoji: "👩" },
  { value: "child", label: "孩子", emoji: "🧒" },
];

export interface Family {
  id: string;
  name: string;
  family_code: string;
  join_enabled: boolean;
  created_at: string;
  updated_at: string;
}
