"use client";

import type { LocalSession } from "@/lib/authLocal";
import { getOrCreateDeviceId, loadSession } from "@/lib/authLocal";
import { getSupabaseAuth } from "@/lib/supabaseAuthClient";
import type { FamilyRole } from "@/types/family";

export type FamilyCodeStatus =
  | "has_family"
  | "sent"
  | "pending"
  | "verified"
  | "expired";

interface FamilyCodeResponse {
  status: FamilyCodeStatus;
  session?: LocalSession;
}

export interface CreateVerifiedFamilyInput {
  familyCode: string;
  familyName: string;
  nickname: string;
  role: FamilyRole;
}

export async function registerAccount(email: string, password: string): Promise<void> {
  await postPublic("/api/auth/register", { email, password });
}

export async function signInAccount(email: string, password: string): Promise<void> {
  const { error } = await getSupabaseAuth().auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error(mapAuthError(error.message));
}

export async function signOutAccount(): Promise<void> {
  await getSupabaseAuth().auth.signOut();
}

export async function resetPasswordEmail(email: string): Promise<void> {
  const redirectTo =
    typeof window === "undefined"
      ? undefined
      : `${window.location.origin}/reset-password`;
  const { error } = await getSupabaseAuth().auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  if (error) throw new Error(mapAuthError(error.message));
}

export async function resendExistingFamilyCode(email: string): Promise<void> {
  await postPublic("/api/auth/resend-existing-family-code", { email });
}

export async function updateAccountPassword(password: string): Promise<void> {
  const { error } = await getSupabaseAuth().auth.updateUser({ password });
  if (error) throw new Error(mapAuthError(error.message));
}

export async function ensureFamilyCode(resend = false): Promise<FamilyCodeResponse> {
  return postAuthed("/api/auth/family-code", {
    resend,
    deviceId: getOrCreateDeviceId(),
  });
}

export async function verifyFamilyCode(familyCode: string): Promise<void> {
  await postAuthed("/api/auth/verify-family-code", { familyCode });
}

export async function createFamilyWithVerifiedCode(
  input: CreateVerifiedFamilyInput,
): Promise<LocalSession> {
  const response = await postAuthed("/api/auth/create-family", {
    ...input,
    deviceId: getOrCreateDeviceId(),
  });
  return response.session as LocalSession;
}

export async function issueMemberSessionForAccount(): Promise<LocalSession | null> {
  const response = await postAuthed("/api/auth/member-session", {
    deviceId: getOrCreateDeviceId(),
  });
  return (response.session ?? null) as LocalSession | null;
}

export async function resetAdminPasswordWithAccount(newPassword: string): Promise<void> {
  const session = loadSession();
  if (!session) throw new Error("请先进入家庭");
  const { data, error } = await getSupabaseAuth().auth.getSession();
  if (error) throw new Error(mapAuthError(error.message));
  const token = data.session?.access_token;
  if (!token) throw new Error("请先登录");

  const res = await fetch("/api/auth/reset-admin-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      memberId: session.member_id,
      memberToken: session.member_token,
      newPassword,
    }),
  });
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new Error(humanResetAdminPasswordError(payload?.error));
  }
}

export async function rejoinFamilyMemberWithAccount(
  familyCode: string,
  nickname: string,
): Promise<LocalSession> {
  const response = await postAuthed("/api/auth/owner-admin", {
    action: "rejoin_member",
    familyCode,
    nickname,
    deviceId: getOrCreateDeviceId(),
  });
  return response.session as LocalSession;
}

export async function getOwnerAccountStatus(session: LocalSession): Promise<boolean> {
  try {
    const response = await postAuthed("/api/auth/owner-admin", {
      action: "owner_status",
      memberId: session.member_id,
      memberToken: session.member_token,
    });
    return response.owner === true;
  } catch {
    return false;
  }
}

export async function updateFamilyNameWithAccount(
  session: LocalSession,
  newName: string,
): Promise<void> {
  await postAuthed("/api/auth/owner-admin", {
    action: "update_family_name",
    memberId: session.member_id,
    memberToken: session.member_token,
    newName,
  });
}

export async function resetFamilyCodeWithAccount(
  session: LocalSession,
): Promise<string> {
  const response = await postAuthed("/api/auth/owner-admin", {
    action: "reset_family_code",
    memberId: session.member_id,
    memberToken: session.member_token,
  });
  return response.familyCode as string;
}

export async function setJoinEnabledWithAccount(
  session: LocalSession,
  joinEnabled: boolean,
): Promise<void> {
  await postAuthed("/api/auth/owner-admin", {
    action: "set_join_enabled",
    memberId: session.member_id,
    memberToken: session.member_token,
    joinEnabled,
  });
}

export async function removeMemberWithAccount(
  session: LocalSession,
  targetMemberId: string,
): Promise<void> {
  await postAuthed("/api/auth/owner-admin", {
    action: "remove_member",
    memberId: session.member_id,
    memberToken: session.member_token,
    targetMemberId,
  });
}

async function postAuthed(path: string, body: unknown): Promise<any> {
  const { data, error } = await getSupabaseAuth().auth.getSession();
  if (error) throw new Error(mapAuthError(error.message));
  const token = data.session?.access_token;
  if (!token) throw new Error("请先登录");

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return parseApiResponse(res);
}

async function postPublic(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseApiResponse(res);
}

async function parseApiResponse(res: Response): Promise<any> {
  const payload = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!res.ok) {
    throw new Error(humanAuthError(payload?.error));
  }
  return payload ?? {};
}

function humanResetAdminPasswordError(error?: string): string {
  switch (error) {
    case "admin_password_too_short":
      return "管理密码至少 6 位";
    case "owner_required":
      return "只有创建家庭的邮箱账号可以重置管理密码";
    case "not_admin":
      return "只有管理员可以重置管理密码";
    case "member_not_found":
      return "当前家庭身份已失效，请重新进入家庭";
    case "unauthorized":
      return "请先登录";
    default:
      return humanAuthError(error);
  }
}

function mapAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "邮箱或密码不正确";
  }
  if (lower.includes("already") && lower.includes("registered")) {
    return "这个邮箱已经注册，请直接登录继续。";
  }
  if (lower.includes("password")) return "密码不符合要求，请检查后重试";
  return "网络不稳定，请稍后再试";
}

export function humanAuthError(error?: string): string {
  switch (error) {
    case "email_required":
      return "请输入邮箱";
    case "invalid_email":
      return "邮箱格式不正确";
    case "password_required":
      return "请输入密码";
    case "password_too_short":
      return "密码至少 8 位";
    case "email_registered":
      return "这个邮箱已经注册，请直接登录继续。";
    case "email_send_failed":
      return "家庭代码邮件发送失败，请稍后重试。";
    case "family_code_expired":
      return "家庭代码已过期，请重新发送。";
    case "family_code_used":
      return "家庭代码已使用，不能重复创建家庭。";
    case "invalid_family_code":
      return "家庭代码不正确，请检查邮箱中的代码。";
    case "family_code_not_verified":
      return "请先验证发送到邮箱中的家庭代码。";
    case "account_already_has_family":
      return "你已经创建过家庭，正在进入家庭聊天室。";
    case "family_name_required":
      return "请输入家庭名称";
    case "nickname_required":
      return "请输入昵称";
    case "invalid_role":
      return "请选择角色";
    case "admin_password_too_short":
      return "管理密码至少 6 位";
    case "unauthorized":
      return "请先登录";
    case "owner_required":
      return "只有创建家庭的邮箱账号可以执行这个操作";
    case "not_admin":
      return "只有管理员可以执行这个操作";
    case "member_not_found":
      return "当前家庭身份已失效，请重新进入家庭";
    case "cannot_remove_self":
      return "不能移除自己";
    case "not_allowed":
      return "当前操作不允许";
    default:
      return "网络不稳定，请稍后再试";
  }
}
