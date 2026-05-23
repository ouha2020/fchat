import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { ZodError } from "zod";

import { rejectMismatchedOrigin } from "@/lib/apiSecurity";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { AdminPermission, AdminRole, AdminSession } from "@/lib/admin/permissions";

const COOLDOWN_MS = 10_000;
const MAX_REASON_LENGTH = 500;

export class AdminRequestError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

interface AdminProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  role: AdminRole;
  status: "active" | "disabled";
}

export interface AdminContext extends AdminSession {
  user: User;
}

export interface AuditInput {
  action: string;
  targetType: string;
  targetId: string;
  familyId?: string | null;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  reason: string;
}

export async function requireAdmin(
  request: Request,
  permission?: AdminPermission,
): Promise<AdminContext> {
  const token = bearerToken(request);
  if (!token) throw new AdminRequestError("admin_unauthorized", 401);

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user?.id || !data.user.email) {
    await auditSecurityEvent(request, {
      action: "admin.auth_failed",
      targetType: "admin_session",
      targetId: "unknown",
      reason: "invalid_supabase_auth_token",
    });
    throw new AdminRequestError("admin_unauthorized", 401);
  }

  const profile = await loadOrBootstrapProfile(data.user);
  if (!profile || profile.status !== "active") {
    await auditSecurityEvent(request, {
      adminEmail: data.user.email,
      action: "admin.auth_forbidden",
      targetType: "admin_profile",
      targetId: data.user.id,
      reason: "admin_profile_missing_or_disabled",
    });
    throw new AdminRequestError("admin_forbidden", 403);
  }

  const { data: permissionRows, error: permissionError } = await sb
    .from("admin_role_permissions")
    .select("permission")
    .eq("role", profile.role);
  if (permissionError) throw permissionError;

  const permissions = (permissionRows ?? []).map((row) => row.permission) as AdminPermission[];
  if (permission && !permissions.includes(permission)) {
    await auditSecurityEvent(request, {
      adminId: profile.id,
      adminEmail: profile.email,
      adminRole: profile.role,
      action: "admin.permission_denied",
      targetType: "permission",
      targetId: permission,
      reason: "missing_required_permission",
    });
    throw new AdminRequestError("admin_permission_denied", 403);
  }

  const now = new Date().toISOString();
  await sb
    .from("admin_profiles")
    .update({ email: data.user.email, last_seen_at: now, updated_at: now })
    .eq("id", profile.id);

  return {
    user: data.user,
    id: profile.id,
    email: data.user.email,
    displayName: profile.display_name,
    role: profile.role,
    permissions,
  };
}

export async function withAdminGuard<T>(
  request: Request,
  permission: AdminPermission | undefined,
  handler: (context: AdminContext) => Promise<T>,
): Promise<NextResponse> {
  const originError = rejectMismatchedOrigin(request);
  if (originError) return originError;

  try {
    const admin = await requireAdmin(request, permission);
    const body = await handler(admin);
    return NextResponse.json(body);
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export function adminErrorResponse(error: unknown): NextResponse {
  if (error instanceof AdminRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "admin_request_failed";
  if (message.includes("invalid input syntax for type uuid")) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  console.warn("[admin api]", message);
  return NextResponse.json({ error: "admin_request_failed" }, { status: 500 });
}

export async function readAdminJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AdminRequestError("invalid_content_type", 415);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 32 * 1024) {
    throw new AdminRequestError("request_too_large", 413);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AdminRequestError("invalid_json", 400);
  }
}

export function requireReason(value: unknown): string {
  const reason = String(value ?? "").trim();
  if (!reason) throw new AdminRequestError("reason_required", 400);
  if (reason.length > MAX_REASON_LENGTH) {
    throw new AdminRequestError("reason_too_long", 400);
  }
  return reason;
}

export async function enforceAdminCooldown(
  admin: Pick<AdminContext, "id">,
  action: string,
  targetId: string,
  windowMs = COOLDOWN_MS,
): Promise<void> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("admin_audit_logs")
    .select("id")
    .eq("admin_id", admin.id)
    .eq("action", action)
    .eq("target_id", targetId)
    .gte("created_at", since)
    .limit(1);
  if (error) throw error;
  if ((data ?? []).length > 0) {
    throw new AdminRequestError("cooldown_active", 429);
  }
}

export async function auditAdminAction(
  request: Request,
  admin: Pick<AdminContext, "id" | "email" | "role">,
  input: AuditInput,
): Promise<void> {
  await insertAuditLog(request, {
    adminId: admin.id,
    adminEmail: admin.email,
    adminRole: admin.role,
    ...input,
  });
}

export async function auditSecurityEvent(
  request: Request,
  input: AuditInput & {
    adminId?: string | null;
    adminEmail?: string | null;
    adminRole?: string | null;
  },
): Promise<void> {
  try {
    await insertAuditLog(request, input);
  } catch (error) {
    console.warn("[admin audit]", error instanceof Error ? error.message : "audit_failed");
  }
}

export async function auditOwnerAction(
  request: Request,
  input: AuditInput & { ownerUserId: string; ownerEmail?: string | null },
): Promise<void> {
  await insertAuditLog(request, {
    adminId: null,
    adminEmail: input.ownerEmail ?? null,
    adminRole: "family_owner",
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    familyId: input.familyId,
    beforeSnapshot: input.beforeSnapshot,
    afterSnapshot: input.afterSnapshot,
    reason: input.reason,
  });
}

export function isBreakGlassAuthorized(request: Request): boolean {
  const secret = process.env.SYSTEM_HEALTH_SECRET;
  if (!secret) return false;
  const headerSecret = request.headers.get("x-system-health-secret") ?? "";
  return safeEqual(bearerToken(request), secret) || safeEqual(headerSecret, secret);
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim().slice(0, 80) || null;
  return request.headers.get("x-real-ip")?.slice(0, 80) ?? null;
}

export function clampLimit(value: string | null, fallback = 50, max = 100): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

export function sanitizeSearch(value: string | null, maxLength = 80): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function loadOrBootstrapProfile(user: User): Promise<AdminProfileRow | null> {
  const sb = getSupabaseAdmin();
  const email = user.email?.trim().toLowerCase();
  if (!email) return null;

  const bootstrapEmails = readBootstrapEmails();
  if (bootstrapEmails.has(email)) {
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from("admin_profiles")
      .upsert(
        {
          id: user.id,
          email,
          role: "super_admin",
          status: "active",
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: "id" },
      )
      .select("id, email, display_name, role, status")
      .single<AdminProfileRow>();
    if (error) throw error;
    return data;
  }

  const { data, error } = await sb
    .from("admin_profiles")
    .select("id, email, display_name, role, status")
    .eq("id", user.id)
    .maybeSingle<AdminProfileRow>();
  if (error) throw error;
  return data ?? null;
}

async function insertAuditLog(
  request: Request,
  input: AuditInput & {
    adminId?: string | null;
    adminEmail?: string | null;
    adminRole?: string | null;
  },
): Promise<void> {
  const { error } = await getSupabaseAdmin().from("admin_audit_logs").insert({
    admin_id: input.adminId ?? null,
    admin_email: input.adminEmail ?? null,
    admin_role: input.adminRole ?? "unknown",
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    family_id: input.familyId ?? null,
    reason: requireReason(input.reason),
    before_snapshot: input.beforeSnapshot ?? null,
    after_snapshot: input.afterSnapshot ?? null,
    ip_address: clientIp(request),
    user_agent: (request.headers.get("user-agent") ?? "").slice(0, 512) || null,
  });
  if (error) throw error;
}

function readBootstrapEmails(): Set<string> {
  return new Set(
    String(process.env.ADMIN_BOOTSTRAP_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function bearerToken(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}
