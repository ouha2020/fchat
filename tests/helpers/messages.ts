import type { LocalSession } from "@/lib/authLocal";
import type { Message } from "@/types/message";

export function makeMessage(overrides: Partial<Message> & Pick<Message, "id">): Message {
  const createdAt = overrides.created_at ?? "2026-07-01T00:00:00.000Z";
  return {
    family_id: "f1",
    family_seq: null,
    sender_member_id: "alice",
    recipient_member_id: null,
    message_type: "text",
    content: "hi",
    image_url: null,
    audio_url: null,
    audio_duration_ms: null,
    latitude: null,
    longitude: null,
    address: null,
    map_url: null,
    effect_id: null,
    effect_caption: null,
    system_event_type: null,
    system_event_payload: null,
    deleted_at: null,
    deleted_by_member_id: null,
    created_at: createdAt,
    updated_at: overrides.updated_at ?? createdAt,
    ...overrides,
  };
}

export function makeSession(overrides: Partial<LocalSession> = {}): LocalSession {
  return {
    family_id: "f1",
    member_id: "alice",
    member_token: "token",
    nickname: "Alice",
    role: "father",
    is_admin: false,
    family_name: "Family",
    family_code: "ABC123",
    ...overrides,
  };
}
