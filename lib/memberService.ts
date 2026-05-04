"use client";

import { getSupabase } from "./supabaseClient";
import type { FamilyMember } from "@/types/member";

export async function listMembers(familyId: string): Promise<FamilyMember[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("family_members")
    .select(
      "id, family_id, nickname, role, is_admin, status, last_active_at",
    )
    .eq("family_id", familyId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FamilyMember[];
}
