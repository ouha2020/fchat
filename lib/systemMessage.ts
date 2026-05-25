import type { TranslationKey } from "@/lib/i18n";
import type { Message, SystemEventType } from "@/types/message";

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;
type Tone = "joined" | "left" | "neutral";
type SystemMessageInput =
  | Pick<Message, "content" | "system_event_type" | "system_event_payload">
  | string
  | null;

const EVENT_MAP: Record<
  SystemEventType,
  {
    key: TranslationKey;
    payloadKey?: "family_name" | "nickname";
    varName?: string;
    tone?: Exclude<Tone, "neutral">;
  }
> = {
  family_created: {
    key: "systemFamilyCreated",
    payloadKey: "family_name",
    varName: "name",
  },
  member_joined: {
    key: "systemMemberJoined",
    payloadKey: "nickname",
    varName: "nickname",
    tone: "joined",
  },
  family_renamed: {
    key: "systemFamilyRenamed",
    payloadKey: "family_name",
    varName: "name",
  },
  family_code_reset: {
    key: "systemFamilyCodeReset",
  },
  join_enabled: {
    key: "systemJoinEnabled",
  },
  join_disabled: {
    key: "systemJoinDisabled",
  },
  member_removed: {
    key: "systemMemberRemoved",
    payloadKey: "nickname",
    varName: "nickname",
    tone: "left",
  },
  member_left: {
    key: "systemMemberLeft",
    payloadKey: "nickname",
    varName: "nickname",
    tone: "left",
  },
  admin_password_changed: {
    key: "systemAdminPasswordChanged",
  },
};

const LEGACY_PATTERNS: Array<{
  pattern: RegExp;
  key: TranslationKey;
  varName?: string;
  tone?: Exclude<Tone, "neutral">;
}> = [
  {
    pattern: /^家庭已创建，欢迎来到「(.+)」/,
    key: "systemFamilyCreated",
    varName: "name",
  },
  {
    pattern: /^(.+) 加入了家庭/,
    key: "systemMemberJoined",
    varName: "nickname",
    tone: "joined",
  },
  {
    pattern: /^家庭名称已更新为「(.+)」/,
    key: "systemFamilyRenamed",
    varName: "name",
  },
  {
    pattern: /^家庭代码已重置/,
    key: "systemFamilyCodeReset",
  },
  {
    pattern: /^管理员开启了新成员加入/,
    key: "systemJoinEnabled",
  },
  {
    pattern: /^管理员关闭了新成员加入/,
    key: "systemJoinDisabled",
  },
  {
    pattern: /^(.+) 已被移出家庭$/,
    key: "systemMemberRemoved",
    varName: "nickname",
    tone: "left",
  },
  {
    pattern: /^(.+) 离开了家庭/,
    key: "systemMemberLeft",
    varName: "nickname",
    tone: "left",
  },
  {
    pattern: /^管理员已修改管理密码/,
    key: "systemAdminPasswordChanged",
  },
];

const LEGACY_CORRUPTED_MARKERS = {
  familyCreated: "\u{93bb}\u{6391}\u{7061}",
  familyRenamed: "\u{5d25}\u{5ba5}",
  codeReset: "\u{951d}\u{56e9}\u{57b3}",
  joinEnabled: "\u{59af}\u{8679}\u{78fb}",
  joinDisabled: "\u{59af}\u{54c4}\u{5f60}",
  memberJoined:
    "\u{95b8}\u{65c2}\u{59f4}\u{9359}\u{55d8}\u{798d}\u{9361}\u{694a}\u{5540}",
  memberRemoved:
    "\u{7039}\u{6b4c}\u{5c2a}\u{986b}\u{fe3e}\u{7c94}",
  memberLeft:
    "\u{7f01}\u{509d}\u{e1e7}\u{7ef1}\u{621e}\u{798d}\u{9361}\u{694a}\u{5540}",
} as const;

export function localizeSystemMessage(input: SystemMessageInput, t: T): string {
  const structured = parseStructured(input);
  if (structured) {
    const event = EVENT_MAP[structured.system_event_type];
    if (event) {
      if (!event.payloadKey || !event.varName) return t(event.key);
      const value = payloadText(structured.system_event_payload, event.payloadKey);
      if (value) return t(event.key, { [event.varName]: value });
    }
  }

  const content = contentFromInput(input);
  if (!content) return "";

  const legacy = matchLegacy(content);
  if (legacy) {
    return legacy.varName
      ? t(legacy.key, { [legacy.varName]: legacy.value ?? "" })
      : t(legacy.key);
  }

  return content;
}

export function getSystemMessageTone(input: SystemMessageInput): Tone {
  const structured = parseStructured(input);
  if (structured) {
    return EVENT_MAP[structured.system_event_type]?.tone ?? "neutral";
  }

  const content = contentFromInput(input);
  if (!content) return "neutral";
  return matchLegacy(content)?.tone ?? "neutral";
}

function parseStructured(input: SystemMessageInput) {
  if (!input || typeof input === "string" || !input.system_event_type) {
    return null;
  }
  return {
    system_event_type: input.system_event_type,
    system_event_payload: input.system_event_payload,
  };
}

function contentFromInput(input: SystemMessageInput): string | null {
  return typeof input === "string" ? input : input?.content ?? null;
}

function matchLegacy(
  content: string,
): {
  key: TranslationKey;
  varName?: string;
  value?: string;
  tone?: Exclude<Tone, "neutral">;
} | null {
  for (const item of LEGACY_PATTERNS) {
    const match = content.match(item.pattern);
    if (match) {
      return { ...item, value: match[1] };
    }
  }

  if (content.includes(LEGACY_CORRUPTED_MARKERS.familyCreated)) {
    return {
      key: "systemFamilyCreated",
      varName: "name",
      value: valueAfterQuestionMark(content),
    };
  }
  if (content.includes(LEGACY_CORRUPTED_MARKERS.familyRenamed)) {
    return {
      key: "systemFamilyRenamed",
      varName: "name",
      value: valueAfterQuestionMark(content),
    };
  }
  if (content.includes(LEGACY_CORRUPTED_MARKERS.codeReset)) {
    return { key: "systemFamilyCodeReset" };
  }
  if (content.includes(LEGACY_CORRUPTED_MARKERS.joinEnabled)) {
    return { key: "systemJoinEnabled" };
  }
  if (content.includes(LEGACY_CORRUPTED_MARKERS.joinDisabled)) {
    return { key: "systemJoinDisabled" };
  }
  if (content.includes(LEGACY_CORRUPTED_MARKERS.memberJoined)) {
    return {
      key: "systemMemberJoined",
      varName: "nickname",
      value: valueBefore(content, LEGACY_CORRUPTED_MARKERS.memberJoined),
      tone: "joined",
    };
  }
  if (content.includes(LEGACY_CORRUPTED_MARKERS.memberRemoved)) {
    return {
      key: "systemMemberRemoved",
      varName: "nickname",
      value: valueBefore(content, LEGACY_CORRUPTED_MARKERS.memberRemoved),
      tone: "left",
    };
  }
  if (content.includes(LEGACY_CORRUPTED_MARKERS.memberLeft)) {
    return {
      key: "systemMemberLeft",
      varName: "nickname",
      value: valueBefore(content, LEGACY_CORRUPTED_MARKERS.memberLeft),
      tone: "left",
    };
  }

  return null;
}

function payloadText(
  payload: Record<string, unknown> | null,
  key: "family_name" | "nickname",
): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function valueBefore(content: string, needle: string): string {
  return content.split(needle)[0]?.trim() ?? "";
}

function valueAfterQuestionMark(content: string): string {
  const index = content.indexOf("?");
  if (index < 0) return "";
  return content
    .slice(index + 1)
    .replace(/閵\??$/, "")
    .trim();
}
