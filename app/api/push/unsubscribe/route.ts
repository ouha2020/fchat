import { NextResponse } from "next/server";

import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

interface UnsubscribeBody {
  memberId?: unknown;
  memberToken?: unknown;
  endpoint?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UnsubscribeBody;
    const member = await validateMemberCredentials(
      body.memberId,
      body.memberToken,
    );
    if (!member) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const sb = getSupabaseAdmin();
    let query = sb
      .from("push_subscriptions")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("family_id", member.family_id)
      .eq("member_id", member.member_id);

    if (typeof body.endpoint === "string" && body.endpoint.length > 0) {
      query = query.eq("endpoint", body.endpoint);
    }

    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.warn("[push unsubscribe]", error);
    return NextResponse.json(
      { error: "push_unsubscribe_failed" },
      { status: 500 },
    );
  }
}
