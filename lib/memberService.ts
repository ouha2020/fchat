"use client";

import { getSupabase } from "./supabaseClient";
import type { FamilyMember } from "@/types/member";

interface ListMembersOptions {
  includeRemoved?: boolean;
}

export async function listMembers(
  familyId: string,
  options: ListMembersOptions = {},
): Promise<FamilyMember[]> {
  const sb = getSupabase();
  let query = sb
    .from("family_members")
    .select(
      "id, family_id, nickname, role, is_admin, status, last_active_at",
    )
    .eq("family_id", familyId)
    .order("created_at", { ascending: true });

  if (!options.includeRemoved) {
    query = query.eq("status", "active");
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FamilyMember[];
}
