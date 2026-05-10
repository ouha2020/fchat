import { z } from "zod";

import type { FamilyRole } from "@/types/family";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const AUDIO_MIME_TYPES = ["audio/webm", "audio/mp4", "audio/ogg"] as const;

export const familyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,12}$/, "invalid_family_code");

export const nicknameSchema = z
  .string()
  .trim()
  .min(1, "nickname_required")
  .max(20, "nickname_too_long");

export const roleSchema = z.enum(["father", "mother", "child"]);

export const uuidSchema = z.string().uuid("invalid_id");

export const memberTokenSchema = z
  .string()
  .regex(
    /^([0-9a-f]{48}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
    "invalid_token",
  );

export const deviceIdSchema = z
  .string()
  .uuid("invalid_device_id")
  .optional()
  .nullable();

export const familyNameSchema = z
  .string()
  .trim()
  .min(1, "family_name_required")
  .max(30, "family_name_too_long");

export const adminPasswordSchema = z
  .string()
  .min(4, "admin_password_too_short")
  .max(128, "admin_password_too_long");

export const textMessageSchema = z
  .string()
  .trim()
  .min(1, "message_empty")
  .max(1000, "message_too_long");

export const imageFileSchema = z
  .instanceof(File)
  .refine((file) => file.size > 0 && file.size <= MAX_UPLOAD_BYTES, {
    message: "image_too_large",
  })
  .refine((file) => IMAGE_MIME_TYPES.includes(file.type as (typeof IMAGE_MIME_TYPES)[number]), {
    message: "invalid_image_type",
  });

export const audioBlobSchema = z
  .instanceof(Blob)
  .refine((blob) => blob.size > 0 && blob.size <= MAX_UPLOAD_BYTES, {
    message: "audio_too_large",
  });

export const uploadAuthSchema = z.object({
  memberId: uuidSchema,
  memberToken: memberTokenSchema,
});

export function parseFamilyRole(value: unknown): FamilyRole {
  return roleSchema.parse(value);
}

export function zodErrorMessage(error: unknown): string | null {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "invalid_input";
  }
  return null;
}
