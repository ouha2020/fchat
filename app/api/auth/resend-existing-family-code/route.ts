import { createHash } from "crypto";
import { NextRequest } from "next/server";

import {
  apiError,
  jsonOk,
  normalizeEmail,
  sendRecoveredFamilyCodeEmail,
  validEmail,
} from "@/lib/accountServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requestIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
    const email = normalizeEmail(body?.email);
    if (!email) throw new Error("email_required");
    if (!validEmail(email)) throw new Error("invalid_email");

    const sb = getSupabaseAdmin();
    const emailHash = sha256(email);
    const ipHash = sha256(requestIp(req));
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const [{ count: emailCount }, { count: ipCount }] = await Promise.all([
      sb
        .from("family_code_recovery_attempts")
        .select("id", { count: "exact", head: true })
        .eq("email_hash", emailHash)
        .gte("created_at", since),
      sb
        .from("family_code_recovery_attempts")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", since),
    ]);

    if ((emailCount ?? 0) >= 3 || (ipCount ?? 0) >= 10) {
      await sb.from("family_code_recovery_attempts").insert({
        email_hash: emailHash,
        ip_hash: ipHash,
        sent: false,
      });
      return jsonOk({ ok: true });
    }

    const { data: family, error } = await sb
      .from("families")
      .select("id, family_code")
      .eq("owner_email", email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    let sent = false;
    if (family?.family_code) {
      await sendRecoveredFamilyCodeEmail(email, family.family_code);
      sent = true;
      await sb
        .from("families")
        .update({ family_code_email_sent_at: new Date().toISOString() })
        .eq("id", family.id);
    }

    await sb.from("family_code_recovery_attempts").insert({
      email_hash: emailHash,
      ip_hash: ipHash,
      sent,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
