import type { LocalSession } from "@/lib/authLocal";
import type { Message } from "@/types/message";

/**
 * Ordering, dedup/merge, and per-member visibility for the in-memory chat
 * message list. Extracted from the chat page so the rules that decide what a
 * family member sees — and in what order — are unit-testable.
 */

export function isAssistantCardSystemMessage(message: Message): boolean {
  const payload = message.system_event_payload ?? {};
  return (
    message.message_type === "system" &&
    (message.system_event_type === "assistant_card_created" ||
      message.system_event_type === "assistant_card_confirmed" ||
      message.system_event_type === "assistant_card_cancelled" ||
      (payload.actor_type === "assistant" &&
        typeof payload.card_id === "string" &&
        typeof payload.status === "string"))
  );
}

export function isAssistantScheduleActionDoneMessage(message: Message): boolean {
  const payload = message.system_event_payload ?? {};
  return (
    message.message_type === "system" &&
    message.system_event_type === "assistant_action_done" &&
    payload.actor_type === "assistant" &&
    typeof payload.schedule_item_id === "string"
  );
}

export function isMessageVisibleToSession(
  message: Message,
  activeSession: LocalSession,
): boolean {
  if (isAssistantCardSystemMessage(message)) {
    return message.sender_member_id === activeSession.member_id;
  }
  if (
    isAssistantScheduleActionDoneMessage(message) &&
    !message.recipient_member_id
  ) {
    return message.sender_member_id === activeSession.member_id;
  }
  return (
    !message.recipient_member_id ||
    message.sender_member_id === activeSession.member_id ||
    message.recipient_member_id === activeSession.member_id
  );
}

export function filterVisibleMessages(
  rows: Message[],
  activeSession: LocalSession,
): Message[] {
  return rows.filter((message) =>
    isMessageVisibleToSession(message, activeSession),
  );
}

export function sortMessagesByCreatedAt(rows: Message[]): Message[] {
  return [...rows].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
      a.id.localeCompare(b.id),
  );
}

export function mergeMessagesById(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return sortMessagesByCreatedAt([...byId.values()]);
}

export function hasAssistantCardMessage(rows: Message[]): boolean {
  return rows.some(isAssistantCardSystemMessage);
}
