import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isMemberToken, isUuid } from "@/lib/security";
import type { FamilyRole } from "@/types/family";

export interface ValidatedMemberSession {
  family_id: string;
  family_name: string;
  family_code: string;
  member_id: string;
  nickname: string;
  role: FamilyRole;
  is_admin: boolean;
}

export async function validateMemberCredentials(
  memberId: unknown,
  memberToken: unknown,
): Promise<ValidatedMemberSession | null> {
  if (!isUuid(memberId) || !isMemberToken(memberToken)) {
    return null;
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc("validate_member", {
    p_member_id: memberId,
    p_member_token: memberToken,
    p_device_id: null,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    family_id: row.family_id,
    family_name: row.family_name,
    family_code: row.family_code,
    member_id: row.member_id,
    nickname: row.nickname,
    role: row.role,
    is_admin: row.is_admin,
  };
}
