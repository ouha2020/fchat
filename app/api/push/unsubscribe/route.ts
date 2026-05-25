import { NextResponse } from "next/server";

import {
  ApiRequestError,
  badRequest,
  readJsonBody,
  rejectMismatchedOrigin,
} from "@/lib/apiSecurity";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { isSafeHttpUrl } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

interface UnsubscribeBody {
  memberId?: unknown;
  memberToken?: unknown;
  endpoint?: unknown;
}

export async function POST(request: Request) {
  try {
    const originError = rejectMismatchedOrigin(request);
    if (originError) return originError;

    const body = await readJsonBody<UnsubscribeBody>(request);
    const member = await validateMemberCredentials(
      body.memberId,
      body.memberToken,
    );
    if (!member) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const sb = getSupabaseAdmin();
    const now = new Date().toISOString();
    let query = sb
      .from("push_subscriptions")
      .update({
        enabled: false,
        disabled_at: now,
        disabled_reason: "user_unsubscribed",
        updated_at: now,
      })
      .eq("family_id", member.family_id)
      .eq("member_id", member.member_id);

    if (body.endpoint != null && !isSafeHttpUrl(body.endpoint)) {
      return NextResponse.json({ error: "invalid_endpoint" }, { status: 400 });
    }

    if (typeof body.endpoint === "string" && body.endpoint.length > 0) {
      query = query.eq("endpoint", body.endpoint);
    }

    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return badRequest(error);
    }
    console.warn("[push unsubscribe]", error);
    return NextResponse.json(
      { error: "push_unsubscribe_failed" },
      { status: 500 },
    );
  }
}
