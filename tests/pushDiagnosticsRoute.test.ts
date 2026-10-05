import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ validate: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/memberAuthServer", () => ({ validateMemberCredentials: mocks.validate }));
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => ({ from: mocks.from }) }));
import { POST } from "@/app/api/push/diagnostics/route";

const member = { member_id: "member-one", family_id: "family-one" };
let filters: [string, unknown][];
function request(body: unknown, origin = "http://localhost:3101") {
  return POST(new Request("http://localhost:3101/api/push/diagnostics", { method: "POST",
    headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }));
}
beforeEach(() => {
  vi.clearAllMocks(); filters = [];
  mocks.validate.mockResolvedValue(member);
  mocks.from.mockImplementation((table: string) => {
    const result = { data: table === "push_subscriptions" ? [{ id: "subscription-one",
      endpoint: "https://push.example.test/private-endpoint-credential", enabled: true }] : null, error: null };
    const query = { select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      order: async () => result, maybeSingle: async () => result };
    return query;
  });
});
describe("private Push diagnostics", () => {
  it("checks the body credentials, scopes both queries, and returns only endpoint summaries", async () => {
    const response = await request({ memberId: member.member_id, memberToken: "synthetic-body-credential" });
    expect(mocks.validate).toHaveBeenCalledWith(member.member_id, "synthetic-body-credential");
    expect(filters).toEqual([["family_id", member.family_id], ["member_id", member.member_id],
      ["family_id", member.family_id], ["member_id", member.member_id]]);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const payload = await response.text();
    expect(payload).toContain("push.example.test");
    expect(payload).not.toContain("private-endpoint-credential");
    expect(payload).not.toContain("synthetic-body-credential");
  });
  it("rejects revoked members before querying diagnostics", async () => {
    mocks.validate.mockResolvedValue(null);
    expect((await request({ memberId: "removed", memberToken: "invalid" })).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and oversized requests before authentication", async () => {
    expect((await request({}, "https://unrelated.example.test")).status).toBe(403);
    expect((await request({ memberToken: "x".repeat(20_000) })).status).toBe(413);
    expect(mocks.validate).not.toHaveBeenCalled();
  });
  it("hides server errors and rejects null inputs", async () => {
    expect((await request(null)).status).toBe(400);
    mocks.validate.mockRejectedValue(new Error("private database detail"));
    const response = await request({});
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "diagnostics_failed" });
  });
});
