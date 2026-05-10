"use client";

import { getSupabase } from "./supabaseClient";
import type { FamilyRole } from "@/types/family";
import { getOrCreateDeviceId, type LocalSession } from "./authLocal";
import {
  adminPasswordSchema,
  familyCodeSchema,
  familyNameSchema,
  nicknameSchema,
  roleSchema,
} from "@/lib/validation";
import { withTimeout } from "@/lib/timeout";

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

interface ResolveJoinFamilyStateInput {
  familyCode: string;
  nickname: string;
}

export type JoinFamilyState =
  | "can_join"
  | "rejoin_required"
  | "invalid_family_code"
  | "nickname_required"
  | "rate_limited";

export async function createFamily(
  input: CreateFamilyInput,
): Promise<LocalSession> {
  const parsed = {
    familyName: familyNameSchema.parse(input.familyName),
    adminPassword: adminPasswordSchema.parse(input.adminPassword),
    nickname: nicknameSchema.parse(input.nickname),
    role: roleSchema.parse(input.role),
    deviceId: getOrCreateDeviceId(),
  };
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_family", {
    p_family_name: parsed.familyName,
    p_admin_password: parsed.adminPassword,
    p_nickname: parsed.nickname,
    p_role: parsed.role,
    p_device_id: parsed.deviceId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("create_family_failed");

  return {
    family_id: row.family_id,
    family_name: parsed.familyName,
    family_code: row.family_code,
    member_id: row.member_id,
    member_token: row.member_token,
    device_id: parsed.deviceId,
    nickname: parsed.nickname,
    role: parsed.role,
    is_admin: row.is_admin,
  };
}

export async function joinFamily(
  input: JoinFamilyInput,
): Promise<LocalSession> {
  const parsed = {
    familyCode: familyCodeSchema.parse(input.familyCode),
    nickname: nicknameSchema.parse(input.nickname),
    role: roleSchema.parse(input.role),
    deviceId: getOrCreateDeviceId(),
  };
  const sb = getSupabase();
  const { data, error } = await sb.rpc("join_family", {
    p_family_code: parsed.familyCode,
    p_nickname: parsed.nickname,
    p_role: parsed.role,
    p_device_id: parsed.deviceId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("join_family_failed");

  return {
    family_id: row.family_id,
    family_name: row.family_name,
    family_code: row.family_code ?? parsed.familyCode,
    member_id: row.member_id,
    member_token: row.member_token,
    device_id: parsed.deviceId,
    nickname: parsed.nickname,
    role: parsed.role,
    is_admin: row.is_admin,
  };
}

export async function resolveJoinFamilyState(
  input: ResolveJoinFamilyStateInput,
): Promise<JoinFamilyState> {
  const parsed = {
    familyCode: familyCodeSchema.parse(input.familyCode),
    nickname: nicknameSchema.parse(input.nickname),
  };
  const sb = getSupabase();
  const { data, error } = await sb.rpc("resolve_join_family_state", {
    p_family_code: parsed.familyCode,
    p_nickname: parsed.nickname,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row?.status ?? "invalid_family_code") as JoinFamilyState;
}

export async function rejoinFamilyMember(
  input: RejoinFamilyMemberInput,
): Promise<LocalSession> {
  const parsed = {
    familyCode: familyCodeSchema.parse(input.familyCode),
    nickname: nicknameSchema.parse(input.nickname),
    adminPassword: adminPasswordSchema.parse(input.adminPassword),
    deviceId: getOrCreateDeviceId(),
  };
  const sb = getSupabase();
  const { data, error } = await sb.rpc("rejoin_family_member", {
    p_family_code: parsed.familyCode,
    p_nickname: parsed.nickname,
    p_admin_password: parsed.adminPassword,
    p_device_id: parsed.deviceId,
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
    device_id: parsed.deviceId,
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
  const response = await withTimeout(
    Promise.resolve(sb.rpc("validate_member", {
      p_member_id: memberId,
      p_member_token: memberToken,
      p_device_id: getOrCreateDeviceId(),
    })),
    7000,
    "session_restore_timeout",
  );
  const { data, error } = response as { data: unknown; error: Error | null };
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    family_id: row.family_id,
    family_name: row.family_name,
    family_code: row.family_code,
    member_id: row.member_id,
    member_token: memberToken,
    device_id: row.device_id ?? getOrCreateDeviceId(),
    nickname: row.nickname,
    role: row.role,
    is_admin: row.is_admin,
  };
}

export async function fetchFamilySettings(session: LocalSession) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_family_settings_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    id: row.family_id as string,
    name: row.family_name as string,
    family_code: row.family_code as string,
    join_enabled: row.join_enabled as boolean,
  };
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
