import { NextRequest } from "next/server";

import {
  apiError,
  issueSessionForUser,
  jsonError,
  jsonOk,
  requireAuthUser,
} from "@/lib/accountServer";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuthUser(req);
    const body = (await req.json().catch(() => null)) as { deviceId?: string } | null;
    const session = await issueSessionForUser(user.id, body?.deviceId ?? null);
    if (!session) return jsonError("no_family", 404);
    return jsonOk({ session });
  } catch (error) {
    return apiError(error);
  }
}
