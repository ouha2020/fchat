"use client";

import { getSupabase } from "./supabaseClient";
import type { LocalSession } from "@/lib/authLocal";
import type { ImportantNotification } from "@/types/importantNotification";

const MESSAGE_SELECT =
  "id, family_id, sender_member_id, message_type, content, image_url, audio_url, audio_duration_ms, latitude, longitude, address, map_url, effect_id, effect_caption, deleted_at, deleted_by_member_id, created_at";

export async function listImportantNotifications(
  familyId: string,
): Promise<ImportantNotification[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("important_notifications")
    .select(
      `id, family_id, message_id, created_by_member_id, removed_at, removed_by_member_id, created_at, message:messages(${MESSAGE_SELECT})`,
    )
    .eq("family_id", familyId)
    .is("removed_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ImportantNotification[];
}

export async function addImportantNotification(
  session: LocalSession,
  messageId: string,
): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("add_important_notification", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_message_id: messageId,
  });
  if (error) throw error;
  return data as string;
}

export async function removeImportantNotification(
  session: LocalSession,
  notificationId: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.rpc("remove_important_notification", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_notification_id: notificationId,
  });
  if (error) throw error;
}
