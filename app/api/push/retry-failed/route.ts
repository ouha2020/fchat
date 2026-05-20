import { NextResponse } from "next/server";

import { rejectMismatchedOrigin } from "@/lib/apiSecurity";
import { retryFailedPushNotifications } from "@/lib/pushMessageServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = rejectMismatchedOrigin(request);
  if (originError) return originError;

  const authError = requireFlushSecret(request);
  if (authError) return authError;

  try {
    const result = await retryFailedPushNotifications();
    return NextResponse.json(result);
  } catch (error) {
    console.warn(
      "[push retry-failed]",
      error instanceof Error ? error.message : "push_retry_failed",
    );
    return NextResponse.json({ ok: false, error: "push_retry_failed" }, { status: 500 });
  }
}

function requireFlushSecret(request: Request): NextResponse | null {
  const secret = process.env.PUSH_FLUSH_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "push_flush_not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
