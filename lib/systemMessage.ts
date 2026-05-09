import type { TranslationKey } from "@/lib/i18n";

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;

const PATTERNS: Array<{
  pattern: RegExp;
  key: TranslationKey;
  varName?: string;
  tone?: "joined" | "left";
}> = [
  {
    pattern: /^家庭已创建，欢迎来到「(.+)」$/,
    key: "systemFamilyCreated",
    varName: "name",
  },
  {
    pattern: /^(.+) 加入了家庭$/,
    key: "systemMemberJoined",
    varName: "nickname",
    tone: "joined",
  },
  {
    pattern: /^家庭名称已更新为「(.+)」$/,
    key: "systemFamilyRenamed",
    varName: "name",
  },
  {
    pattern: /^家庭代码已重置$/,
    key: "systemFamilyCodeReset",
  },
  {
    pattern: /^管理员开启了新成员加入$/,
    key: "systemJoinEnabled",
  },
  {
    pattern: /^管理员关闭了新成员加入$/,
    key: "systemJoinDisabled",
  },
  {
    pattern: /^(.+) 已被移出家庭$/,
    key: "systemMemberRemoved",
    varName: "nickname",
    tone: "left",
  },
  {
    pattern: /^(.+) 离开了家庭$/,
    key: "systemMemberLeft",
    varName: "nickname",
    tone: "left",
  },
];

export function localizeSystemMessage(content: string | null, t: T): string {
  if (!content) return "";
  for (const item of PATTERNS) {
    const match = content.match(item.pattern);
    if (!match) continue;
    return item.varName ? t(item.key, { [item.varName]: match[1] }) : t(item.key);
  }
  return content;
}

export function getSystemMessageTone(
  content: string | null,
): "joined" | "left" | "neutral" {
  if (!content) return "neutral";
  const match = PATTERNS.find((item) => item.tone && item.pattern.test(content));
  return match?.tone ?? "neutral";
}
