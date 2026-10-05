import { readJsonBody, rejectMismatchedOrigin } from "@/lib/apiSecurity";
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
  const originError = rejectMismatchedOrigin(req);
  if (originError) return originError;
  try {
    const body = (await readJsonBody(req)) as { email?: unknown } | null;
    const email = normalizeEmail(body?.email);
    if (!email) throw new Error("email_required");
    if (!validEmail(email)) throw new Error("invalid_email");

    const sb = getSupabaseAdmin();
    const emailHash = sha256(email);
    const ipHash = sha256(requestIp(req));
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const [{ count: emailCount, error: emailError }, { count: ipCount, error: ipError }] = await Promise.all([
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
    if (emailError || ipError) throw emailError ?? ipError;

    if ((emailCount ?? 0) >= 3 || (ipCount ?? 0) >= 10) {
      return jsonOk({ ok: true });
    }

    const { data: attempt, error: attemptError } = await sb.from("family_code_recovery_attempts")
      .insert({ email_hash: emailHash, ip_hash: ipHash, sent: false }).select("id").single();
    if (attemptError || !attempt) throw attemptError ?? new Error("recovery_failed");

    const { data: family, error } = await sb
      .from("families")
      .select("id, family_code, family_code_email_sent_at")
      .eq("owner_email", email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (family?.family_code) {
      const lastSent = family.family_code_email_sent_at;
      if (lastSent && Date.now() - new Date(lastSent).getTime() < 60_000) return jsonOk({ ok: true });
      let claim = sb.from("families").update({ family_code_email_sent_at: new Date().toISOString() })
        .eq("id", family.id);
      claim = lastSent ? claim.eq("family_code_email_sent_at", lastSent) : claim.is("family_code_email_sent_at", null);
      const { data: claimed, error: claimError } = await claim.select("id");
      if (claimError) throw claimError;
      if (!claimed?.length) return jsonOk({ ok: true });
      await sendRecoveredFamilyCodeEmail(email, family.family_code);
      const { error: markError } = await sb.from("family_code_recovery_attempts")
        .update({ sent: true }).eq("id", attempt.id);
      if (markError) throw markError;
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
