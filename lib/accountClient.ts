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
  if (!session) throw new Error("member_not_found");
  const { data, error } = await getSupabaseAuth().auth.getSession();
  if (error) throw new Error(mapAuthError(error.message));
  const token = data.session?.access_token;
  if (!token) throw new Error("unauthorized");

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
    throw new Error(payload?.error ?? "auth_network_error");
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
  if (!token) throw new Error("unauthorized");

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
    // Error codes pass through untranslated; render with humanizeError so
    // the message follows the viewer's language.
    throw new Error(payload?.error ?? "auth_network_error");
  }
  return payload ?? {};
}

function mapAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "invalid_credentials";
  }
  if (lower.includes("already") && lower.includes("registered")) {
    return "email_registered";
  }
  if (lower.includes("password")) return "password_requirement";
  return "auth_network_error";
}
