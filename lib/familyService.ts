"use client";

import { getSupabase } from "./supabaseClient";
import type { FamilyRole } from "@/types/family";
import type { LocalSession } from "./authLocal";

interface CreateFamilyInput {
  familyName: string;
  adminPassword: string;
  nickname: string;
  role: FamilyRole;
}

interface JoinFamilyInput {
  familyCode: string;
  nickname: string;
  role: FamilyRole;
}

interface RejoinFamilyMemberInput {
  familyCode: string;
  nickname: string;
  adminPassword: string;
}

export async function createFamily(
  input: CreateFamilyInput,
): Promise<LocalSession> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_family", {
    p_family_name: input.familyName,
    p_admin_password: input.adminPassword,
    p_nickname: input.nickname,
    p_role: input.role,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("create_family_failed");

  return {
    family_id: row.family_id,
    family_name: input.familyName.trim(),
    family_code: row.family_code,
    member_id: row.member_id,
    member_token: row.member_token,
    nickname: input.nickname.trim(),
    role: input.role,
    is_admin: row.is_admin,
  };
}

export async function joinFamily(
  input: JoinFamilyInput,
): Promise<LocalSession> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("join_family", {
    p_family_code: input.familyCode,
    p_nickname: input.nickname,
    p_role: input.role,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("join_family_failed");

  return {
    family_id: row.family_id,
    family_name: row.family_name,
    family_code: input.familyCode.trim().toUpperCase(),
    member_id: row.member_id,
    member_token: row.member_token,
    nickname: input.nickname.trim(),
    role: input.role,
    is_admin: row.is_admin,
  };
}

export async function rejoinFamilyMember(
  input: RejoinFamilyMemberInput,
): Promise<LocalSession> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("rejoin_family_member", {
    p_family_code: input.familyCode,
    p_nickname: input.nickname,
    p_admin_password: input.adminPassword,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("rejoin_family_member_failed");

  return {
    family_id: row.family_id,
    family_name: row.family_name,
    family_code: row.family_code,
    member_id: row.member_id,
    member_token: row.member_token,
    nickname: row.nickname,
    role: row.role as FamilyRole,
    is_admin: row.is_admin,
  };
}

export async function validateMember(
  memberId: string,
  memberToken: string,
): Promise<LocalSession | null> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("validate_member", {
    p_member_id: memberId,
    p_member_token: memberToken,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    family_id: row.family_id,
    family_name: row.family_name,
    family_code: row.family_code,
    member_id: row.member_id,
    member_token: memberToken,
    nickname: row.nickname,
    role: row.role,
    is_admin: row.is_admin,
  };
}

export async function fetchFamilyPublic(familyId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("families_public")
    .select("id, name, family_code, join_enabled")
    .eq("id", familyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateFamilyName(
  session: LocalSession,
  adminPassword: string,
  newName: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.rpc("update_family_name", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_admin_password: adminPassword,
    p_new_name: newName,
  });
  if (error) throw error;
}

export async function resetFamilyCode(
  session: LocalSession,
  adminPassword: string,
): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("reset_family_code", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data as string;
}

export async function setJoinEnabled(
  session: LocalSession,
  adminPassword: string,
  joinEnabled: boolean,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.rpc("set_join_enabled", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_admin_password: adminPassword,
    p_join_enabled: joinEnabled,
  });
  if (error) throw error;
}

export async function removeMember(
  session: LocalSession,
  targetMemberId: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.rpc("remove_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_target_member_id: targetMemberId,
  });
  if (error) throw error;
}

export async function leaveFamily(session: LocalSession): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.rpc("leave_family", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
  });
  if (error) throw error;
}
