import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, readJsonBody } from "@/lib/apiSecurity";

function streamRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === chunks.length) controller.close();
      else controller.enqueue(chunks[index++]);
    }, cancel,
  }, { highWaterMark: 0 });
  const request = new Request("http://localhost/api/example", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body,
    duplex: "half",
  } as RequestInit);
  return { request, cancel, readCount: () => index };
}

describe("bounded JSON requests", () => {
  it.each<Record<string, string>>([{}, { "content-length": "1" }])("stops oversized streaming bodies even with an absent or forged length", async (headers) => {
    const { request, cancel, readCount } = streamRequest([new Uint8Array(5), new Uint8Array(5), new Uint8Array(100)], headers);
    await expect(readJsonBody(request, 8)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(readCount()).toBe(2);
  });
  it("decodes split multibyte characters at the exact byte limit", async () => {
    const bytes = new TextEncoder().encode('{"name":"家"}');
    const { request } = streamRequest([bytes.slice(0, 10), bytes.slice(10)]);
    expect(await readJsonBody(request, bytes.length)).toEqual({ name: "家" });
  });
  it("rejects malformed UTF-8, invalid JSON, and non-JSON inputs", async () => {
    await expect(readJsonBody(streamRequest([new Uint8Array([255])]).request)).rejects.toMatchObject({ status: 400 });
    await expect(readJsonBody(streamRequest([new TextEncoder().encode("{")]).request)).rejects.toBeInstanceOf(ApiRequestError);
    await expect(readJsonBody(streamRequest([], { "content-type": "text/plain" }).request)).rejects.toMatchObject({ status: 415 });
  });
});
