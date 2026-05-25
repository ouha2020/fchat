import { NextResponse } from "next/server";

import { buildSystemHealthReport } from "@/lib/admin/systemHealth";
import {
  adminErrorResponse,
  auditSecurityEvent,
  isBreakGlassAuthorized,
  requireAdmin,
} from "@/lib/admin/server";
import { rejectMismatchedOrigin } from "@/lib/apiSecurity";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const originError = rejectMismatchedOrigin(request);
  if (originError) return originError;

  try {
    const breakGlass = isBreakGlassAuthorized(request);
    if (breakGlass) {
      await auditSecurityEvent(request, {
        action: "system_health.break_glass",
        targetType: "system_health",
        targetId: "catalog",
        reason: "SYSTEM_HEALTH_SECRET used",
      });
    } else {
      await requireAdmin(request, "system_health.read");
    }

    const sb = getSupabaseAdmin();
    const [{ data: catalog, error: catalogError }, ping] = await Promise.all([
      sb.rpc("get_system_health_catalog"),
      sb.rpc("schema_health_ping"),
    ]);

    const environment = {
      systemHealthSecretConfigured: Boolean(process.env.SYSTEM_HEALTH_SECRET),
      pushFlushSecretConfigured: Boolean(process.env.PUSH_FLUSH_SECRET),
      scheduleReminderSecretConfigured: Boolean(process.env.SCHEDULE_REMINDER_SECRET),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
    };

    if (catalogError) {
      const missingCatalogRpc = /get_system_health_catalog|schema cache|function/i.test(
        catalogError.message,
      );
      return NextResponse.json({
        ok: false,
        checkedAt: new Date().toISOString(),
        summary: { passed: 0, failed: 1, warnings: 0, info: 0 },
        groups: [
          {
            id: "bootstrap",
            label: "Health check bootstrap",
            checks: [
              {
                id: "rpc:get_system_health_catalog",
                label: "get_system_health_catalog()",
                status: "fail",
                severity: "critical",
                message: missingCatalogRpc
                  ? "生产库缺少健康检查 catalog RPC，或 Supabase schema cache 还没有刷新。"
                  : catalogError.message,
                impact: "无法检查生产库 schema、migration、Realtime、Storage 和 trigger 状态。",
                suggestedFix:
                  "先执行 app_schema_health / system_health_consistency_checks migration，再等待 Supabase schema cache 刷新。",
                migrationName: "app_schema_health",
              },
            ],
          },
        ],
      });
    }

    const schemaCacheError = ping.error ? ping.error.message : null;
    return NextResponse.json(
      buildSystemHealthReport(catalog ?? {}, schemaCacheError, environment),
    );
  } catch (error) {
    await auditSecurityEvent(request, {
      action: "system_health.denied",
      targetType: "system_health",
      targetId: "catalog",
      reason: error instanceof Error ? error.message : "system_health_failed",
    });
    return adminErrorResponse(error);
  }
}
