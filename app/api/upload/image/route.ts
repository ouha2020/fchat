import { NextResponse } from "next/server";

import { ApiRequestError, badRequest, rejectMismatchedOrigin } from "@/lib/apiSecurity";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { isSafeHttpUrl } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES, uploadAuthSchema } from "@/lib/validation";

export const runtime = "nodejs";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
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
    if (!IMAGE_MIME_TYPES.includes(contentType as (typeof IMAGE_MIME_TYPES)[number])) {
      throw new ApiRequestError("invalid_image_type", 400);
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      throw new ApiRequestError("image_too_large", 413);
    }

    const member = await validateMemberCredentials(auth.memberId, auth.memberToken);
    if (!member) throw new ApiRequestError("unauthorized", 401);

    const path = `family/${member.family_id}/${crypto.randomUUID()}.${EXT_BY_MIME[contentType]}`;
    const sb = getSupabaseAdmin();
    const { error } = await sb.storage.from("chat-images").upload(path, file, {
      contentType,
      upsert: false,
    });
    if (error) throw new ApiRequestError("upload_failed", 500);

    const { data } = sb.storage.from("chat-images").getPublicUrl(path);
    if (!isSafeHttpUrl(data.publicUrl)) throw new ApiRequestError("upload_failed", 500);
    return NextResponse.json({ url: data.publicUrl });
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
    throw new ApiRequestError("image_too_large", 413);
  }
}

function normalizeMime(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}
