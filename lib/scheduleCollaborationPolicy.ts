export type ScheduleCollaborationNotifyType =
  | "created"
  | "assigned"
  | "accepted"
  | "declined"
  | "commented";

export interface ScheduleCollaborationAudienceItem {
  creator_member_id: string;
  assignee_member_id: string;
  visibility: "family" | "private";
}

export interface ScheduleCommentEvidence {
  visibility: "family" | "private";
  recipient_member_id: string | null;
}

export type ScheduleCollaborationAudience =
  | { scope: "none" }
  | { scope: "family" }
  | { scope: "members"; memberIds: string[] };

export function resolveScheduleCreationNotification(
  item: ScheduleCollaborationAudienceItem,
): "created" | "assigned" | null {
  if (item.visibility === "family") return "created";
  return item.assignee_member_id !== item.creator_member_id ? "assigned" : null;
}

export function resolveScheduleCollaborationAudience(
  item: ScheduleCollaborationAudienceItem,
  eventType: ScheduleCollaborationNotifyType,
  actorMemberId: string,
  commentEvidence: ScheduleCommentEvidence | null = null,
): ScheduleCollaborationAudience {
  if (eventType === "created") {
    if (
      item.visibility !== "family" ||
      item.creator_member_id !== actorMemberId
    ) {
      return { scope: "none" };
    }
    return { scope: "family" };
  }

  if (eventType === "assigned") {
    return membersAudience([item.assignee_member_id], actorMemberId);
  }

  if (eventType === "accepted" || eventType === "declined") {
    if (item.assignee_member_id !== actorMemberId) {
      return { scope: "none" };
    }
    return membersAudience([item.creator_member_id], actorMemberId);
  }

  if (!commentEvidence) return { scope: "none" };
  if (commentEvidence.visibility === "private") {
    return membersAudience(
      commentEvidence.recipient_member_id
        ? [commentEvidence.recipient_member_id]
        : [],
      actorMemberId,
    );
  }
  if (item.visibility === "private") {
    return membersAudience(
      [item.creator_member_id, item.assignee_member_id],
      actorMemberId,
    );
  }
  return { scope: "family" };
}

export function isRecentScheduleCollaborationEvidence(
  createdAt: string,
  nowMs: number,
  windowMs: number,
): boolean {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return false;
  const ageMs = nowMs - createdMs;
  return ageMs >= -60_000 && ageMs <= windowMs;
}

export function isScheduleCollaborationDeliveryAcknowledged(
  sent: number,
  failed: number,
): boolean {
  return sent > 0 || failed === 0;
}

function membersAudience(
  memberIds: string[],
  actorMemberId: string,
): ScheduleCollaborationAudience {
  const uniqueMemberIds = [...new Set(memberIds.filter(Boolean))].filter(
    (memberId) => memberId !== actorMemberId,
  );
  return uniqueMemberIds.length > 0
    ? { scope: "members", memberIds: uniqueMemberIds }
    : { scope: "none" };
}
