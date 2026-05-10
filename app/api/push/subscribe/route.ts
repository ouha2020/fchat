import { NextResponse } from "next/server";

import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

interface SubscribeBody {
  memberId?: unknown;
  memberToken?: unknown;
  familyId?: unknown;
  subscription?: {
    endpoint?: unknown;
    keys?: {
      p256dh?: unknown;
      auth?: unknown;
    };
  };
  platform?: unknown;
  preferences?: {
    messagesEnabled?: unknown;
    locationEnabled?: unknown;
    importantEnabled?: unknown;
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SubscribeBody;
    const member = await validateMemberCredentials(
      body.memberId,
      body.memberToken,
    );
    if (!member) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (typeof body.familyId === "string" && body.familyId !== member.family_id) {
      return NextResponse.json({ error: "family_mismatch" }, { status: 403 });
    }

    const endpoint = body.subscription?.endpoint;
    const p256dh = body.subscription?.keys?.p256dh;
    const auth = body.subscription?.keys?.auth;
    if (
      typeof endpoint !== "string" ||
      typeof p256dh !== "string" ||
      typeof auth !== "string"
    ) {
      return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("push_subscriptions").upsert(
      {
        family_id: member.family_id,
        member_id: member.member_id,
        endpoint,
        p256dh,
        auth,
        user_agent: request.headers.get("user-agent"),
        platform: normalizePlatform(body.platform),
        enabled: true,
        messages_enabled: boolOrDefault(
          body.preferences?.messagesEnabled,
          true,
        ),
        location_enabled: boolOrDefault(
          body.preferences?.locationEnabled,
          true,
        ),
        important_enabled: boolOrDefault(
          body.preferences?.importantEnabled,
          true,
        ),
        updated_at: now,
      },
      { onConflict: "member_id,endpoint" },
    );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.warn("[push subscribe]", error);
    return NextResponse.json({ error: "push_subscribe_failed" }, { status: 500 });
  }
}

function normalizePlatform(value: unknown): "ios" | "android" | "desktop" | "unknown" {
  return value === "ios" ||
    value === "android" ||
    value === "desktop" ||
    value === "unknown"
    ? value
    : "unknown";
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
