import { readJsonBody, rejectMismatchedOrigin } from "@/lib/apiSecurity";
import { NextRequest } from "next/server";

import {
  apiError,
  ensurePendingFamilyCode,
  jsonError,
  jsonOk,
  normalizeEmail,
  validEmail,
  validPassword,
} from "@/lib/accountServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isRegistrationAllowed } from "@/lib/registrationServer";

export async function POST(req: NextRequest) {
  const originError = rejectMismatchedOrigin(req);
  if (originError) return originError;
  try {
    const body = (await readJsonBody(req)) as {
      email?: unknown;
      password?: unknown;
    } | null;
    const email = normalizeEmail(body?.email);
    const password = String(body?.password ?? "");

    if (!email) return jsonError("email_required");
    if (!validEmail(email)) return jsonError("invalid_email");
    if (!password) return jsonError("password_required");
    if (!validPassword(password)) return jsonError("password_too_short");
    if (!isRegistrationAllowed(email)) return jsonError("registration_invite_required", 403);

    const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { source: "family-chat" },
    });
    if (error || !data.user) throw error ?? new Error("register_failed");

    await ensurePendingFamilyCode(data.user.id, email, true);
    return jsonOk({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
