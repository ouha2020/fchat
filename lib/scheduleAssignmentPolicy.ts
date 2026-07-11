import type { LocalSession } from "@/lib/authLocal";
import type { ScheduleItem } from "@/types/schedule";

type ScheduleAssignmentItem = Pick<
  ScheduleItem,
  | "creator_member_id"
  | "assignee_member_id"
  | "assignee_response"
  | "visibility"
>;

type ScheduleActor = Pick<LocalSession, "member_id" | "is_admin">;

export function isConfirmedScheduleAssignee(
  item: ScheduleAssignmentItem,
  memberId: string | null | undefined,
): boolean {
  return (
    Boolean(memberId) &&
    item.assignee_member_id === memberId &&
    item.assignee_response === "accepted"
  );
}

export function canSetScheduleItemStatus(
  item: ScheduleAssignmentItem,
  actor: ScheduleActor,
): boolean {
  return (
    item.creator_member_id === actor.member_id ||
    isConfirmedScheduleAssignee(item, actor.member_id)
  );
}

export function canRespondScheduleAssignment(
  item: ScheduleAssignmentItem,
  actor: ScheduleActor,
): boolean {
  return (
    item.assignee_member_id === actor.member_id &&
    item.creator_member_id !== actor.member_id
  );
}

export function canReceiveScheduleReminder(
  item: ScheduleAssignmentItem,
  memberId: string,
): boolean {
  return (
    item.visibility === "family" ||
    item.creator_member_id === memberId ||
    isConfirmedScheduleAssignee(item, memberId)
  );
}

export function canManageScheduleItem(
  item: ScheduleAssignmentItem,
  actor: ScheduleActor,
): boolean {
  return (
    canSetScheduleItemStatus(item, actor) ||
    (actor.is_admin && item.visibility === "family")
  );
}
