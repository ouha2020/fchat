import type { Message } from "@/types/message";

export function normalizeMessage(message: Message): Message {
  return {
    ...message,
    family_seq: normalizeFamilySeq(message.family_seq),
    recipient_member_id: message.recipient_member_id ?? null,
    system_event_type: message.system_event_type ?? null,
    system_event_payload: message.system_event_payload ?? null,
    updated_at:
      message.updated_at ??
      message.deleted_at ??
      message.created_at ??
      new Date(0).toISOString(),
  };
}

function normalizeFamilySeq(value: Message["family_seq"] | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
