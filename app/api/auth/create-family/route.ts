import { NextRequest } from "next/server";

import {
  apiError,
  jsonOk,
  normalizeFamilyCode,
  requireAuthUser,
  rowToSession,
} from "@/lib/accountServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { user, email } = await requireAuthUser(req);
    const body = (await req.json().catch(() => null)) as {
      familyCode?: unknown;
      familyName?: unknown;
      nickname?: unknown;
      role?: unknown;
      deviceId?: unknown;
    } | null;
    const compatibilityAdminPassword = `${randomUUID()}-${randomUUID()}`;

    const { data, error } = await getSupabaseAdmin().rpc(
      "create_family_with_verified_code",
      {
        p_user_id: user.id,
        p_email: email,
        p_family_code: normalizeFamilyCode(body?.familyCode),
        p_family_name: String(body?.familyName ?? ""),
        p_admin_password: compatibilityAdminPassword,
        p_nickname: String(body?.nickname ?? ""),
        p_role: String(body?.role ?? ""),
        p_device_id: String(body?.deviceId ?? ""),
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("create_family_failed");
    return jsonOk({ session: rowToSession({ ...row, nickname: body?.nickname, role: body?.role }) });
  } catch (error) {
    return apiError(error);
  }
}
