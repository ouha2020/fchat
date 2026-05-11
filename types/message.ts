export type MessageType = "text" | "image" | "audio" | "location" | "system";

export interface Message {
  id: string;
  family_id: string;
  sender_member_id: string | null;
  message_type: MessageType;
  content: string | null;
  image_url: string | null;
  audio_url: string | null;
  audio_duration_ms: number | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  map_url: string | null;
  effect_id: string | null;
  effect_caption: string | null;
  push_requested_at?: string | null;
  deleted_at: string | null;
  deleted_by_member_id: string | null;
  updated_at: string;
  created_at: string;
}
