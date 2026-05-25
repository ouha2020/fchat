import { clampLimit, sanitizeSearch, withAdminGuard } from "@/lib/admin/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAdminGuard(request, "audit.read", async () => {
    const url = new URL(request.url);
    const limit = clampLimit(url.searchParams.get("limit"), 50, 100);
    const familyId = sanitizeSearch(url.searchParams.get("familyId"), 60);
    const action = sanitizeSearch(url.searchParams.get("action"), 80);

    let query = getSupabaseAdmin()
      .from("admin_audit_logs")
      .select(
        "id, admin_id, admin_email, admin_role, action, target_type, target_id, family_id, reason, before_snapshot, after_snapshot, ip_address, user_agent, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (familyId) query = query.eq("family_id", familyId);
    if (action) query = query.eq("action", action);

    const { data, error } = await query;
    if (error) throw error;
    return { logs: data ?? [] };
  });
}
