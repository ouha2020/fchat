import { readJsonBody, rejectMismatchedOrigin } from "@/lib/apiSecurity";
import { NextRequest } from "next/server";

import {
  apiError,
  ensurePendingFamilyCode,
  issueSessionForUser,
  jsonOk,
  requireAuthUser,
} from "@/lib/accountServer";
import { isRegistrationAllowed } from "@/lib/registrationServer";

export async function POST(req: NextRequest) {
  const originError = rejectMismatchedOrigin(req);
  if (originError) return originError;
  try {
    const { user, email } = await requireAuthUser(req);
    const body = (await readJsonBody(req)) as { resend?: boolean; deviceId?: string } | null;

    const session = await issueSessionForUser(user.id, body?.deviceId ?? null);
    if (session) return jsonOk({ status: "has_family", session });
    if (!isRegistrationAllowed(email)) throw new Error("registration_invite_required");

    const pending = await ensurePendingFamilyCode(user.id, email, Boolean(body?.resend));
    return jsonOk({ status: pending.status });
  } catch (error) {
    return apiError(error);
  }
}
