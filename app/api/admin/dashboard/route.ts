import { withAdminGuard } from "@/lib/admin/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAdminGuard(request, "dashboard.read", async () => {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.rpc("refresh_admin_metric_snapshot");
    if (error) throw error;
    const snapshot = Array.isArray(data) ? data[0] : data;
    return { snapshot };
  });
}
