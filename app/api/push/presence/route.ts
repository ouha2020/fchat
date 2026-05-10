import { NextResponse } from "next/server";

import {
  ApiRequestError,
  badRequest,
  readJsonBody,
  rejectMismatchedOrigin,
} from "@/lib/apiSecurity";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { normalizePresencePage } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

interface PresenceBody {
  memberId?: unknown;
  memberToken?: unknown;
  currentPage?: unknown;
  isActive?: unknown;
}

export async function POST(request: Request) {
  try {
    const originError = rejectMismatchedOrigin(request);
    if (originError) return originError;

    const body = await readJsonBody<PresenceBody>(request);
    const member = await validateMemberCredentials(
      body.memberId,
      body.memberToken,
    );
    if (!member) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const now = new Date().toISOString();
    const { error } = await getSupabaseAdmin().from("user_presence").upsert(
      {
        family_id: member.family_id,
        member_id: member.member_id,
        current_page: normalizePresencePage(body.currentPage),
        is_active: typeof body.isActive === "boolean" ? body.isActive : true,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: "family_id,member_id" },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return badRequest(error);
    }
    console.warn("[push presence]", error);
    return NextResponse.json({ error: "presence_failed" }, { status: 500 });
  }
}
