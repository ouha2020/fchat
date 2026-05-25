import { NextRequest } from "next/server";

import {
  apiError,
  jsonOk,
  requireAuthUser,
} from "@/lib/accountServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuthUser(req);
    const body = (await req.json().catch(() => null)) as {
      memberId?: unknown;
      memberToken?: unknown;
      newPassword?: unknown;
    } | null;

    const { error } = await getSupabaseAdmin().rpc(
      "reset_admin_password_by_owner",
      {
        p_user_id: user.id,
        p_member_id: String(body?.memberId ?? ""),
        p_member_token: String(body?.memberToken ?? ""),
        p_new_password: String(body?.newPassword ?? ""),
      },
    );
    if (error) throw error;
    return jsonOk({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
