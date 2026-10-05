import { NextResponse } from "next/server";

const DEFAULT_MAX_JSON_BYTES = 16 * 1024;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function rejectMismatchedOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  try {
    if (new URL(origin).origin === new URL(request.url).origin) return null;
  } catch {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
}

export async function readJsonBody<T>(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiRequestError("invalid_content_type", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    throw new ApiRequestError("request_too_large", 413);
  }

  // Enforce the limit while reading: Content-Length can be absent or forged.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          void reader.cancel().catch(() => undefined);
          throw new ApiRequestError("request_too_large", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as T;
  } catch {
    throw new ApiRequestError("invalid_json", 400);
  }
}

export function badRequest(error: unknown, fallback = "invalid_request") {
  if (error instanceof ApiRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: fallback }, { status: 400 });
}
