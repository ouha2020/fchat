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

export interface ImportantNotificationReadMember {
  notification_id: string;
  member_id: string;
  nickname: string;
  role: string;
  delivered_at: string | null;
  read_at: string | null;
  is_read: boolean;
}

export interface ImportantNotificationReadState {
  notificationId: string;
  members: ImportantNotificationReadMember[];
  readCount: number;
  unreadCount: number;
  unreadNicknames: string[];
}
