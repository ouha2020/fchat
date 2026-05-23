import { withAdminGuard } from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAdminGuard(request, "admin.session", async (admin) => ({
    admin: {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role,
      permissions: admin.permissions,
    },
  }));
}
