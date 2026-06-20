import { NextResponse } from "next/server";

import { ApiRequestError, badRequest, rejectMismatchedOrigin } from "@/lib/apiSecurity";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { createStorageMediaRef } from "@/lib/mediaRefs";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { AUDIO_MIME_TYPES, MAX_UPLOAD_BYTES, uploadAuthSchema } from "@/lib/validation";

export const runtime = "nodejs";

const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

export async function POST(request: Request) {
  const originError = rejectMismatchedOrigin(request);
  if (originError) return originError;

  try {
    assertMultipartSize(request);
    const form = await request.formData();
    const auth = uploadAuthSchema.parse({
      memberId: form.get("memberId"),
      memberToken: form.get("memberToken"),
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiRequestError("invalid_file", 400);

    const contentType = normalizeMime(file.type);
    if (!AUDIO_MIME_TYPES.includes(contentType as (typeof AUDIO_MIME_TYPES)[number])) {
      throw new ApiRequestError("invalid_audio_type", 400);
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      throw new ApiRequestError("audio_too_large", 413);
    }

    const member = await validateMemberCredentials(auth.memberId, auth.memberToken);
    if (!member) throw new ApiRequestError("unauthorized", 401);

    const path = `family/${member.family_id}/${crypto.randomUUID()}.${EXT_BY_MIME[contentType]}`;
    const sb = getSupabaseAdmin();
    const { error } = await sb.storage.from("chat-audios").upload(path, file, {
      contentType,
      upsert: false,
    });
    if (error) throw new ApiRequestError("upload_failed", 500);

    const ref = createStorageMediaRef("chat-audios", path);
    return NextResponse.json({ url: ref, ref });
  } catch (err) {
    return badRequest(err, "upload_failed");
  }
}

function assertMultipartSize(request: Request): void {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new ApiRequestError("invalid_content_type", 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES + 8192) {
    throw new ApiRequestError("audio_too_large", 413);
  }
}

function normalizeMime(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}
