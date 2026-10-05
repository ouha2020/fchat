import { NextResponse } from "next/server";

import { badRequest, readJsonBody, rejectMismatchedOrigin } from "@/lib/apiSecurity";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { summarizePushEndpoint } from "@/lib/pushEndpointServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = rejectMismatchedOrigin(request);
  if (originError) return originError;

  let body: { memberId?: unknown; memberToken?: unknown };
  try {
    body = await readJsonBody(request);
    if (!body || typeof body !== "object") return badRequest(null);
  } catch (error) {
    return badRequest(error);
  }

  try {
    return await diagnostics(body.memberId, body.memberToken);
  } catch {
    return NextResponse.json({ error: "diagnostics_failed" }, { status: 500 });
  }
}

async function diagnostics(memberId: unknown, memberToken: unknown) {
  const member = await validateMemberCredentials(memberId, memberToken);
  if (!member) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  const { data: subscriptions, error } = await sb
    .from("push_subscriptions")
    .select(
      "id, endpoint, platform, enabled, messages_enabled, location_enabled, important_enabled, last_notified_at, disabled_at, disabled_reason, created_at, updated_at",
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
    subscriptions: (subscriptions ?? []).map((sub) => {
      const summary = summarizePushEndpoint(sub.endpoint);
      return {
        id: sub.id,
        endpointHost: summary.endpointHost,
        endpointFingerprint: summary.endpointFingerprint,
        platform: sub.platform,
        enabled: sub.enabled,
        messages_enabled: sub.messages_enabled,
        location_enabled: sub.location_enabled,
        important_enabled: sub.important_enabled,
        last_notified_at: sub.last_notified_at,
        disabled_at: sub.disabled_at,
        disabled_reason: sub.disabled_reason,
        created_at: sub.created_at,
        updated_at: sub.updated_at,
      };
    }),
    presence: presence ?? null,
    memberId: member.member_id,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
