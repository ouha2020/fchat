export const ADMIN_PERMISSIONS = [
  "admin.session",
  "admin.manage",
  "dashboard.read",
  "audit.read",
  "system_health.read",
  "family.read",
  "family.disable",
  "family.reset_code",
  "member.read",
  "member.remove",
  "member.restore",
  "message.read_metadata",
  "message.soft_delete",
  "push.read",
  "push.disable_endpoint",
  "upload.read_metadata",
  "upload.mark_cleanup",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
export type AdminRole = "super_admin" | "operator" | "readonly";

export interface AdminSession {
  id: string;
  email: string;
  displayName: string | null;
  role: AdminRole;
  permissions: AdminPermission[];
}

export function hasAdminPermission(
  permissions: readonly string[],
  permission: AdminPermission,
): boolean {
  return permissions.includes(permission);
}
