"use client";

import { getSupabase } from "./supabaseClient";
import type { LocalSession } from "@/lib/authLocal";
import type { FamilyMember } from "@/types/member";

interface ListMembersOptions {
  includeRemoved?: boolean;
}

export async function listMembers(
  session: LocalSession,
  options: ListMembersOptions = {},
): Promise<FamilyMember[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("list_family_members_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_include_removed: options.includeRemoved ?? false,
  });
  if (error) throw error;
  return ((data ?? []) as FamilyMember[]).map((member) => ({
    ...member,
    avatar_url: member.avatar_url ?? null,
  }));
}
