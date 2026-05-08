import type { Message } from "@/types/message";

export interface ImportantNotification {
  id: string;
  family_id: string;
  message_id: string;
  created_by_member_id: string | null;
  removed_at: string | null;
  removed_by_member_id: string | null;
  created_at: string;
  message: Message | null;
}
