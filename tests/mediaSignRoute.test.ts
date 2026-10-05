import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ validate: vi.fn(), from: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/memberAuthServer", () => ({ validateMemberCredentials: mocks.validate }));
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => ({ from: mocks.from,
  storage: { from: () => ({ createSignedUrl: mocks.sign }) } }) }));
import { POST } from "@/app/api/media/sign/route";

const family = "10000000-0000-4000-8000-000000000001";
const a = "20000000-0000-4000-8000-000000000001";
const b = "20000000-0000-4000-8000-000000000002";
const c = "20000000-0000-4000-8000-000000000003";
const messageId = "40000000-0000-4000-8000-000000000001";
const eventId = "50000000-0000-4000-8000-000000000001";
const ref = `storage://chat-images/family/${family}/fixture.png`;
const audioRef = `storage://chat-audios/family/${family}/fixture.webm`;
type Row = Record<string, unknown>;
let rows: Record<string, Row[]>;

// The real route builds the constraints; the fixture applies them like a database query.
function query(table: string) {
  let found = rows[table] ?? [];
  const result = () => ({ data: found, error: null });
  const builder = {
    select: (_columns: string) => builder,
    eq: (key: string, value: unknown) => { found = found.filter((row) => row[key] === value); return builder; },
    in: (key: string, values: unknown[]) => { found = found.filter((row) => values.includes(row[key])); return builder; },
    limit: (limit: number) => { found = found.slice(0, limit); return builder; },
    maybeSingle: async () => ({ data: found[0] ?? null, error: null }),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return builder;
}
async function request(memberId = a, input: Row = { ref, messageId }) {
  mocks.validate.mockResolvedValue({ member_id: memberId, family_id: family, is_admin: memberId === c });
  return POST(new Request("http://localhost:3101/api/media/sign", { method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3101" },
    body: JSON.stringify({ memberId, memberToken: "a".repeat(48), ...input }) }));
}

describe("media signing server authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation(query);
    mocks.sign.mockResolvedValue({ data: { signedUrl: "https://media.test/fixture" }, error: null });
    rows = {
      message_recipients: [a, b].map((member_id) => ({ family_id: family, member_id, message_id: messageId })),
      messages: [{ id: messageId, family_id: family, image_url: ref, audio_url: null }],
      family_context_event_recipients: [a, b].map((member_id) => ({ family_id: family, member_id, event_id: eventId })),
      family_context_events: [{ id: eventId, family_id: family, audio_url: audioRef }], album_items: [],
    };
  });

  it.each([a, b])("allows a whisper participant %s to sign the matching media", async (memberId) => {
    expect((await request(memberId)).status).toBe(200);
    expect(mocks.sign).toHaveBeenCalledWith(`family/${family}/fixture.png`, 300);
  });
  it("denies a nonparticipant administrator without calling storage signing", async () => {
    expect((await request(c)).status).toBe(403); expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("denies a same-family ref without a message recipient or album authorization", async () => {
    expect((await request(c, { ref })).status).toBe(403); expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("denies a different reference even for a recipient", async () => {
    expect((await request(a, { ref: ref.replace("fixture.png", "other.png"), messageId })).status).toBe(403);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("checks a schedule record recipient before signing private audio", async () => {
    expect((await request(b, { ref: audioRef, contextEventId: eventId })).status).toBe(200);
    mocks.sign.mockClear();
    expect((await request(c, { ref: audioRef, contextEventId: eventId })).status).toBe(403);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("rejects removed or invalid members before querying any media", async () => {
    mocks.validate.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost:3101/api/media/sign", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: c, memberToken: "a".repeat(48), ref, messageId }) }));
    expect(response.status).toBe(401); expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("rejects rows from a different family and hides storage errors", async () => {
    rows.message_recipients[0].family_id = "10000000-0000-4000-8000-000000000002";
    expect((await request(a)).status).toBe(403); expect(mocks.sign).not.toHaveBeenCalled();
    mocks.sign.mockResolvedValue({ data: null, error: new Error("private-storage-detail") });
    const response = await request(b);
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "media_sign_failed" });
  });
});
