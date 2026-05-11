import { NextResponse } from "next/server";

import {
  ApiRequestError,
  badRequest,
  readJsonBody,
  rejectMismatchedOrigin,
} from "@/lib/apiSecurity";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import {
  isBase64UrlLike,
  isSafeHttpUrl,
  isUuid,
  truncateText,
} from "@/lib/security";
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
    const originError = rejectMismatchedOrigin(request);
    if (originError) return originError;

    const body = await readJsonBody<SubscribeBody>(request);
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
    if (body.familyId != null && !isUuid(body.familyId)) {
      return NextResponse.json({ error: "invalid_family_id" }, { status: 400 });
    }

    const endpoint = body.subscription?.endpoint;
    const p256dh = body.subscription?.keys?.p256dh;
    const auth = body.subscription?.keys?.auth;
    if (
      !isSafeHttpUrl(endpoint) ||
      !isBase64UrlLike(p256dh, 32, 512) ||
      !isBase64UrlLike(auth, 16, 256)
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
        user_agent: truncateText(request.headers.get("user-agent"), 512),
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
          false,
        ),
        updated_at: now,
      },
      { onConflict: "member_id,endpoint" },
    );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return badRequest(error);
    }
    console.warn(
      "[push subscribe]",
      error instanceof Error ? error.message : "push_subscribe_failed",
    );
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
