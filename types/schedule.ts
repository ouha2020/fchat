export type ScheduleItemType = "schedule" | "todo" | "reminder";

export type ScheduleVisibility = "family" | "private";

export type ScheduleStatus = "active" | "done" | "cancelled";

export type ScheduleRecurrenceRule = "none" | "daily" | "weekly" | "monthly";

export type ScheduleRecurrenceScope = "single" | "future" | "all";

export type ScheduleAssigneeResponseStatus =
  | "pending"
  | "accepted"
  | "declined";

export type ScheduleReminderDeliveryStatus =
  | "pending"
  | "sent"
  | "skipped"
  | "failed"
  | "gone";

export type ScheduleReminderKind = "before_start" | "snooze" | "overdue";

export type ScheduleReminderOffset = 0 | 10 | 30 | 60 | 1440;

export interface ScheduleItem {
  id: string;
  family_id: string;
  creator_member_id: string;
  assignee_member_id: string;
  title: string;
  note: string | null;
  item_type: ScheduleItemType;
  visibility: ScheduleVisibility;
  starts_at: string;
  ends_at: string | null;
  remind_at: string | null;
  reminded_at: string | null;
  reminder_push_attempted_at: string | null;
  recurrence_group_id: string | null;
  recurrence_rule: ScheduleRecurrenceRule | null;
  recurrence_index: number | null;
  status: ScheduleStatus;
  completed_at: string | null;
  completed_by_member_id: string | null;
  created_at: string;
  updated_at: string;
  creator_nickname: string;
  assignee_nickname: string;
}

export interface CreateScheduleItemInput {
  title: string;
  note?: string | null;
  item_type: ScheduleItemType;
  visibility: ScheduleVisibility;
  starts_at: string;
  ends_at?: string | null;
  remind_at?: string | null;
  reminder_offsets?: ScheduleReminderOffset[];
  recurrence_rule?: ScheduleRecurrenceRule | null;
  assignee_member_id: string;
}

export interface UpdateScheduleItemInput extends CreateScheduleItemInput {
  id: string;
  recurrence_scope?: ScheduleRecurrenceScope;
}

export interface ScheduleComment {
  id: string;
  schedule_item_id: string;
  member_id: string;
  nickname: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduleActivityLog {
  id: string;
  actor_member_id: string;
  actor_nickname: string;
  activity_type: string;
  summary: string;
  created_at: string;
}

export interface ScheduleAssigneeResponse {
  status: ScheduleAssigneeResponseStatus;
  responded_at: string | null;
  note: string | null;
}

export interface ScheduleCollaboration {
  comments: ScheduleComment[];
  activity_logs: ScheduleActivityLog[];
  assignee_response: ScheduleAssigneeResponse;
}

export interface ScheduleReminderDelivery {
  id: string;
  member_id: string;
  nickname: string;
  scheduled_for: string;
  reminder_kind: ScheduleReminderKind;
  status: ScheduleReminderDeliveryStatus;
  attempt_count: number;
  delivered_at: string | null;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  skipped_reason: string | null;
  error_status: number | null;
  error_message: string | null;
  updated_at: string;
}

export interface ScheduleReminderStatus {
  configured: boolean;
  remind_at: string | null;
  rules: ScheduleReminderOffset[];
  current_member_delivery: ScheduleReminderDelivery | null;
  deliveries: ScheduleReminderDelivery[];
}

export interface ScheduleReminderHealthFailure {
  deliveryId: string;
  status: "failed" | "gone";
  reminderKind: ScheduleReminderKind;
  errorStatus: number | null;
  attemptCount: number;
  nextRetryAt: string | null;
  updatedAt: string | null;
}

export interface ScheduleReminderHealth {
  pending: number;
  sent: number;
  failed: number;
  gone: number;
  skipped: number;
  private_failed: number;
  recentFailures: ScheduleReminderHealthFailure[];
}
