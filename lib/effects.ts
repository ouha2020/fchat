export type EffectId =
  | "hearts"
  | "fireworks"
  | "confetti"
  | "money"
  | "sparkles"
  | "cake";

export interface Effect {
  id: EffectId;
  caption?: string;
}

const SPECIAL: Record<string, Effect> = {
  // 爱心
  "1314": { id: "hearts", caption: "一生一世" },
  "5201": { id: "hearts", caption: "我爱你" },
  "0520": { id: "hearts", caption: "我爱你" },
  "0214": { id: "hearts", caption: "情人节快乐" },
  "1212": { id: "hearts", caption: "要爱要爱" },
  // 撒钱
  "8888": { id: "money", caption: "恭喜发财" },
  "6666": { id: "money", caption: "六六大顺" },
  "0801": { id: "money", caption: "发发发" },
  // 烟花
  "0000": { id: "fireworks", caption: "新年快乐" },
  "0101": { id: "fireworks", caption: "新年快乐" },
  "1111": { id: "fireworks", caption: "🎆 烟花 🎆" },
  // 蛋糕 / 生日
  "1230": { id: "cake", caption: "生日快乐" },
  "0824": { id: "cake", caption: "生日快乐" },
  "0606": { id: "cake", caption: "生日快乐" },
  // 闪光
  "9999": { id: "sparkles" },
  "5555": { id: "sparkles" },
};

const DEFAULT_EFFECT: Effect = { id: "confetti" };

export function detectEffect(
  content: string | null | undefined,
): Effect | null {
  if (!content) return null;
  const m = content.trim().match(/^#(\d{4})$/);
  if (!m) return null;
  const code = m[1];
  return SPECIAL[code] ?? DEFAULT_EFFECT;
}
