import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => ({ from: mocks.from }) }));
vi.mock("@/lib/accountServer", async (original) => ({ ...await original<typeof import("@/lib/accountServer")>(),
  sendRecoveredFamilyCodeEmail: mocks.send }));
import { POST } from "@/app/api/auth/resend-existing-family-code/route";

let lastSent: string | null;
let countError: boolean;
let attemptFailure: boolean;
let count: number;
let attempts: number;
function request() {
  return POST(new NextRequest("http://localhost/api/auth/resend-existing-family-code", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "test@example.test" }) }));
}
beforeEach(() => {
  vi.clearAllMocks(); lastSent = null; countError = false; attemptFailure = false; count = 0; attempts = 0;
  mocks.send.mockResolvedValue(undefined);
  mocks.from.mockImplementation((table: string) => {
    let action = "read"; let counting = false;
    let changes: Record<string, unknown> = {};
    const filters = new Map<string, unknown>();
    const result = () => {
      if (counting) return { count, data: null, error: countError ? new Error("private db detail") : null };
      if (table === "families") {
        if (action === "read") return { data: { id: "family-one", family_code: "TESTONLY", family_code_email_sent_at: lastSent }, error: null };
        if (filters.get("family_code_email_sent_at") !== lastSent) return { data: [], error: null };
        lastSent = changes.family_code_email_sent_at as string; return { data: [{ id: "family-one" }], error: null };
      }
      if (action === "insert") {
        if (attemptFailure) return { data: null, error: new Error("private db detail") };
        attempts += 1; return { data: { id: `attempt-${attempts}` }, error: null };
      }
      return { data: null, error: null };
    };
    const query = { select: (_columns: string, options?: { count: string }) => { counting = !!options; return query; },
      eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
      is: (key: string, value: unknown) => { filters.set(key, value); return query; },
      gte: () => query, order: () => query, limit: () => query,
      insert: () => { action = "insert"; return query; },
      update: (value: Record<string, unknown>) => { action = "update"; changes = value; return query; },
      maybeSingle: async () => result(), single: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve) };
    return query;
  });
});
describe("family code recovery abuse protection", () => {
  it("atomically sends once for concurrent requests and keeps public responses identical", async () => {
    const results = await Promise.all([request(), request()]);
    expect(mocks.send).toHaveBeenCalledOnce();
    for (const result of results) expect(await result.json()).toEqual({ ok: true });
  });
  it.each(["count", "attempt"])("does not send when %s recording fails", async (phase) => {
    countError = phase === "count"; attemptFailure = phase === "attempt";
    const response = await request();
    expect(response.status).toBe(500); expect(mocks.send).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "network_error" });
  });
  it("does not grow the attempt table for requests already beyond the quota", async () => {
    count = 3;
    expect((await request()).status).toBe(200); expect(attempts).toBe(0); expect(mocks.send).not.toHaveBeenCalled();
  });
});
