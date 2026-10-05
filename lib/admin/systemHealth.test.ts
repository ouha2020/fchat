import { describe, expect, it } from "vitest";
import { buildSystemHealthReport } from "@/lib/admin/systemHealth";

describe("legacy family creation health check", () => {
  it("does not require the obsolete verification RPC after verification moved to the owner API", () => {
    const checks = buildSystemHealthReport({}).groups.flatMap((group) => group.checks);
    expect(checks.some((check) => check.id === "rpc:verify_pending_family_code")).toBe(false);
    expect(checks.some((check) => check.id === "rpc:create_family_with_verified_code")).toBe(true);
  });
  it.each(["PUBLIC", "anon", "authenticated"])("flags an exposed old overload for %s", (grantee) => {
    const report = buildSystemHealthReport({ routineGrants: [{ schema: "public", name: "create_family", grantee, privilege: "EXECUTE" }] });
    const row = report.groups.flatMap((group) => group.checks).find((check) => check.id === "legacy-family-creation:private");
    expect(row?.status).toBe("fail"); expect(row?.migrationName).toBe("revoke_legacy_family_creation");
  });
  it("accepts removed or private legacy overloads without requiring an obsolete function", () => {
    for (const routineGrants of [[], [{ schema: "public", name: "create_family", grantee: "service_role", privilege: "EXECUTE" }]]) {
      const report = buildSystemHealthReport({ routineGrants });
      expect(report.groups.flatMap((group) => group.checks).find((check) => check.id === "legacy-family-creation:private")?.status).toBe("pass");
    }
  });
});
