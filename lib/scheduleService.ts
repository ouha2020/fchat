"use client";

import type { LocalSession } from "@/lib/authLocal";
import { getSupabase } from "@/lib/supabaseClient";
import { uuidSchema } from "@/lib/validation";
import type {
  CreateScheduleItemInput,
  ScheduleAssigneeResponseStatus,
  ScheduleCollaboration,
  ScheduleRecurrenceScope,
  ScheduleRecurrenceRule,
  ScheduleReminderHealth,
  ScheduleReminderOffset,
  ScheduleReminderStatus,
  ScheduleItem,
  ScheduleItemType,
  ScheduleStatus,
  ScheduleVisibility,
  UpdateScheduleItemInput,
} from "@/types/schedule";

const ITEM_TYPES = new Set(["schedule", "todo", "reminder"]);
const VISIBILITIES = new Set(["family", "private"]);
const RECURRENCE_RULES = new Set(["none", "daily", "weekly", "monthly"]);
const RECURRENCE_SCOPES = new Set(["single", "future", "all"]);
const REMINDER_OFFSETS = new Set<number>([0, 10, 30, 60, 1440]);
const SNOOZE_MINUTES = new Set<number>([5, 10, 30]);

export interface ScheduleSearchFilters {
  rangeStart: Date;
  rangeEnd: Date;
  query?: string | null;
  assigneeMemberId?: string | null;
  itemType?: ScheduleItemType | null;
  visibility?: ScheduleVisibility | null;
  limit?: number;
}

export async function listScheduleItems(
  session: LocalSession,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<ScheduleItem[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("list_schedule_items_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_range_start: rangeStart.toISOString(),
    p_range_end: rangeEnd.toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as ScheduleItem[];
}

export async function searchScheduleItems(
  session: LocalSession,
  filters: ScheduleSearchFilters,
): Promise<ScheduleItem[]> {
  const query = filters.query?.trim() || null;
  if (query && query.length > 40) throw new Error("invalid_schedule_search");
  if (filters.assigneeMemberId) uuidSchema.parse(filters.assigneeMemberId);
  if (filters.itemType && !ITEM_TYPES.has(filters.itemType)) {
    throw new Error("invalid_schedule_filter");
  }
  if (filters.visibility && !VISIBILITIES.has(filters.visibility)) {
    throw new Error("invalid_schedule_filter");
  }

  const sb = getSupabase();
  const { data, error } = await sb.rpc("search_schedule_items_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_range_start: filters.rangeStart.toISOString(),
    p_range_end: filters.rangeEnd.toISOString(),
    p_query: query,
    p_assignee_member_id: filters.assigneeMemberId ?? null,
    p_item_type: filters.itemType ?? null,
    p_visibility: filters.visibility ?? null,
    p_limit: filters.limit ?? 300,
  });
  if (error) throw error;
  return (data ?? []) as ScheduleItem[];
}

export async function createScheduleItem(
  session: LocalSession,
  input: CreateScheduleItemInput,
): Promise<string> {
  const parsed = parseCreateInput(input);
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_schedule_item", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_title: parsed.title,
    p_note: parsed.note,
    p_item_type: parsed.item_type,
    p_visibility: parsed.visibility,
    p_starts_at: parsed.starts_at,
    p_ends_at: parsed.ends_at,
    p_remind_at: parsed.remind_at,
    p_assignee_member_id: parsed.assignee_member_id,
    p_recurrence_rule: parsed.recurrence_rule,
  });
  if (error) throw error;
  const itemId = data as string;
  await setScheduleReminderRules(
    session,
    itemId,
    parsed.reminder_offsets ?? [],
    parsed.recurrence_rule === "none" ? "single" : "all",
  );
  return itemId;
}

export async function getScheduleItem(
  session: LocalSession,
  scheduleItemId: string,
): Promise<ScheduleItem | null> {
  uuidSchema.parse(scheduleItemId);
  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_schedule_item_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_item_id: scheduleItemId,
  });
  if (error) throw error;
  const rows = (data ?? []) as ScheduleItem[];
  return rows[0] ?? null;
}

export async function updateScheduleItem(
  session: LocalSession,
  input: UpdateScheduleItemInput,
): Promise<void> {
  uuidSchema.parse(input.id);
  const parsed = parseCreateInput(input);
  const scope = parseScope(input.recurrence_scope);
  const sb = getSupabase();
  const { error } = await sb.rpc("update_schedule_item", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_item_id: input.id,
    p_title: parsed.title,
    p_note: parsed.note,
    p_item_type: parsed.item_type,
    p_visibility: parsed.visibility,
    p_assignee_member_id: parsed.assignee_member_id,
    p_starts_at: parsed.starts_at,
    p_ends_at: parsed.ends_at,
    p_remind_at: parsed.remind_at,
    p_recurrence_scope: scope,
  });
  if (error) throw error;
  await setScheduleReminderRules(
    session,
    input.id,
    parsed.reminder_offsets ?? [],
    scope,
  );
}

export async function replaceScheduleItemRecurrence(
  session: LocalSession,
  input: UpdateScheduleItemInput,
): Promise<string> {
  uuidSchema.parse(input.id);
  const parsed = parseCreateInput(input);
  const scope = parseScope(input.recurrence_scope);
  const sb = getSupabase();
  const { data, error } = await sb.rpc("replace_schedule_item_recurrence", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_item_id: input.id,
    p_title: parsed.title,
    p_note: parsed.note,
    p_item_type: parsed.item_type,
    p_visibility: parsed.visibility,
    p_assignee_member_id: parsed.assignee_member_id,
    p_starts_at: parsed.starts_at,
    p_ends_at: parsed.ends_at,
    p_remind_at: parsed.remind_at,
    p_recurrence_rule: parsed.recurrence_rule,
    p_recurrence_scope: scope,
  });
  if (error) throw error;
  const itemId = data as string;
  uuidSchema.parse(itemId);
  await setScheduleReminderRules(
    session,
    itemId,
    parsed.reminder_offsets ?? [],
    parsed.recurrence_rule === "none" ? "single" : "all",
  );
  return itemId;
}

export async function setScheduleItemStatus(
  session: LocalSession,
  scheduleItemId: string,
  status: Extract<ScheduleStatus, "active" | "done">,
): Promise<void> {
  uuidSchema.parse(scheduleItemId);
  if (status !== "active" && status !== "done") {
    throw new Error("invalid_schedule_status");
  }

  const sb = getSupabase();
  const { error } = await sb.rpc("set_schedule_item_status", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_schedule_item_id: scheduleItemId,
    p_status: status,
  });
  if (error) throw error;
}

export async function deleteScheduleItem(
  session: LocalSession,
  scheduleItemId: string,
  recurrenceScope: ScheduleRecurrenceScope = "single",
): Promise<void> {
  uuidSchema.parse(scheduleItemId);
  const scope = parseScope(recurrenceScope);
  const sb = getSupabase();
  const { error } = await sb.rpc("delete_schedule_item", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_schedule_item_id: scheduleItemId,
    p_recurrence_scope: scope,
  });
  if (error) throw error;
}

export async function getScheduleCollaboration(
  session: LocalSession,
  scheduleItemId: string,
): Promise<ScheduleCollaboration> {
  uuidSchema.parse(scheduleItemId);
  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_schedule_collaboration_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_schedule_item_id: scheduleItemId,
  });
  if (error) throw error;
  return normalizeCollaboration(data);
}

export async function getScheduleReminderStatus(
  session: LocalSession,
  scheduleItemId: string,
): Promise<ScheduleReminderStatus> {
  uuidSchema.parse(scheduleItemId);
  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_schedule_reminder_status_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_schedule_item_id: scheduleItemId,
  });
  if (error) throw error;
  return normalizeReminderStatus(data);
}

export async function snoozeScheduleReminder(
  session: LocalSession,
  deliveryId: string,
  minutes: 5 | 10 | 30,
): Promise<string> {
  uuidSchema.parse(deliveryId);
  if (!SNOOZE_MINUTES.has(minutes)) {
    throw new Error("invalid_schedule_snooze_minutes");
  }

  const sb = getSupabase();
  const { data, error } = await sb.rpc("snooze_schedule_reminder", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_delivery_id: deliveryId,
    p_minutes: minutes,
  });
  if (error) throw error;
  return data as string;
}

export async function getScheduleReminderHealth(
  session: LocalSession,
): Promise<ScheduleReminderHealth> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_schedule_reminder_health_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
  });
  if (error) throw error;
  return normalizeReminderHealth(data);
}

export async function addScheduleComment(
  session: LocalSession,
  scheduleItemId: string,
  content: string,
): Promise<string> {
  uuidSchema.parse(scheduleItemId);
  const parsed = content.trim();
  if (!parsed) throw new Error("schedule_comment_required");
  if (parsed.length > 300) throw new Error("schedule_comment_too_long");

  const sb = getSupabase();
  const { data, error } = await sb.rpc("add_schedule_comment", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_schedule_item_id: scheduleItemId,
    p_content: parsed,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteScheduleComment(
  session: LocalSession,
  commentId: string,
): Promise<void> {
  uuidSchema.parse(commentId);
  const sb = getSupabase();
  const { error } = await sb.rpc("delete_schedule_comment", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_comment_id: commentId,
  });
  if (error) throw error;
}

export async function respondScheduleAssignment(
  session: LocalSession,
  scheduleItemId: string,
  response: Extract<ScheduleAssigneeResponseStatus, "accepted" | "declined">,
  note?: string | null,
): Promise<void> {
  uuidSchema.parse(scheduleItemId);
  if (response !== "accepted" && response !== "declined") {
    throw new Error("invalid_schedule_response");
  }
  const parsedNote = note?.trim() || null;
  if (parsedNote && parsedNote.length > 300) {
    throw new Error("schedule_response_note_too_long");
  }

  const sb = getSupabase();
  const { error } = await sb.rpc("respond_schedule_assignment", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_schedule_item_id: scheduleItemId,
    p_response: response,
    p_note: parsedNote,
  });
  if (error) throw error;
}

function parseScope(
  scope: ScheduleRecurrenceScope | null | undefined,
): ScheduleRecurrenceScope {
  const value = scope ?? "single";
  if (!RECURRENCE_SCOPES.has(value)) throw new Error("invalid_schedule_scope");
  return value;
}

function parseCreateInput(input: CreateScheduleItemInput): CreateScheduleItemInput {
  const title = input.title.trim();
  const note = input.note?.trim() || null;

  if (!title) throw new Error("schedule_title_required");
  if (title.length > 60) throw new Error("schedule_title_too_long");
  if (!ITEM_TYPES.has(input.item_type)) throw new Error("invalid_schedule_type");
  if (!VISIBILITIES.has(input.visibility)) {
    throw new Error("invalid_schedule_visibility");
  }
  const recurrenceRule = input.recurrence_rule ?? "none";
  if (!RECURRENCE_RULES.has(recurrenceRule)) {
    throw new Error("invalid_schedule_recurrence");
  }
  uuidSchema.parse(input.assignee_member_id);
  if (!input.starts_at || Number.isNaN(Date.parse(input.starts_at))) {
    throw new Error("invalid_schedule_time");
  }
  if (input.ends_at && Date.parse(input.ends_at) <= Date.parse(input.starts_at)) {
    throw new Error("invalid_schedule_time");
  }
  const startsAt = new Date(input.starts_at).toISOString();
  const reminderOffsets = normalizeReminderOffsets(input.reminder_offsets);

  return {
    title,
    note,
    item_type: input.item_type,
    visibility: input.visibility,
    starts_at: startsAt,
    ends_at: input.ends_at ? new Date(input.ends_at).toISOString() : null,
    remind_at:
      reminderOffsets.length > 0
        ? earliestReminderIso(startsAt, reminderOffsets)
        : input.remind_at
          ? new Date(input.remind_at).toISOString()
          : null,
    reminder_offsets: reminderOffsets,
    recurrence_rule: recurrenceRule as ScheduleRecurrenceRule,
    assignee_member_id: input.assignee_member_id,
  };
}

async function setScheduleReminderRules(
  session: LocalSession,
  scheduleItemId: string,
  offsets: ScheduleReminderOffset[],
  recurrenceScope: ScheduleRecurrenceScope,
): Promise<void> {
  uuidSchema.parse(scheduleItemId);
  const sb = getSupabase();
  const { error } = await sb.rpc("set_schedule_reminder_rules", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_schedule_item_id: scheduleItemId,
    p_offsets: normalizeReminderOffsets(offsets),
    p_recurrence_scope: recurrenceScope,
  });
  if (error) throw error;
}

function normalizeReminderOffsets(
  offsets: ScheduleReminderOffset[] | undefined,
): ScheduleReminderOffset[] {
  if (!offsets || offsets.length === 0) return [];
  const unique = [...new Set(offsets.map((offset) => Number(offset)))].sort(
    (a, b) => a - b,
  );
  if (unique.length > 5 || unique.some((offset) => !REMINDER_OFFSETS.has(offset))) {
    throw new Error("invalid_schedule_reminder_offset");
  }
  return unique as ScheduleReminderOffset[];
}

function earliestReminderIso(
  startsAt: string,
  offsets: ScheduleReminderOffset[],
): string | null {
  if (offsets.length === 0) return null;
  const startMs = new Date(startsAt).getTime();
  const maxOffset = Math.max(...offsets);
  return new Date(startMs - maxOffset * 60_000).toISOString();
}

function normalizeCollaboration(value: unknown): ScheduleCollaboration {
  const raw = (value ?? {}) as Partial<ScheduleCollaboration>;
  return {
    comments: Array.isArray(raw.comments) ? raw.comments : [],
    activity_logs: Array.isArray(raw.activity_logs) ? raw.activity_logs : [],
    assignee_response: raw.assignee_response ?? {
      status: "pending",
      responded_at: null,
      note: null,
    },
  };
}

function normalizeReminderStatus(value: unknown): ScheduleReminderStatus {
  const raw = (value ?? {}) as Partial<ScheduleReminderStatus>;
  return {
    configured: Boolean(raw.configured),
    remind_at: raw.remind_at ?? null,
    rules: normalizeReminderOffsets(raw.rules),
    current_member_delivery: raw.current_member_delivery ?? null,
    deliveries: Array.isArray(raw.deliveries) ? raw.deliveries : [],
  };
}

function normalizeReminderHealth(value: unknown): ScheduleReminderHealth {
  const raw = (value ?? {}) as Partial<ScheduleReminderHealth>;
  return {
    pending: Number(raw.pending ?? 0),
    sent: Number(raw.sent ?? 0),
    failed: Number(raw.failed ?? 0),
    gone: Number(raw.gone ?? 0),
    skipped: Number(raw.skipped ?? 0),
    private_failed: Number(raw.private_failed ?? 0),
    recentFailures: Array.isArray(raw.recentFailures) ? raw.recentFailures : [],
  };
}
