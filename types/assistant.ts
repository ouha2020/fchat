export type AssistantActionCardType =
  | "reminder"
  | "schedule"
  | "important"
  | "todo"
  | "schedule_update"
  | "schedule_cancel";

export type AssistantActionCardStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "expired";

export interface AssistantActionPayload {
  item_type?: "reminder" | "schedule" | "todo";
  visibility?: "family" | "private";
  starts_at?: string | null;
  ends_at?: string | null;
  remind_at?: string | null;
  assignee_member_id?: string | null;
  schedule_item_id?: string | null;
  action?: "update" | "cancel";
  original_text?: string;
  source?: "rule-parser" | "keeper-mode";
  [key: string]: unknown;
}

export interface AssistantActionCard {
  id: string;
  family_id: string;
  created_by_member_id: string;
  card_message_id: string | null;
  source_message_id: string | null;
  target_message_id: string | null;
  card_type: AssistantActionCardType;
  status: AssistantActionCardStatus;
  title: string;
  summary: string | null;
  payload: AssistantActionPayload;
  result_schedule_item_id: string | null;
  result_important_notification_id: string | null;
  result_message_id: string | null;
  confirmed_at: string | null;
  confirmed_by_member_id: string | null;
  cancelled_at: string | null;
  cancelled_by_member_id: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAssistantActionCardInput {
  card_type: AssistantActionCardType;
  title: string;
  summary?: string | null;
  payload?: AssistantActionPayload;
  source_message_id?: string | null;
  target_message_id?: string | null;
}

export interface AssistantActionResult {
  card_id: string;
  message_id: string | null;
  result_message_id?: string | null;
  schedule_item_id?: string | null;
  important_notification_id?: string | null;
  status?: AssistantActionCardStatus;
}
