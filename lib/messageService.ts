"use client";

import { getSupabase } from "./supabaseClient";
import type { LocalSession } from "./authLocal";
import { isSafeHttpUrl, safeGoogleMapsUrl } from "@/lib/security";
import {
  audioBlobSchema,
  imageFileSchema,
  textMessageSchema,
} from "@/lib/validation";
import type { Message, MessageType } from "@/types/message";

const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

export async function listMessages(
  session: LocalSession,
  limit = 100,
): Promise<Message[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("list_messages_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_limit: limit,
  });
  if (error) throw error;
  return ((data ?? []) as Message[]).map(normalizeMessage).reverse();
}

export async function listMessagesDelta(
  session: LocalSession,
  cursorUpdatedAt: string | null,
  cursorId: string | null,
  limit = 300,
): Promise<Message[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("list_messages_delta", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_cursor_updated_at: cursorUpdatedAt,
    p_cursor_id: cursorId,
    p_limit: limit,
  });
  if (error) throw error;
  return ((data ?? []) as Message[]).map(normalizeMessage);
}

export async function getMessageById(
  session: LocalSession,
  messageId: string,
): Promise<Message | null> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_message_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_message_id: messageId,
  });
  if (error) throw error;
  const rows = (data ?? []) as Message[];
  const message = rows[0];
  return message ? normalizeMessage(message) : null;
}

interface SendMessageInput {
  type: MessageType;
  content?: string | null;
  image_url?: string | null;
  audio_url?: string | null;
  audio_duration_ms?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  map_url?: string | null;
  effect_id?: string | null;
  effect_caption?: string | null;
}

export async function sendMessage(
  session: LocalSession,
  input: SendMessageInput,
): Promise<string> {
  validateOutgoingMessage(input);
  const sb = getSupabase();
  const { data, error } = await sb.rpc("send_message", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_message_type: input.type,
    p_content: input.content ?? null,
    p_image_url: input.image_url ?? null,
    p_audio_url: input.audio_url ?? null,
    p_audio_duration_ms: input.audio_duration_ms ?? null,
    p_latitude: input.latitude ?? null,
    p_longitude: input.longitude ?? null,
    p_address: input.address ?? null,
    p_map_url: input.map_url ?? null,
    p_effect_id: input.effect_id ?? null,
    p_effect_caption: input.effect_caption ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function uploadChatImage(
  session: LocalSession,
  file: File,
): Promise<string> {
  imageFileSchema.parse(file);
  const contentType = normalizeMime(file.type);
  const ext = IMAGE_EXT_BY_MIME[contentType];
  if (!ext) throw new Error("invalid_image_type");

  const form = new FormData();
  form.append("memberId", session.member_id);
  form.append("memberToken", session.member_token);
  form.append("file", file, `image.${ext}`);
  return uploadViaApi("/api/upload/image", form);
}

export async function deleteMessage(
  session: LocalSession,
  messageId: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.rpc("delete_message", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_message_id: messageId,
  });
  if (error) throw error;
}

export async function uploadChatAudio(
  session: LocalSession,
  blob: Blob,
  mimeType: string,
): Promise<string> {
  audioBlobSchema.parse(blob);
  const contentType = normalizeMime(mimeType);
  const ext = AUDIO_EXT_BY_MIME[contentType];
  if (!ext) throw new Error("invalid_audio_type");

  const file = new File([blob], `voice.${ext}`, { type: contentType });
  const form = new FormData();
  form.append("memberId", session.member_id);
  form.append("memberToken", session.member_token);
  form.append("file", file);
  return uploadViaApi("/api/upload/audio", form);
}

function normalizeMime(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function validateOutgoingMessage(input: SendMessageInput): void {
  switch (input.type) {
    case "text":
      textMessageSchema.parse(input.content ?? "");
      break;
    case "image":
      if (!isSafeHttpUrl(input.image_url)) throw new Error("invalid_image_url");
      if (input.content) textMessageSchema.parse(input.content);
      break;
    case "audio":
      if (!isSafeHttpUrl(input.audio_url)) throw new Error("invalid_audio_url");
      if (
        typeof input.audio_duration_ms !== "number" ||
        input.audio_duration_ms < 0 ||
        input.audio_duration_ms > 600000
      ) {
        throw new Error("invalid_audio_url");
      }
      if (input.content) textMessageSchema.parse(input.content);
      break;
    case "location":
      if (
        typeof input.latitude !== "number" ||
        typeof input.longitude !== "number" ||
        input.latitude < -90 ||
        input.latitude > 90 ||
        input.longitude < -180 ||
        input.longitude > 180
      ) {
        throw new Error("invalid_location");
      }
      if (input.map_url && !safeGoogleMapsUrl(input.map_url)) {
        throw new Error("invalid_location");
      }
      if (input.content) textMessageSchema.parse(input.content);
      break;
    default:
      throw new Error("invalid_message_type");
  }
}

async function uploadViaApi(path: string, form: FormData): Promise<string> {
  const res = await fetch(path, {
    method: "POST",
    body: form,
  });
  const payload = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok) throw new Error(payload?.error ?? "upload_failed");
  if (!payload?.url || !isSafeHttpUrl(payload.url)) throw new Error("upload_failed");
  return payload.url;
}

export function normalizeMessage(message: Message): Message {
  return {
    ...message,
    system_event_type: message.system_event_type ?? null,
    system_event_payload: message.system_event_payload ?? null,
    updated_at:
      message.updated_at ??
      message.deleted_at ??
      message.created_at ??
      new Date(0).toISOString(),
  };
}
