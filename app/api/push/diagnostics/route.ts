import { NextResponse } from "next/server";

import { rejectMismatchedOrigin } from "@/lib/apiSecurity";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const originError = rejectMismatchedOrigin(request);
  if (originError) return originError;

  const url = new URL(request.url);
  const memberId = url.searchParams.get("memberId");
  const memberToken = url.searchParams.get("memberToken");

  const member = await validateMemberCredentials(memberId, memberToken);
  if (!member) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  const { data: subscriptions, error } = await sb
    .from("push_subscriptions")
    .select(
      "id, endpoint, platform, enabled, messages_enabled, location_enabled, important_enabled, last_notified_at, created_at, updated_at",
    )
    .eq("family_id", member.family_id)
    .eq("member_id", member.member_id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const { data: presence } = await sb
    .from("user_presence")
    .select("current_page, is_active, last_seen_at")
    .eq("family_id", member.family_id)
    .eq("member_id", member.member_id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    subscriptions: subscriptions ?? [],
    presence: presence ?? null,
    memberId: member.member_id,
  });
}
