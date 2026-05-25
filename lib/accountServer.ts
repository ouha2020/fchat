import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { LocalSession } from "@/lib/authLocal";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_TTL_HOURS = 24;

export interface AuthUserContext {
  user: User;
  email: string;
}

export function jsonOk(body: Record<string, unknown> = {}) {
  return NextResponse.json(body);
}

export function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function requireAuthUser(req: NextRequest): Promise<AuthUserContext> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new Error("unauthorized");

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user?.id || !data.user.email) {
    throw new Error("unauthorized");
  }
  return { user: data.user, email: data.user.email };
}

export function normalizeEmail(email: unknown): string {
  return String(email ?? "").trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128;
}

export function normalizeFamilyCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function rowToSession(row: any): LocalSession {
  return {
    family_id: row.family_id,
    family_name: row.family_name,
    family_code: row.family_code,
    member_id: row.member_id,
    member_token: row.member_token,
    device_id: row.device_id ?? undefined,
    nickname: row.nickname,
    role: row.role,
    is_admin: Boolean(row.is_admin),
  };
}

export async function issueSessionForUser(
  userId: string,
  deviceId?: string | null,
): Promise<LocalSession | null> {
  const { data, error } = await getSupabaseAdmin().rpc("issue_member_session_for_user", {
    p_user_id: userId,
    p_device_id: deviceId ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? rowToSession(row) : null;
}

export async function ensurePendingFamilyCode(
  userId: string,
  email: string,
  resend: boolean,
) {
  const sb = getSupabaseAdmin();
  const now = new Date();

  const { data: rows, error } = await sb
    .from("pending_family_codes")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["pending", "verified"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;

  const existing = rows?.[0] ?? null;
  if (existing) {
    const expiresAt = new Date(existing.expires_at);
    if (expiresAt <= now) {
      await sb
        .from("pending_family_codes")
        .update({ status: "expired", updated_at: now.toISOString() })
        .eq("id", existing.id);
      if (!resend) return { status: "expired" as const };
    } else {
      if (resend) await sendFamilyCodeEmail(email, existing.family_code);
      return { status: existing.status as "pending" | "verified", familyCode: existing.family_code };
    }
  }

  const familyCode = await generateUniqueFamilyCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_HOURS * 60 * 60 * 1000);
  const { error: insertError } = await sb.from("pending_family_codes").insert({
    user_id: userId,
    email,
    family_code: familyCode,
    status: "pending",
    expires_at: expiresAt.toISOString(),
  });
  if (insertError) throw insertError;

  await sendFamilyCodeEmail(email, familyCode);
  return { status: "sent" as const, familyCode };
}

export async function generateUniqueFamilyCode(): Promise<string> {
  const sb = getSupabaseAdmin();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = Array.from({ length: 6 }, () => {
      const bytes = new Uint8Array(1);
      crypto.getRandomValues(bytes);
      return CODE_ALPHABET[bytes[0] % CODE_ALPHABET.length];
    }).join("");

    const { data: family } = await sb
      .from("families")
      .select("id")
      .eq("family_code", code)
      .maybeSingle();
    if (family) continue;

    const { data: pending } = await sb
      .from("pending_family_codes")
      .select("id")
      .eq("family_code", code)
      .in("status", ["pending", "verified"])
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!pending) return code;
  }
  throw new Error("family_code_generation_failed");
}

export async function sendFamilyCodeEmail(email: string, familyCode: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.error("[family-code-email] Missing RESEND_API_KEY or EMAIL_FROM");
    throw new Error("email_send_failed");
  }

  const bodyText = [
    "家庭聊天室创建已开始。",
    "",
    `你的家庭代码：${familyCode}`,
    "",
    "请回到网站输入该家庭代码，继续创建家庭。",
    "创建家庭完成后，可以把这个代码分享给家人，家人输入代码即可加入。",
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: "家庭代码のお知らせ",
      text: bodyText,
      html: `<div style="font-family: sans-serif; line-height: 1.7;">
        <p>家庭聊天室创建已开始。</p>
        <p>你的家庭代码：</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 0.18em;">${familyCode}</p>
        <p>请回到网站输入该家庭代码，继续创建家庭。</p>
        <p>创建家庭完成后，可以把这个代码分享给家人，家人输入代码即可加入。</p>
      </div>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[family-code-email] Resend failed", {
      status: res.status,
      body: detail.slice(0, 500),
    });
    throw new Error("email_send_failed");
  }
}

export async function sendRecoveredFamilyCodeEmail(
  email: string,
  familyCode: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.error("[family-code-recovery-email] Missing RESEND_API_KEY or EMAIL_FROM");
    throw new Error("email_send_failed");
  }

  const bodyText = [
    "你请求找回家庭聊天室的家庭代码。",
    "",
    `你的家庭代码：${familyCode}`,
    "",
    "请不要公开分享给家庭成员以外的人。",
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: "家庭代码找回",
      text: bodyText,
      html: `<div style="font-family: sans-serif; line-height: 1.7;">
        <p>你请求找回家庭聊天室的家庭代码。</p>
        <p>你的家庭代码：</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 0.18em;">${familyCode}</p>
        <p>请不要公开分享给家庭成员以外的人。</p>
      </div>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[family-code-recovery-email] Resend failed", {
      status: res.status,
      body: detail.slice(0, 500),
    });
    throw new Error("email_send_failed");
  }
}

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("unauthorized")) return jsonError("unauthorized", 401);
  if (message.includes("email_required")) return jsonError("email_required", 400);
  if (message.includes("invalid_email")) return jsonError("invalid_email", 400);
  if (message.includes("email_send_failed")) return jsonError("email_send_failed", 502);
  if (message.includes("already") || message.includes("registered")) {
    return jsonError("email_registered", 409);
  }
  if (message.includes("family_code_expired")) return jsonError("family_code_expired", 409);
  if (message.includes("family_code_used")) return jsonError("family_code_used", 409);
  if (message.includes("invalid_family_code")) return jsonError("invalid_family_code", 400);
  if (message.includes("family_code_not_verified")) {
    return jsonError("family_code_not_verified", 409);
  }
  if (message.includes("account_already_has_family")) {
    return jsonError("account_already_has_family", 409);
  }
  if (message.includes("admin_password_too_short")) {
    return jsonError("admin_password_too_short", 400);
  }
  if (message.includes("family_name_required")) {
    return jsonError("family_name_required", 400);
  }
  if (message.includes("nickname_required")) return jsonError("nickname_required", 400);
  if (message.includes("owner_required")) return jsonError("owner_required", 403);
  if (message.includes("not_admin")) return jsonError("not_admin", 403);
  if (message.includes("member_not_found")) return jsonError("member_not_found", 404);
  if (message.includes("cannot_remove_self")) return jsonError("cannot_remove_self", 400);
  if (message.includes("not_allowed")) return jsonError("not_allowed", 403);
  return jsonError("network_error", 500);
}
