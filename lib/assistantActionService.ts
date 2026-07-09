"use client";

import type { LocalSession } from "@/lib/authLocal";
import { getSupabase } from "@/lib/supabaseClient";
import { uuidSchema } from "@/lib/validation";
import type {
  AssistantActionCard,
  AssistantActionResult,
  CreateAssistantActionCardInput,
} from "@/types/assistant";

export async function listAssistantActionCards(
  session: LocalSession,
): Promise<AssistantActionCard[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("list_assistant_action_cards_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
  });
  if (error) throw error;
  return ((data ?? []) as AssistantActionCard[]).map(normalizeAssistantCard);
}

export async function createAssistantActionCard(
  session: LocalSession,
  input: CreateAssistantActionCardInput,
): Promise<AssistantActionResult> {
  const title = input.title.trim();
  const summary = input.summary?.trim() || null;
  if (!title) throw new Error("assistant_card_title_required");
  if (title.length > 80) throw new Error("assistant_card_title_too_long");
  if (summary && summary.length > 300) {
    throw new Error("assistant_card_summary_too_long");
  }
  if (input.source_message_id) uuidSchema.parse(input.source_message_id);
  if (input.target_message_id) uuidSchema.parse(input.target_message_id);

  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_assistant_action_card", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_card_type: input.card_type,
    p_title: title,
    p_summary: summary,
    p_payload: input.payload ?? {},
    p_source_message_id: input.source_message_id ?? null,
    p_target_message_id: input.target_message_id ?? null,
  });
  if (error) throw error;
  return normalizeActionResult(data);
}

export async function updateAssistantActionCard(
  session: LocalSession,
  cardId: string,
  title: string,
  startsAtIso: string | null,
): Promise<AssistantActionResult> {
  uuidSchema.parse(cardId);
  const trimmed = title.trim();
  if (!trimmed) throw new Error("assistant_card_title_required");
  if (trimmed.length > 80) throw new Error("assistant_card_title_too_long");
  const sb = getSupabase();
  const { data, error } = await sb.rpc("update_assistant_action_card", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_card_id: cardId,
    p_title: trimmed,
    p_starts_at: startsAtIso,
  });
  if (error) throw error;
  return normalizeActionResult(data);
}

export async function confirmAssistantActionCard(
  session: LocalSession,
  cardId: string,
): Promise<AssistantActionResult> {
  uuidSchema.parse(cardId);
  const sb = getSupabase();
  const { data, error } = await sb.rpc("confirm_assistant_action_card", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_card_id: cardId,
  });
  if (error) throw error;
  return normalizeActionResult(data);
}

export async function cancelAssistantActionCard(
  session: LocalSession,
  cardId: string,
): Promise<AssistantActionResult> {
  uuidSchema.parse(cardId);
  const sb = getSupabase();
  const { data, error } = await sb.rpc("cancel_assistant_action_card", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_card_id: cardId,
  });
  if (error) throw error;
  return normalizeActionResult(data);
}

function normalizeAssistantCard(card: AssistantActionCard): AssistantActionCard {
  return {
    ...card,
    card_message_id: card.card_message_id ?? null,
    source_message_id: card.source_message_id ?? null,
    target_message_id: card.target_message_id ?? null,
    summary: card.summary ?? null,
    payload: card.payload ?? {},
    result_schedule_item_id: card.result_schedule_item_id ?? null,
    result_important_notification_id:
      card.result_important_notification_id ?? null,
    result_message_id: card.result_message_id ?? null,
    confirmed_at: card.confirmed_at ?? null,
    confirmed_by_member_id: card.confirmed_by_member_id ?? null,
    cancelled_at: card.cancelled_at ?? null,
    cancelled_by_member_id: card.cancelled_by_member_id ?? null,
  };
}

function normalizeActionResult(value: unknown): AssistantActionResult {
  const row = (value ?? {}) as Partial<AssistantActionResult>;
  return {
    card_id: String(row.card_id ?? ""),
    message_id: row.message_id ?? null,
    result_message_id: row.result_message_id ?? null,
    schedule_item_id: row.schedule_item_id ?? null,
    important_notification_id: row.important_notification_id ?? null,
    status: row.status,
  };
}
