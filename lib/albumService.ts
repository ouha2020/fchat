"use client";

import { getSupabase } from "./supabaseClient";
import type { LocalSession } from "@/lib/authLocal";
import type { AlbumItem } from "@/types/album";

export async function addAlbumItem(
  session: LocalSession,
  imageRef: string,
  sourceMessageId: string,
): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("add_album_item", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_image_ref: imageRef,
    p_source_message_id: sourceMessageId,
  });
  if (error) throw error;
  return data as string;
}

export async function listAlbumItems(
  session: LocalSession,
  ownerMemberId: string,
): Promise<AlbumItem[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("list_album_items", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_owner_member_id: ownerMemberId,
  });
  if (error) throw error;
  return (data ?? []) as AlbumItem[];
}

export async function removeAlbumItem(
  session: LocalSession,
  itemId: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.rpc("remove_album_item", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_item_id: itemId,
  });
  if (error) throw error;
}
