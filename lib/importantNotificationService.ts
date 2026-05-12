"use client";

import { getSupabase } from "./supabaseClient";
import type { LocalSession } from "@/lib/authLocal";
import type { ImportantNotification } from "@/types/importantNotification";
import { normalizeMessage } from "@/lib/messageService";
import type { MessageType, SystemEventType } from "@/types/message";

interface ImportantNotificationRow {
  id: string;
  family_id: string;
  message_id: string;
  created_by_member_id: string | null;
  removed_at: string | null;
  removed_by_member_id: string | null;
  created_at: string;
  message_family_id: string;
  message_sender_member_id: string | null;
  message_type: MessageType;
  message_content: string | null;
  message_image_url: string | null;
  message_audio_url: string | null;
  message_audio_duration_ms: number | null;
  message_latitude: number | null;
  message_longitude: number | null;
  message_address: string | null;
  message_map_url: string | null;
  message_effect_id: string | null;
  message_effect_caption: string | null;
  message_system_event_type: SystemEventType | null;
  message_system_event_payload: Record<string, unknown> | null;
  message_deleted_at: string | null;
  message_deleted_by_member_id: string | null;
  message_updated_at: string;
  message_created_at: string;
}

export async function listImportantNotifications(
  session: LocalSession,
): Promise<ImportantNotification[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("list_important_notifications_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
  });
  if (error) throw error;
  return ((data ?? []) as ImportantNotificationRow[]).map((row) => ({
    id: row.id,
    family_id: row.family_id,
    message_id: row.message_id,
    created_by_member_id: row.created_by_member_id,
    removed_at: row.removed_at,
    removed_by_member_id: row.removed_by_member_id,
    created_at: row.created_at,
    message: row.message_id
      ? normalizeMessage({
          id: row.message_id,
          family_id: row.message_family_id,
          sender_member_id: row.message_sender_member_id,
          message_type: row.message_type,
          content: row.message_content,
          image_url: row.message_image_url,
          audio_url: row.message_audio_url,
          audio_duration_ms: row.message_audio_duration_ms,
          latitude: row.message_latitude,
          longitude: row.message_longitude,
          address: row.message_address,
          map_url: row.message_map_url,
          effect_id: row.message_effect_id,
          effect_caption: row.message_effect_caption,
          system_event_type: row.message_system_event_type,
          system_event_payload: row.message_system_event_payload,
          deleted_at: row.message_deleted_at,
          deleted_by_member_id: row.message_deleted_by_member_id,
          updated_at: row.message_updated_at,
          created_at: row.message_created_at,
        })
      : null,
  })) as ImportantNotification[];
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
