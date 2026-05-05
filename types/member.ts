import type { FamilyRole } from "./family";

export interface FamilyMember {
  id: string;
  family_id: string;
  nickname: string;
  role: FamilyRole;
  is_admin: boolean;
  status: "active" | "removed";
  last_active_at: string;
}
