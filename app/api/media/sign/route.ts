import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ApiRequestError,
  badRequest,
  readJsonBody,
  rejectMismatchedOrigin,
} from "@/lib/apiSecurity";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import {
  avatarStoragePathBelongsToFamily,
  createStorageMediaRef,
  resolveStorageMediaRef,
} from "@/lib/mediaRefs";
import { isSafeHttpUrl } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { memberTokenSchema, uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

const SIGNED_URL_EXPIRES_SECONDS = 5 * 60;

const signMediaSchema = z.object({
  memberId: uuidSchema,
  memberToken: memberTokenSchema,
  ref: z.string().trim().min(1).max(2048),
  messageId: uuidSchema.optional().nullable(),
  contextEventId: uuidSchema.optional().nullable(),
});

export async function POST(request: Request) {
  const originError = rejectMismatchedOrigin(request);
  if (originError) return originError;

  try {
    const input = signMediaSchema.parse(await readJsonBody<unknown>(request));
    const media = resolveStorageMediaRef(input.ref);
    if (!media) throw new ApiRequestError("invalid_media_ref", 400);
    const storageRef = createStorageMediaRef(media.bucket, media.path);
    const acceptedRefs = Array.from(new Set([input.ref, storageRef]));

    const member = await validateMemberCredentials(
      input.memberId,
      input.memberToken,
    );
    if (!member) throw new ApiRequestError("unauthorized", 401);

    const sb = getSupabaseAdmin();
    if (input.messageId) {
      await assertMessageMediaVisible({
        familyId: member.family_id,
        memberId: member.member_id,
        messageId: input.messageId,
        acceptedRefs,
      });
    } else if (input.contextEventId) {
      await assertContextMediaVisible({
        familyId: member.family_id,
        memberId: member.member_id,
        contextEventId: input.contextEventId,
        acceptedRefs,
      });
    } else if (!avatarStoragePathBelongsToFamily(media.path, member.family_id)) {
      throw new ApiRequestError("forbidden", 403);
    }

    const { data, error } = await sb.storage
      .from(media.bucket)
      .createSignedUrl(media.path, SIGNED_URL_EXPIRES_SECONDS);
    if (error || !data?.signedUrl || !isSafeHttpUrl(data.signedUrl)) {
      throw new ApiRequestError("media_sign_failed", 500);
    }

    return NextResponse.json({
      url: data.signedUrl,
      expiresIn: SIGNED_URL_EXPIRES_SECONDS,
    });
  } catch (err) {
    return badRequest(err, "media_sign_failed");
  }
}

async function assertMessageMediaVisible({
  familyId,
  memberId,
  messageId,
  acceptedRefs,
}: {
  familyId: string;
  memberId: string;
  messageId: string;
  acceptedRefs: string[];
}) {
  const sb = getSupabaseAdmin();
  const { data: recipient, error: recipientError } = await sb
    .from("message_recipients")
    .select("message_id")
    .eq("family_id", familyId)
    .eq("member_id", memberId)
    .eq("message_id", messageId)
    .maybeSingle();
  if (recipientError) throw new ApiRequestError("media_sign_failed", 500);
  if (!recipient) throw new ApiRequestError("forbidden", 403);

  const { data: message, error: messageError } = await sb
    .from("messages")
    .select("image_url,audio_url")
    .eq("family_id", familyId)
    .eq("id", messageId)
    .maybeSingle();
  if (messageError) throw new ApiRequestError("media_sign_failed", 500);
  if (
    !message ||
    (!acceptedRefs.includes(message.image_url ?? "") &&
      !acceptedRefs.includes(message.audio_url ?? ""))
  ) {
    throw new ApiRequestError("forbidden", 403);
  }
}

async function assertContextMediaVisible({
  familyId,
  memberId,
  contextEventId,
  acceptedRefs,
}: {
  familyId: string;
  memberId: string;
  contextEventId: string;
  acceptedRefs: string[];
}) {
  const sb = getSupabaseAdmin();
  const { data: recipient, error: recipientError } = await sb
    .from("family_context_event_recipients")
    .select("event_id")
    .eq("family_id", familyId)
    .eq("member_id", memberId)
    .eq("event_id", contextEventId)
    .maybeSingle();
  if (recipientError) throw new ApiRequestError("media_sign_failed", 500);
  if (!recipient) throw new ApiRequestError("forbidden", 403);

  const { data: event, error: eventError } = await sb
    .from("family_context_events")
    .select("audio_url")
    .eq("family_id", familyId)
    .eq("id", contextEventId)
    .maybeSingle();
  if (eventError) throw new ApiRequestError("media_sign_failed", 500);
  if (!event || !acceptedRefs.includes(event.audio_url ?? "")) {
    throw new ApiRequestError("forbidden", 403);
  }
}
