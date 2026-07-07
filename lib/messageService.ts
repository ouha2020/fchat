"use client";

import { getSupabase } from "./supabaseClient";
import type { LocalSession } from "./authLocal";
import { prepareChatImage } from "@/lib/imageCompression";
import { isSafeOutgoingMediaRef } from "@/lib/mediaRefs";
import { safeGoogleMapsUrl } from "@/lib/security";
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

export async function listMessagesBefore(
  session: LocalSession,
  beforeCreatedAt: string,
  beforeId: string,
  limit = 100,
): Promise<Message[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("list_messages_before", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_before_created_at: beforeCreatedAt,
    p_before_id: beforeId,
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

export async function getMessagesByIds(
  session: LocalSession,
  messageIds: string[],
): Promise<Message[]> {
  const uniqueIds = [...new Set(messageIds)].slice(0, 100);
  if (uniqueIds.length === 0) return [];

  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_messages_by_ids_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_message_ids: uniqueIds,
  });
  if (error) throw error;
  return ((data ?? []) as Message[]).map(normalizeMessage);
}

export async function listMessagesAfterSeq(
  session: LocalSession,
  afterSeq: number,
  limit = 300,
): Promise<Message[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("list_messages_after_seq", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_after_seq: Math.max(0, Math.floor(afterSeq)),
    p_limit: limit,
  });
  if (error) throw error;
  return ((data ?? []) as Message[]).map(normalizeMessage);
}

export async function markMessagesDelivered(
  session: LocalSession,
  messageIds: string[],
): Promise<void> {
  const ids = uniqueMessageIds(messageIds);
  if (ids.length === 0) return;

  const sb = getSupabase();
  const { error } = await sb.rpc("mark_messages_delivered", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_message_ids: ids,
  });
  if (error) throw error;
}

export async function markMessagesRead(
  session: LocalSession,
  messageIds: string[],
): Promise<void> {
  const ids = uniqueMessageIds(messageIds);
  if (ids.length === 0) return;

  const sb = getSupabase();
  const { error } = await sb.rpc("mark_messages_read", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_message_ids: ids,
  });
  if (error) throw error;
}

export async function getUnreadCount(session: LocalSession): Promise<number> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_unread_count_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
  });
  if (error) throw error;
  return typeof data === "number" ? data : Number(data ?? 0);
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
  recipient_member_id?: string | null;
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
    p_recipient_member_id: input.recipient_member_id ?? null,
  });
  if (error) throw error;
  return data as string;
}

export interface ChatImageUpload {
  url: string;
  /** The exact bytes uploaded (after client-side prepare/resize). */
  blob: Blob;
}

export async function uploadChatImage(
  session: LocalSession,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<ChatImageUpload> {
  const preparedFile = await prepareChatImage(file);
  imageFileSchema.parse(preparedFile);
  const contentType = normalizeMime(preparedFile.type);
  const ext = IMAGE_EXT_BY_MIME[contentType];
  if (!ext) throw new Error("invalid_image_type");

  const form = new FormData();
  form.append("memberId", session.member_id);
  form.append("memberToken", session.member_token);
  form.append("file", preparedFile, `image.${ext}`);
  const url = await uploadViaApi("/api/upload/image", form, onProgress);
  return { url, blob: preparedFile };
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
      if (!isSafeOutgoingMediaRef(input.image_url)) {
        throw new Error("invalid_image_url");
      }
      if (input.content) textMessageSchema.parse(input.content);
      break;
    case "audio":
      if (!isSafeOutgoingMediaRef(input.audio_url)) {
        throw new Error("invalid_audio_url");
      }
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

async function uploadViaApi(
  path: string,
  form: FormData,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  // XMLHttpRequest (not fetch) so we can report real upload progress to the
  // optimistic image bubble via the upload.onprogress event.
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.responseType = "json";
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.min(1, event.loaded / event.total));
        }
      };
    }
    xhr.onload = () => {
      const payload = (xhr.response ?? null) as
        | { url?: string; error?: string }
        | null;
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(payload?.error ?? "upload_failed"));
        return;
      }
      if (!payload?.url || !isSafeOutgoingMediaRef(payload.url)) {
        reject(new Error("upload_failed"));
        return;
      }
      resolve(payload.url);
    };
    xhr.onerror = () => reject(new Error("upload_failed"));
    xhr.ontimeout = () => reject(new Error("upload_failed"));
    xhr.send(form);
  });
}

function uniqueMessageIds(messageIds: string[]): string[] {
  return [...new Set(messageIds.filter(Boolean))].slice(0, 300);
}

export function normalizeMessage(message: Message): Message {
  return {
    ...message,
    family_seq: normalizeFamilySeq(message.family_seq),
    recipient_member_id: message.recipient_member_id ?? null,
    system_event_type: message.system_event_type ?? null,
    system_event_payload: message.system_event_payload ?? null,
    updated_at:
      message.updated_at ??
      message.deleted_at ??
      message.created_at ??
      new Date(0).toISOString(),
  };
}

function normalizeFamilySeq(value: Message["family_seq"] | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
