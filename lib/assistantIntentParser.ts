"use client";

import type { CreateAssistantActionCardInput } from "@/types/assistant";
import type { FamilyMember } from "@/types/member";
import type { Message } from "@/types/message";

interface ParseContext {
  members: FamilyMember[];
  currentMemberId: string;
  latestVisibleMessage?: Message | null;
  now?: Date;
}

export interface ScheduleLookupIntent {
  action: "update" | "cancel";
  query: string;
  rangeStart: string;
  rangeEnd: string;
  newStartsAt?: string | null;
  originalText: string;
}

type AssistantCreateDraft = Omit<CreateAssistantActionCardInput, "source_message_id"> & {
  reason?: "missing_time" | "missing_target";
};

type AssistantLookupDraft = {
  reason: "schedule_lookup";
  scheduleLookup: ScheduleLookupIntent;
};

export type ParsedAssistantIntent = AssistantCreateDraft | AssistantLookupDraft;

const REMINDER_RE =
  /(提醒|通知|告诉|告訴|记得|記得|リマインド|知らせ|通知して|教えて|remind|notify)/i;
const SCHEDULE_RE =
  /(日程|安排|计划|計画|预约|預約|予定|スケジュール|病院|医院|醫院|学校|學校|幼稚園|保育園|appointment|hospital|school|schedule)/i;
const SCHEDULE_FILLER_RE =
  /(日程|安排|计划|計画|预约|預約|予定|スケジュール|appointment|schedule)/i;
const IMPORTANT_RE =
  /(重要|大事|设为重要|設為重要|提醒大家|通知大家|これ大事|大切|重要に|みんなに知らせ|important|mark\s+this\s+important|remind\s+everyone)/i;
const PRIVATE_RE =
  /(只提醒我|只告诉我|只告訴我|私下|私人|非公开|非公開|自分だけ|個人|private)/i;
const TASK_RE =
  /(接|送|带|帶|买|買|拿|倒垃圾|做|负责|負責|迎え|送る|買う|持って|ゴミ|pick\s+up|take|bring|buy|trash|garbage|do\b)/i;
const UPDATE_RE =
  /(改到|改为|改為|改成|变更|変更|ずら|変更して|change|move|reschedule)/i;
const CANCEL_RE =
  /(取消|删除|刪除|キャンセル|取り消|やめ|cancel|delete)/i;

export function parseAssistantIntent(
  rawText: string,
  context: ParseContext,
): ParsedAssistantIntent | null {
  const text = normalizeAssistantText(rawText.trim());
  if (!text) return null;

  const now = context.now ?? new Date();
  const scheduleChange = parseScheduleChange(text, now);
  if (scheduleChange) return scheduleChange;

  const important = IMPORTANT_RE.test(text);
  const reminder = REMINDER_RE.test(text);
  const parsedTime = parseRelativeDateTime(text, now);
  const schedule = SCHEDULE_RE.test(text) || looksLikeScheduledTrip(text, now);
  const assignee = findAssignee(text, context.members, context.currentMemberId);
  const hasExplicitAssignee = Boolean(assignee?.explicit);
  const task = hasExplicitAssignee && TASK_RE.test(text);

  if (important && !reminder && !schedule && !task) {
    if (!context.latestVisibleMessage) {
      return { reason: "missing_target", ...emptyImportantDraft(text) };
    }
    return {
      card_type: "important",
      title: previewText(context.latestVisibleMessage),
      summary: text,
      target_message_id: context.latestVisibleMessage.id,
      payload: {
        original_text: text,
        source: "rule-parser",
        visibility: "family",
      },
    };
  }

  if (task && (!reminder || !parsedTime)) {
    const dueAt = parsedTime ?? parseTaskDueDate(text, now);
    return {
      card_type: "todo",
      title: compactTitle(text, "todo", context.members),
      summary: text,
      payload: {
        item_type: "todo",
        visibility: PRIVATE_RE.test(text) ? "private" : "family",
        starts_at: dueAt.toISOString(),
        remind_at: null,
        assignee_member_id: assignee?.member.id ?? context.currentMemberId,
        original_text: text,
        source: "rule-parser",
      },
    };
  }

  if (!reminder && !schedule) return null;

  if (!parsedTime) {
    return {
      reason: "missing_time",
      card_type: reminder ? "reminder" : "schedule",
      title: compactTitle(text, reminder ? "reminder" : "schedule", context.members),
      summary: text,
      payload: { original_text: text, source: "rule-parser" },
    };
  }

  const visibility = PRIVATE_RE.test(text) ? "private" : "family";
  const cardType = reminder ? "reminder" : "schedule";

  return {
    card_type: cardType,
    title: compactTitle(text, cardType, context.members),
    summary: text,
    payload: {
      item_type: cardType,
      visibility,
      starts_at: parsedTime.toISOString(),
      remind_at: cardType === "reminder" ? parsedTime.toISOString() : null,
      assignee_member_id: assignee?.member.id ?? context.currentMemberId,
      original_text: text,
      source: "rule-parser",
    },
  };
}

export function isAssistantSystemPayload(payload: Record<string, unknown> | null): boolean {
  return payload?.actor_type === "assistant";
}

export function isAssistantCreateDraft(
  draft: ParsedAssistantIntent | null,
): draft is AssistantCreateDraft {
  return Boolean(draft && "card_type" in draft);
}

function parseScheduleChange(text: string, now: Date): AssistantLookupDraft | null {
  const isCancel = CANCEL_RE.test(text);
  const isUpdate = UPDATE_RE.test(text);
  if (!isCancel && !isUpdate) return null;

  const query = extractScheduleQuery(text);
  if (!query && resolveDayOffset(text, now) == null && !resolveTime(text)) {
    return null;
  }

  const range = buildScheduleSearchRange(text, now);
  const newTime = isUpdate ? parseScheduleUpdateDateTime(text, now) : null;
  if (isUpdate && !newTime) return null;

  return {
    reason: "schedule_lookup",
    scheduleLookup: {
      action: isCancel ? "cancel" : "update",
      query,
      rangeStart: range.start.toISOString(),
      rangeEnd: range.end.toISOString(),
      newStartsAt: newTime?.toISOString() ?? null,
      originalText: text,
    },
  };
}

function emptyImportantDraft(text: string): AssistantCreateDraft {
  return {
    card_type: "important",
    title: text,
    summary: text,
    payload: { original_text: text, source: "rule-parser" },
  };
}

function parseRelativeDateTime(text: string, now: Date): Date | null {
  const dayOffset = resolveDayOffset(text, now);
  const time = resolveTime(text);
  const period = resolvePeriod(text);

  if (dayOffset == null && !time) return null;

  const date = new Date(now);
  date.setSeconds(0, 0);
  date.setDate(date.getDate() + (dayOffset ?? 0));

  let hour = time?.hour ?? null;
  const minute = time?.minute ?? 0;

  if (hour == null) {
    if (period === "morning") hour = 9;
    if (period === "afternoon") hour = 15;
    if (period === "evening") hour = 20;
  } else if ((period === "afternoon" || period === "evening") && hour < 12) {
    hour += 12;
  }

  if (hour == null || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  date.setHours(hour, minute, 0, 0);
  return date;
}

function parseScheduleUpdateDateTime(text: string, now: Date): Date | null {
  const updateMatch = text.match(UPDATE_RE);
  const afterUpdate =
    updateMatch?.index != null ? text.slice(updateMatch.index + updateMatch[0].length) : text;
  const time = resolveLastTime(afterUpdate) ?? resolveLastTime(text);
  const dayOffset = resolveDayOffset(text, now);
  const period = resolvePeriod(afterUpdate) ?? resolvePeriod(text);
  if (!time) return null;

  const date = new Date(now);
  date.setSeconds(0, 0);
  date.setDate(date.getDate() + (dayOffset ?? 0));

  let hour = time.hour;
  if ((period === "afternoon" || period === "evening") && hour < 12) hour += 12;
  date.setHours(hour, time.minute, 0, 0);
  return date;
}

function parseTaskDueDate(text: string, now: Date): Date {
  const exact = parseRelativeDateTime(text, now);
  if (exact) return exact;

  const date = new Date(now);
  date.setSeconds(0, 0);
  date.setDate(date.getDate() + (resolveDayOffset(text, now) ?? 0));
  date.setHours(23, 59, 0, 0);
  return date;
}

function resolveDayOffset(text: string, now: Date): number | null {
  if (/(今天|今日|きょう|今日|today)/i.test(text)) return 0;
  if (/(明天|明日|あした|あす|tomorrow)/i.test(text)) return 1;
  if (/(后天|後天|明後日|あさって|day\s+after\s+tomorrow)/i.test(text)) return 2;

  const weekdays = [
    /(周日|周天|星期日|星期天|礼拜日|礼拜天|日曜|日曜日|sunday)/i,
    /(周一|星期一|礼拜一|月曜|月曜日|monday)/i,
    /(周二|星期二|礼拜二|火曜|火曜日|tuesday)/i,
    /(周三|星期三|礼拜三|水曜|水曜日|wednesday)/i,
    /(周四|星期四|礼拜四|木曜|木曜日|thursday)/i,
    /(周五|星期五|礼拜五|金曜|金曜日|friday)/i,
    /(周六|星期六|礼拜六|土曜|土曜日|saturday)/i,
  ];

  const target = weekdays.findIndex((re) => re.test(text));
  if (target < 0) return null;
  const offset = (target - now.getDay() + 7) % 7;
  return offset === 0 ? 7 : offset;
}

function resolveTime(text: string): { hour: number; minute: number } | null {
  const matches = [...text.matchAll(timePattern())];
  const raw = matches.at(-1);
  if (!raw) return null;
  return normalizeTimeMatch(raw);
}

function resolveLastTime(text: string): { hour: number; minute: number } | null {
  return resolveTime(text);
}

function normalizeTimeMatch(match: RegExpMatchArray): { hour: number; minute: number } | null {
  const prefix = String(match.groups?.prefix ?? "").toLowerCase();
  const hourValue = Number(match.groups?.hour);
  const minuteValue = match.groups?.half
    ? 30
    : match.groups?.minute
      ? Number(match.groups.minute)
      : 0;
  const suffix = String(match.groups?.suffix ?? "").toLowerCase();
  if (!Number.isFinite(hourValue) || !Number.isFinite(minuteValue)) return null;

  let hour = hourValue;
  const afternoon =
    /下午|晚上|夜|午後|pm/.test(prefix) || /pm/.test(suffix);
  const morning = /上午|早上|午前|朝|am/.test(prefix) || /am/.test(suffix);

  if (afternoon && hour < 12) hour += 12;
  if (morning && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minuteValue < 0 || minuteValue > 59) return null;
  return { hour, minute: minuteValue };
}

function timePattern(): RegExp {
  return /(?<prefix>上午|早上|下午|晚上|午前|午後|朝|夜|morning|afternoon|evening|night)?\s*(?:at\s*)?(?<hour>[01]?\d|2[0-3])\s*(?:(?::|：|点|點|時|时)\s*(?<minute>[0-5]?\d)?(?<half>半)?)?\s*(?<suffix>am|pm)?/gi;
}

function resolvePeriod(text: string): "morning" | "afternoon" | "evening" | null {
  if (/(上午|早上|午前|朝|morning|am\b)/i.test(text)) return "morning";
  if (/(下午|午後|afternoon|pm\b)/i.test(text)) return "afternoon";
  if (/(晚上|夜|夕方|evening|night)/i.test(text)) return "evening";
  return null;
}

function looksLikeScheduledTrip(text: string, now: Date): boolean {
  if (resolveDayOffset(text, now) == null && !resolveTime(text)) return false;
  return /(去|到|参加|參加|睡觉|睡覺|起床|吃饭|吃飯|上学|上學|放学|放學|上班|下班|开会|開會|见面|見面|行く|行き|行きます|寝る|寝ます|起きる|起きます|食べる|食べます|会う|会います|遊ぶ|遊び|勉強|仕事|出勤|退勤|帰る|帰宅|する|します|やる|go|visit|appointment|sleep|wake|eat|meet|work|study)/i.test(text);
}

function normalizeAssistantText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[Ａ-Ｚａ-ｚ]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/\u3000/g, " ");
}

function findAssignee(
  text: string,
  members: FamilyMember[],
  currentMemberId: string,
): { member: FamilyMember; explicit: boolean } | null {
  const activeMembers = members.filter((member) => member.status !== "removed");
  const byNickname = activeMembers.find(
    (member) => member.nickname && text.includes(member.nickname),
  );
  if (byNickname) return { member: byNickname, explicit: true };

  const byRole = activeMembers.find((member) => {
    if (member.role === "mother") return /(妈妈|媽媽|妈|媽|ママ|お母さん|母|mom|mother)/i.test(text);
    if (member.role === "father") return /(爸爸|爸|パパ|お父さん|父|dad|father)/i.test(text);
    if (member.role === "child") {
      return /(孩子|小孩|儿子|兒子|女儿|女兒|哥哥|姐姐|弟弟|妹妹|子ども|子供|息子|娘|child|kid)/i.test(text);
    }
    return false;
  });
  if (byRole) return { member: byRole, explicit: true };

  const current = activeMembers.find((member) => member.id === currentMemberId) ?? null;
  return current ? { member: current, explicit: false } : null;
}

function compactTitle(
  text: string,
  type: "reminder" | "schedule" | "todo",
  members: FamilyMember[],
): string {
  let cleaned = text
    .replace(REMINDER_RE, " ")
    .replace(SCHEDULE_FILLER_RE, " ")
    .replace(PRIVATE_RE, " ")
    .replace(/(请|請|帮我|幫我|お願い|please|ask)/gi, " ")
    .replace(/(から|まで|には|では|へ|を|に|は|で)/g, " ")
    .replace(timeWordsRe(), " ")
    .replace(roleWordsRe(), " ")
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  members.forEach((member) => {
    if (member.nickname) cleaned = cleaned.replaceAll(member.nickname, "");
  });
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  if (cleaned) return cleaned.slice(0, 60);
  if (type === "todo") return "任务";
  return type === "reminder" ? "提醒" : "日程";
}

function extractScheduleQuery(text: string): string {
  return text
    .replace(UPDATE_RE, " ")
    .replace(CANCEL_RE, " ")
    .replace(/(把|将|將|を|から|到|至|to|from)/gi, " ")
    .replace(timeWordsRe(), " ")
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function buildScheduleSearchRange(text: string, now: Date): { start: Date; end: Date } {
  const dayOffset = resolveDayOffset(text, now);
  if (dayOffset != null) {
    const start = new Date(now);
    start.setDate(start.getDate() + dayOffset);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  const start = new Date(now);
  start.setDate(start.getDate() - 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function timeWordsRe(): RegExp {
  return /(今天|今日|きょう|明天|明日|あした|あす|后天|後天|明後日|あさって|today|tomorrow|day\s+after\s+tomorrow|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|[月火水木金土日]曜日?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|上午|早上|下午|晚上|午前|午後|朝|夜|morning|afternoon|evening|night|(?:at\s*)?\d{1,2}\s*(?::|：|点|點|時|时)?\s*\d{0,2}\s*(?:am|pm)?)/gi;
}

function roleWordsRe(): RegExp {
  return /(妈妈|媽媽|妈|媽|爸爸|爸|ママ|パパ|お母さん|お父さん|mom|mother|dad|father)/gi;
}

function previewText(message: Message): string {
  if (message.effect_caption) return message.effect_caption.slice(0, 60);
  if (message.content) return message.content.slice(0, 60);
  if (message.message_type === "image") return "图片消息";
  if (message.message_type === "audio") return "语音消息";
  if (message.message_type === "location") return "位置消息";
  return "这条消息";
}
