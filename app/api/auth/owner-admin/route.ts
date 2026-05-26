import { createHash, randomUUID } from "crypto";
import { NextRequest } from "next/server";

import {
  apiError,
  generateUniqueFamilyCode,
  jsonOk,
  normalizeFamilyCode,
  requireAuthUser,
  rowToSession,
} from "@/lib/accountServer";
import { validateMemberCredentials } from "@/lib/memberAuthServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function requireOwnerAccount(
  userId: string,
  memberId: unknown,
  memberToken: unknown,
) {
  const member = await validateMemberCredentials(memberId, memberToken);
  if (!member) throw new Error("unauthorized");

  const sb = getSupabaseAdmin();
  const { data: family, error } = await sb
    .from("families")
    .select("id, owner_user_id, name, family_code")
    .eq("id", member.family_id)
    .maybeSingle();
  if (error) throw error;
  if (!family || family.owner_user_id !== userId) {
    throw new Error("owner_required");
  }

  return { member, family };
}

async function rejoinMemberByOwner(
  userId: string,
  familyCode: unknown,
  nickname: unknown,
  deviceId: unknown,
) {
  const code = normalizeFamilyCode(familyCode);
  const name = cleanText(nickname, 20);
  if (!code) throw new Error("invalid_family_code");
  if (!name) throw new Error("nickname_required");

  const sb = getSupabaseAdmin();
  const { data: family, error: familyError } = await sb
    .from("families")
    .select("id, name, family_code, owner_user_id, code_expires_at")
    .eq("family_code", code)
    .maybeSingle();
  if (familyError) throw familyError;
  if (!family) throw new Error("invalid_family_code");
  if (family.owner_user_id !== userId) throw new Error("owner_required");
  if (family.code_expires_at && new Date(family.code_expires_at) <= new Date()) {
    throw new Error("invalid_family_code");
  }

  const { data: rows, error: memberError } = await sb
    .from("family_members")
    .select("id, nickname, role, is_admin, created_at")
    .eq("family_id", family.id)
    .eq("nickname", name)
    .in("status", ["active", "removed"])
    .order("is_admin", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);
  if (memberError) throw memberError;
  const member = rows?.[0];
  if (!member) throw new Error("member_not_found");

  const token = randomUUID();
  const device = cleanText(deviceId, 80) || null;

  await sb
    .from("family_members")
    .update({ status: "removed", updated_at: new Date().toISOString() })
    .eq("family_id", family.id)
    .eq("nickname", name)
    .neq("id", member.id)
    .eq("status", "active");

  const { error: updateError } = await sb
    .from("family_members")
    .update({
      status: "active",
      member_token_hash: hashSecret(token),
      access_token_hash: hashSecret(token),
      device_id: device,
      last_active_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", member.id);
  if (updateError) throw updateError;

  return rowToSession({
    family_id: family.id,
    family_name: family.name,
    family_code: family.family_code,
    member_id: member.id,
    member_token: token,
    device_id: device,
    nickname: member.nickname,
    role: member.role,
    is_admin: member.is_admin,
  });
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuthUser(req);
    const body = (await req.json().catch(() => null)) as {
      action?: unknown;
      memberId?: unknown;
      memberToken?: unknown;
      familyCode?: unknown;
      nickname?: unknown;
      deviceId?: unknown;
      newName?: unknown;
      joinEnabled?: unknown;
      targetMemberId?: unknown;
    } | null;

    const action = String(body?.action ?? "");
    const sb = getSupabaseAdmin();

    if (action === "rejoin_member") {
      const session = await rejoinMemberByOwner(
        user.id,
        body?.familyCode,
        body?.nickname,
        body?.deviceId,
      );
      return jsonOk({ session });
    }

    const { member, family } = await requireOwnerAccount(
      user.id,
      body?.memberId,
      body?.memberToken,
    );

    if (action === "update_family_name") {
      const newName = cleanText(body?.newName, 30);
      if (!newName) throw new Error("family_name_required");
      const { error } = await sb
        .from("families")
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq("id", family.id);
      if (error) throw error;
      await sb.from("messages").insert({
        family_id: family.id,
        message_type: "system",
        content: `家庭名称已更新为「${newName}」`,
        system_event_type: "family_renamed",
        system_event_payload: { family_name: newName },
      });
      return jsonOk({ familyName: newName });
    }

    if (action === "reset_family_code") {
      const newCode = await generateUniqueFamilyCode();
      const { error } = await sb
        .from("families")
        .update({
          family_code: newCode,
          code_updated_at: new Date().toISOString(),
          code_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", family.id);
      if (error) throw error;
      await sb.from("messages").insert({
        family_id: family.id,
        message_type: "system",
        content: "家庭代码已重置",
        system_event_type: "family_code_reset",
        system_event_payload: {},
      });
      return jsonOk({ familyCode: newCode });
    }

    if (action === "set_join_enabled") {
      const next = Boolean(body?.joinEnabled);
      const { error } = await sb
        .from("families")
        .update({ join_enabled: next, updated_at: new Date().toISOString() })
        .eq("id", family.id);
      if (error) throw error;
      await sb.from("messages").insert({
        family_id: family.id,
        message_type: "system",
        content: next ? "管理员开启了新成员加入" : "管理员关闭了新成员加入",
        system_event_type: next ? "join_enabled" : "join_disabled",
        system_event_payload: {},
      });
      return jsonOk({ joinEnabled: next });
    }

    if (action === "remove_member") {
      const targetId = String(body?.targetMemberId ?? "");
      if (!targetId || targetId === member.member_id) throw new Error("cannot_remove_self");
      const { data: target, error: targetError } = await sb
        .from("family_members")
        .select("id, nickname")
        .eq("id", targetId)
        .eq("family_id", family.id)
        .eq("status", "active")
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) throw new Error("member_not_found");
      const { error } = await sb
        .from("family_members")
        .update({ status: "removed", updated_at: new Date().toISOString() })
        .eq("id", target.id);
      if (error) throw error;
      await sb.from("messages").insert({
        family_id: family.id,
        message_type: "system",
        content: `${target.nickname} 已被移出家庭`,
        system_event_type: "member_removed",
        system_event_payload: { nickname: target.nickname },
      });
      return jsonOk({ ok: true });
    }

    throw new Error("not_allowed");
  } catch (error) {
    return apiError(error);
  }
}
