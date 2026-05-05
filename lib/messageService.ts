"use client";

import { getSupabase } from "./supabaseClient";
import type { LocalSession } from "./authLocal";
import type { Message, MessageType } from "@/types/message";

export async function listMessages(
  familyId: string,
  limit = 100,
): Promise<Message[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("messages")
    .select(
      "id, family_id, sender_member_id, message_type, content, image_url, latitude, longitude, address, map_url, created_at",
    )
    .eq("family_id", familyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Message[]).reverse();
}

interface SendMessageInput {
  type: MessageType;
  content?: string | null;
  image_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  map_url?: string | null;
}

export async function sendMessage(
  session: LocalSession,
  input: SendMessageInput,
): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("send_message", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_message_type: input.type,
    p_content: input.content ?? null,
    p_image_url: input.image_url ?? null,
    p_latitude: input.latitude ?? null,
    p_longitude: input.longitude ?? null,
    p_address: input.address ?? null,
    p_map_url: input.map_url ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function uploadChatImage(
  familyId: string,
  file: File,
): Promise<string> {
  const sb = getSupabase();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${familyId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  const { error } = await sb.storage
    .from("chat-images")
    .upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
  if (error) throw error;

  const { data } = sb.storage.from("chat-images").getPublicUrl(path);
  return data.publicUrl;
}
