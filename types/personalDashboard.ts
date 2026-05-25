import type { FamilyRole } from "@/types/family";
import type {
  ScheduleItemType,
  ScheduleRecurrenceRule,
  ScheduleStatus,
  ScheduleVisibility,
} from "@/types/schedule";

export interface PersonalDashboardProfile {
  member_id: string;
  nickname: string;
  role: FamilyRole;
  is_admin: boolean;
  family_id: string;
  family_name: string;
  avatar_url: string | null;
}

export interface PersonalDashboardScheduleItem {
  id: string;
  title: string;
  item_type: ScheduleItemType;
  visibility: ScheduleVisibility;
  starts_at: string;
  ends_at: string | null;
  remind_at: string | null;
  status: ScheduleStatus;
  assignee_member_id: string;
  assignee_nickname: string;
  creator_member_id: string;
  creator_nickname: string;
  recurrence_group_id: string | null;
  recurrence_rule: ScheduleRecurrenceRule | null;
}

export interface PersonalDashboard {
  profile: PersonalDashboardProfile;
  today_assigned: PersonalDashboardScheduleItem[];
  upcoming: PersonalDashboardScheduleItem[];
  created_by_me: PersonalDashboardScheduleItem[];
  recent_done: PersonalDashboardScheduleItem[];
}
