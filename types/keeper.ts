import type {
  ScheduleItemType,
  ScheduleVisibility,
} from "@/types/schedule";

export type KeeperRequestType = ScheduleItemType;

export type KeeperRequestVisibility = ScheduleVisibility;

export type KeeperRequestStatus = "draft" | "created" | "done" | "cancelled";

export interface KeeperRequest {
  id: string;
  family_id: string;
  requester_member_id: string;
  assignee_member_id: string | null;
  schedule_item_id: string | null;
  source_message_id: string | null;
  request_text: string;
  request_type: KeeperRequestType;
  visibility: KeeperRequestVisibility;
  status: KeeperRequestStatus;
  due_at: string | null;
  remind_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateKeeperRequestInput {
  request_text: string;
  request_type: KeeperRequestType;
  assignee_member_id: string;
  visibility: KeeperRequestVisibility;
  starts_at: string;
  remind_at?: string | null;
  note?: string | null;
}

export interface CreateKeeperRequestResult {
  request_id: string;
  schedule_item_id: string;
  message_id: string;
}
