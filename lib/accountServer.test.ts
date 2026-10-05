import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => ({ from: mocks.from }) }));
import { ensurePendingFamilyCode, sendFamilyCodeEmail, apiError } from "@/lib/accountServer";

let pending: { id: string; updated_at: string; expires_at: string; status: string; family_code: string };
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  pending = { id: "code-one", updated_at: new Date(Date.now() - 120_000).toISOString(),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(), status: "pending", family_code: "TESTONLY" };
  vi.stubEnv("RESEND_API_KEY", "synthetic-key"); vi.stubEnv("EMAIL_FROM", "test@example.test");
  vi.stubGlobal("fetch", fetcher); fetcher.mockImplementation(async () => new Response(null, { status: 200 }));
  mocks.from.mockImplementation(() => {
    let update: { updated_at: string } | null = null;
    const filters = new Map<string, unknown>();
    const result = () => {
      if (!update) return { data: [{ ...pending }], error: null };
      if (filters.get("updated_at") !== pending.updated_at) return { data: [], error: null };
      pending.updated_at = update.updated_at; return { data: [{ id: pending.id }], error: null };
    };
    const query = { select: () => query, in: () => query, order: () => query, limit: () => query,
      update: (value: { updated_at: string }) => { update = value; return query; },
      eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve) };
    return query;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("family verification email protection", () => {
  it("uses a database compare-and-set to send only once for concurrent resend requests", async () => {
    const results = await Promise.allSettled([ensurePendingFamilyCode("owner", "test@example.test", true),
      ensurePendingFamilyCode("owner", "test@example.test", true)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("retains a pending code without sending and rejects immediate resends", async () => {
    pending.updated_at = new Date().toISOString();
    expect((await ensurePendingFamilyCode("owner", "test@example.test", false)).status).toBe("pending");
    await expect(ensurePendingFamilyCode("owner", "test@example.test", true)).rejects.toThrow("rate_limited");
    expect(fetcher).not.toHaveBeenCalled(); expect(apiError(new Error("rate_limited")).status).toBe(429);
  });
  it("does not log provider response bodies that may contain private data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetcher.mockResolvedValue(new Response("private-email-content", { status: 500 }));
    await expect(sendFamilyCodeEmail("test@example.test", "TESTONLY")).rejects.toThrow("email_send_failed");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-email-content");
  });
});
