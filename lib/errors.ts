import {
  getStoredLanguage,
  translate,
  type Language,
  type TranslationKey,
} from "@/lib/i18n";

const ERROR_MAP: Record<string, TranslationKey> = {
  family_name_required: "error_family_name_required",
  admin_password_too_short: "error_admin_password_too_short",
  nickname_required: "error_nickname_required",
  invalid_role: "error_invalid_role",
  family_code_required: "error_family_code_required",
  invalid_family_code: "error_invalid_family_code",
  rate_limited: "error_rate_limited",
  family_not_found: "error_family_not_found",
  join_disabled: "error_join_disabled",
  nickname_taken: "error_nickname_taken",
  unauthorized: "error_unauthorized",
  not_admin: "error_not_admin",
  invalid_admin_password: "error_invalid_admin_password",
  member_not_found: "error_member_not_found",
  last_admin_cannot_leave: "error_last_admin_cannot_leave",
  cannot_remove_self: "error_cannot_remove_self",
  invalid_message_type: "error_invalid_message_type",
  invalid_effect_id: "error_invalid_effect_id",
  message_not_found: "error_message_not_found",
  important_notification_not_found: "error_important_notification_not_found",
  cannot_delete_system: "error_cannot_delete_system",
  not_allowed: "error_not_allowed",
  cannot_whisper_self: "error_cannot_whisper_self",
  private_message_not_allowed: "error_private_message_not_allowed",
  schedule_title_required: "error_schedule_title_required",
  schedule_title_too_long: "error_schedule_title_too_long",
  invalid_schedule_type: "error_invalid_schedule_type",
  invalid_schedule_visibility: "error_invalid_schedule_visibility",
  invalid_schedule_time: "error_invalid_schedule_time",
  invalid_schedule_range: "error_invalid_schedule_range",
  invalid_schedule_status: "error_invalid_schedule_status",
  schedule_item_not_found: "error_schedule_item_not_found",
  invalid_schedule_scope: "error_invalid_schedule_scope",
  invalid_schedule_filter: "error_invalid_schedule_filter",
  invalid_schedule_search: "error_invalid_schedule_search",
  schedule_comment_required: "error_schedule_comment_required",
  schedule_comment_too_long: "error_schedule_comment_too_long",
  schedule_comment_not_found: "error_schedule_comment_not_found",
  invalid_schedule_response: "error_invalid_schedule_response",
  schedule_response_note_too_long: "error_schedule_response_note_too_long",
  schedule_reminder_not_found: "error_schedule_reminder_not_found",
  schedule_reminder_not_allowed: "error_schedule_reminder_not_allowed",
  schedule_reminder_not_configured: "error_schedule_reminder_not_configured",
  invalid_schedule_reminder_offset: "error_invalid_schedule_reminder_offset",
  invalid_schedule_snooze_minutes: "error_invalid_schedule_snooze_minutes",
  family_code_expired: "error_family_code_expired",
  family_code_used: "error_family_code_used",
  family_code_not_verified: "error_family_code_not_verified",
  account_already_has_family: "error_account_already_has_family",
  geolocation_unsupported: "error_geolocation_unsupported",
  recording_unsupported: "error_recording_unsupported",
  media_recorder_unsupported: "error_media_recorder_unsupported",
  image_too_large: "chatImageTooLarge",
  audio_too_large: "chatAudioTooLarge",
  invalid_image_type: "error_invalid_image_type",
  invalid_audio_type: "error_invalid_audio_type",
  invalid_location: "error_invalid_location",
  invalid_image_url: "error_invalid_image_type",
  invalid_audio_url: "error_invalid_audio_type",
  message_too_long: "error_message_too_long",
  request_timeout: "chatLoadFailed",
  session_restore_timeout: "chatLoadFailed",
  chat_bootstrap_timeout: "chatLoadFailed",
};

export function humanizeError(message: unknown, language?: Language): string {
  const lang = language ?? getStoredLanguage();
  if (!message) return translate(lang, "errorFallback");
  const raw =
    typeof message === "string"
      ? message
      : message instanceof Error
        ? message.message
        : String((message as { message?: string }).message ?? message);

  for (const key of Object.keys(ERROR_MAP)) {
    if (raw.includes(key)) return translate(lang, ERROR_MAP[key]);
  }
  return raw;
}
