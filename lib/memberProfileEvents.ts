export const MEMBER_PROFILE_CHANGED_EVENT =
  "family-chat:member-profile-changed";

const MEMBER_PROFILE_CHANGED_KEY_PREFIX =
  "family-chat:member-profile-changed:";

export interface MemberProfileChangedDetail {
  familyId: string;
  memberId: string;
  avatarUrl: string | null;
  updatedAt: number;
}

export function memberProfileChangedStorageKey(familyId: string): string {
  return `${MEMBER_PROFILE_CHANGED_KEY_PREFIX}${familyId}`;
}

export function notifyMemberProfileChanged(input: {
  familyId: string;
  memberId: string;
  avatarUrl: string | null;
}): MemberProfileChangedDetail {
  const detail: MemberProfileChangedDetail = {
    ...input,
    updatedAt: Date.now(),
  };

  if (typeof window === "undefined") return detail;

  try {
    window.localStorage.setItem(
      memberProfileChangedStorageKey(detail.familyId),
      JSON.stringify(detail),
    );
  } catch {
    // Best-effort local sync only. Database state remains authoritative.
  }

  window.dispatchEvent(
    new CustomEvent<MemberProfileChangedDetail>(
      MEMBER_PROFILE_CHANGED_EVENT,
      { detail },
    ),
  );
  return detail;
}

export function readMemberProfileChanged(
  familyId: string,
): MemberProfileChangedDetail | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      memberProfileChangedStorageKey(familyId),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isMemberProfileChangedDetail(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isMemberProfileChangedDetail(
  value: unknown,
): value is MemberProfileChangedDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<MemberProfileChangedDetail>;
  return (
    typeof detail.familyId === "string" &&
    typeof detail.memberId === "string" &&
    (typeof detail.avatarUrl === "string" || detail.avatarUrl === null) &&
    typeof detail.updatedAt === "number"
  );
}
