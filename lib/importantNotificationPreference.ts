const PREFIX = "family-chat:dismissed-important";

function storageKey(familyId: string, memberId: string): string {
  return `${PREFIX}:${familyId}:${memberId}`;
}

export function getDismissedImportantIds(
  familyId: string,
  memberId: string,
): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(familyId, memberId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

export function saveDismissedImportantIds(
  familyId: string,
  memberId: string,
  ids: Set<string>,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    storageKey(familyId, memberId),
    JSON.stringify(Array.from(ids)),
  );
}

export function dismissImportantNotification(
  familyId: string,
  memberId: string,
  notificationId: string,
): Set<string> {
  const next = getDismissedImportantIds(familyId, memberId);
  next.add(notificationId);
  saveDismissedImportantIds(familyId, memberId, next);
  return next;
}
