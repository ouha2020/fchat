import { NextRequest } from "next/server";

import {
  apiError,
  jsonError,
  jsonOk,
  normalizeFamilyCode,
  requireAuthUser,
} from "@/lib/accountServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuthUser(req);
    const body = (await req.json().catch(() => null)) as { familyCode?: unknown } | null;
    const familyCode = normalizeFamilyCode(body?.familyCode);
    if (!familyCode) return jsonError("invalid_family_code");

    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb
      .from("pending_family_codes")
      .select("*")
      .eq("user_id", user.id)
      .eq("family_code", familyCode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!row) return jsonError("invalid_family_code");
    if (row.status === "used") return jsonError("family_code_used", 409);

    if (row.status === "expired" || new Date(row.expires_at).getTime() <= Date.now()) {
      await sb
        .from("pending_family_codes")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      return jsonError("family_code_expired", 409);
    }

    const { data: existingFamily } = await sb
      .from("families")
      .select("id")
      .eq("family_code", familyCode)
      .maybeSingle();
    if (existingFamily) return jsonError("family_code_used", 409);

    const { error: updateError } = await sb
      .from("pending_family_codes")
      .update({
        status: "verified",
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) throw updateError;

    return jsonOk({ status: "verified" });
  } catch (error) {
    return apiError(error);
  }
}
