import { NextRequest } from "next/server";

import {
  apiError,
  ensurePendingFamilyCode,
  issueSessionForUser,
  jsonOk,
  requireAuthUser,
} from "@/lib/accountServer";

export async function POST(req: NextRequest) {
  try {
    const { user, email } = await requireAuthUser(req);
    const body = (await req.json().catch(() => null)) as { resend?: boolean; deviceId?: string } | null;

    const session = await issueSessionForUser(user.id, body?.deviceId ?? null);
    if (session) return jsonOk({ status: "has_family", session });

    const pending = await ensurePendingFamilyCode(user.id, email, Boolean(body?.resend));
    return jsonOk({ status: pending.status });
  } catch (error) {
    return apiError(error);
  }
}
