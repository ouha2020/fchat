"use client";

import type { LocalSession } from "@/lib/authLocal";
import { getSupabase } from "@/lib/supabaseClient";
import { uuidSchema } from "@/lib/validation";
import type {
  CreateKeeperRequestInput,
  CreateKeeperRequestResult,
  KeeperRequest,
} from "@/types/keeper";

const REQUEST_TYPES = new Set(["schedule", "todo", "reminder"]);
const VISIBILITIES = new Set(["family", "private"]);

export async function createKeeperRequest(
  session: LocalSession,
  input: CreateKeeperRequestInput,
): Promise<CreateKeeperRequestResult> {
  const parsed = parseCreateKeeperRequestInput(input);
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_keeper_request", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_request_text: parsed.request_text,
    p_request_type: parsed.request_type,
    p_assignee_member_id: parsed.assignee_member_id,
    p_visibility: parsed.visibility,
    p_starts_at: parsed.starts_at,
    p_remind_at: parsed.remind_at,
    p_note: parsed.note,
  });
  if (error) throw error;
  return data as CreateKeeperRequestResult;
}

export async function listKeeperRequests(
  session: LocalSession,
): Promise<KeeperRequest[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("list_keeper_requests_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
  });
  if (error) throw error;
  return (data ?? []) as KeeperRequest[];
}

function parseCreateKeeperRequestInput(
  input: CreateKeeperRequestInput,
): CreateKeeperRequestInput {
  const requestText = input.request_text.trim();
  const note = input.note?.trim() || null;

  if (!requestText) throw new Error("keeper_request_required");
  if (requestText.length > 300) throw new Error("keeper_request_too_long");
  if (!REQUEST_TYPES.has(input.request_type)) {
    throw new Error("invalid_keeper_request_type");
  }
  if (!VISIBILITIES.has(input.visibility)) {
    throw new Error("invalid_keeper_visibility");
  }
  uuidSchema.parse(input.assignee_member_id);
  if (!input.starts_at || Number.isNaN(Date.parse(input.starts_at))) {
    throw new Error("invalid_schedule_time");
  }
  if (input.remind_at && Number.isNaN(Date.parse(input.remind_at))) {
    throw new Error("invalid_schedule_time");
  }

  return {
    request_text: requestText,
    request_type: input.request_type,
    assignee_member_id: input.assignee_member_id,
    visibility: input.visibility,
    starts_at: new Date(input.starts_at).toISOString(),
    remind_at: input.remind_at ? new Date(input.remind_at).toISOString() : null,
    note,
  };
}
