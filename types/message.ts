export type MessageType = "text" | "image" | "location" | "system";

export interface Message {
  id: string;
  family_id: string;
  sender_member_id: string | null;
  message_type: MessageType;
  content: string | null;
  image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  map_url: string | null;
  created_at: string;
}
