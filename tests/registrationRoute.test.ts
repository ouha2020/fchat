import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), code: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => ({ auth: { admin: { createUser: mocks.create } } }) }));
vi.mock("@/lib/accountServer", async (original) => ({ ...await original<typeof import("@/lib/accountServer")>(),
  ensurePendingFamilyCode: mocks.code }));
import { POST } from "@/app/api/auth/register/route";

function request(email: unknown = "invited@example.test", extra: Record<string, string> = {}) {
  return POST(new NextRequest("http://localhost/api/auth/register", { method: "POST",
    headers: { "content-type": "application/json", ...extra },
    body: JSON.stringify({ email, password: "synthetic-password" }) }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FAMILY_REGISTRATION_ALLOWED_EMAILS", "invited@example.test, second@example.test");
  mocks.create.mockResolvedValue({ data: { user: { id: "invited-owner" } }, error: null });
  mocks.code.mockResolvedValue({ status: "sent" });
});
afterEach(() => vi.unstubAllEnvs());
describe("invited owner registration", () => {
  it("only creates an approved owner and sends the existing verification code", async () => {
    const response = await request("  INVITED@example.test  ");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ email: "invited@example.test" }));
    expect(mocks.code).toHaveBeenCalledWith("invited-owner", "invited@example.test", true);
  });
  it.each(["uninvited@example.test", "invited@example.test.attacker", "second@other.test"])("denies %s without creating users or sending email", async (email) => {
    expect((await request(email)).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.code).not.toHaveBeenCalled();
  });
  it("keeps signup closed when no invitations are configured", async () => {
    vi.stubEnv("FAMILY_REGISTRATION_ALLOWED_EMAILS", "");
    expect((await request()).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects large, non-string, and cross-origin input before creating users", async () => {
    expect((await request({ value: "invited@example.test" })).status).toBe(400);
    expect((await request("a".repeat(20_000))).status).toBe(413);
    expect((await request(undefined, { origin: "https://unrelated.example.test" })).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
