"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type MoodKind = "joy" | "calm" | "tired" | "sad" | "thanks" | "brave";

interface MoodLeaf {
  id: string;
  ownerId: string;
  date: string;
  author: string;
  mood: MoodKind;
  title: string;
  text: string;
  visibility: "private" | "family" | "shared";
  x: number;
  y: number;
  rotate: number;
}

interface TreeOwner {
  id: string;
  nickname: string;
  role: string;
  initial: string;
  accent: string;
}

const treeOwners: TreeOwner[] = [
  {
    id: "dad",
    nickname: "爸爸",
    role: "お父さん",
    initial: "爸",
    accent: "#4f6cf7",
  },
  {
    id: "mom",
    nickname: "妈妈",
    role: "お母さん",
    initial: "妈",
    accent: "#ef8e6f",
  },
  {
    id: "child",
    nickname: "小小",
    role: "孩子",
    initial: "小",
    accent: "#7ac66a",
  },
];

const moodTheme: Record<
  MoodKind,
  { label: string; color: string; glow: string; bg: string }
> = {
  joy: {
    label: "开心",
    color: "#7ac66a",
    glow: "rgba(122, 198, 106, 0.34)",
    bg: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  calm: {
    label: "平静",
    color: "#72b7b1",
    glow: "rgba(114, 183, 177, 0.34)",
    bg: "bg-teal-50 text-teal-700 ring-teal-100",
  },
  tired: {
    label: "有点累",
    color: "#8ea4c8",
    glow: "rgba(142, 164, 200, 0.34)",
    bg: "bg-slate-100 text-slate-600 ring-slate-200",
  },
  sad: {
    label: "难过",
    color: "#a996d4",
    glow: "rgba(169, 150, 212, 0.34)",
    bg: "bg-violet-50 text-violet-700 ring-violet-100",
  },
  thanks: {
    label: "感谢",
    color: "#e7b94f",
    glow: "rgba(231, 185, 79, 0.34)",
    bg: "bg-amber-50 text-amber-700 ring-amber-100",
  },
  brave: {
    label: "勇敢",
    color: "#ef8e6f",
    glow: "rgba(239, 142, 111, 0.3)",
    bg: "bg-orange-50 text-orange-700 ring-orange-100",
  },
};

const leaves: MoodLeaf[] = [
  {
    id: "leaf-1",
    ownerId: "dad",
    date: "5月24日",
    author: "爸爸",
    mood: "calm",
    title: "今天想慢一点",
    text: "其实今天有点累，但看到大家都有回消息，就觉得家里还在身边。",
    visibility: "private",
    x: 52,
    y: 16,
    rotate: -18,
  },
  {
    id: "leaf-2",
    ownerId: "mom",
    date: "5月23日",
    author: "妈妈",
    mood: "thanks",
    title: "被照顾到了",
    text: "晚饭后有人帮忙收拾桌子，这种小事真的会让一天变轻。",
    visibility: "family",
    x: 34,
    y: 29,
    rotate: 16,
  },
  {
    id: "leaf-3",
    ownerId: "child",
    date: "5月22日",
    author: "小小",
    mood: "joy",
    title: "今天很开心",
    text: "放学路上看到了很好看的云，想给家里每个人都看一下。",
    visibility: "family",
    x: 66,
    y: 31,
    rotate: -8,
  },
  {
    id: "leaf-4",
    ownerId: "dad",
    date: "5月21日",
    author: "爸爸",
    mood: "brave",
    title: "说一句真心话",
    text: "有些话平时不太会说，但我真的很珍惜我们每天还能在这里碰面。",
    visibility: "shared",
    x: 23,
    y: 45,
    rotate: -24,
  },
  {
    id: "leaf-5",
    ownerId: "mom",
    date: "5月20日",
    author: "妈妈",
    mood: "tired",
    title: "想休息一下",
    text: "今天想早点睡。不是不想聊天，只是想安静恢复一点力气。",
    visibility: "private",
    x: 76,
    y: 48,
    rotate: 22,
  },
  {
    id: "leaf-6",
    ownerId: "child",
    date: "5月19日",
    author: "小小",
    mood: "sad",
    title: "有点委屈",
    text: "今天被误会了。写在这里之后，好像没有那么堵了。",
    visibility: "shared",
    x: 42,
    y: 60,
    rotate: 8,
  },
];

export default function MoodTreePage() {
  const [selectedOwnerId, setSelectedOwnerId] = useState(treeOwners[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState(leaves[0]?.id ?? "");
  const [sharedLeafId, setSharedLeafId] = useState<string | null>(null);
  const [assistantMode, setAssistantMode] = useState<
    "record" | "view" | "share"
  >("record");
  const [caughtLeafIds, setCaughtLeafIds] = useState<Set<string>>(
    () => new Set(["leaf-4"]),
  );
  const [reactions, setReactions] = useState<Record<string, string[]>>({
    "leaf-4": ["妈妈 · 我看到了", "小小 · 抱抱"],
    "leaf-2": ["爸爸 · 谢谢你说出来"],
  });
  const selectedOwner =
    treeOwners.find((owner) => owner.id === selectedOwnerId) ?? treeOwners[0];
  const ownerLeaves = useMemo(
    () => leaves.filter((leaf) => leaf.ownerId === selectedOwnerId),
    [selectedOwnerId],
  );
  const selected = useMemo(
    () => ownerLeaves.find((leaf) => leaf.id === selectedId) ?? ownerLeaves[0],
    [ownerLeaves, selectedId],
  );
  const selectedReactions = selected ? reactions[selected.id] ?? [] : [];
  const caughtToday = ownerLeaves.filter((leaf) => caughtLeafIds.has(leaf.id)).length;

  useEffect(() => {
    if (!ownerLeaves.some((leaf) => leaf.id === selectedId)) {
      setSelectedId(ownerLeaves[0]?.id ?? "");
    }
  }, [ownerLeaves, selectedId]);

  function shareLeaf(leafId: string) {
    setSharedLeafId(leafId);
    window.setTimeout(() => {
      setSharedLeafId((current) => (current === leafId ? null : current));
    }, 1500);
  }

  function catchLeaf(leafId: string) {
    setCaughtLeafIds((current) => {
      const next = new Set(current);
      next.add(leafId);
      return next;
    });
  }

  function addReaction(leafId: string, text: string) {
    setReactions((current) => {
      const existing = current[leafId] ?? [];
      const nextText = `我 · ${text}`;
      if (existing.includes(nextText)) return current;
      return {
        ...current,
        [leafId]: [...existing, nextText],
      };
    });
    catchLeaf(leafId);
  }

  return (
    <main className="flex min-h-[100dvh] flex-col bg-[#f7faf7] text-slate-900">
      <header className="flex items-center justify-between border-b border-emerald-100/80 bg-white/90 px-5 py-3 backdrop-blur sm:px-6">
        <div className="min-w-0">
          <Link
            href="/chat"
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            返回聊天
          </Link>
          <h1 className="mt-1 truncate text-2xl font-bold leading-8 text-slate-950">
            心情树
          </h1>
        </div>
        <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
          每个人一棵树
        </div>
      </header>

      <nav className="border-b border-emerald-100/80 bg-white/85 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-xl gap-2 overflow-x-auto no-scrollbar">
          {treeOwners.map((owner) => {
            const active = owner.id === selectedOwnerId;
            const count = leaves.filter((leaf) => leaf.ownerId === owner.id).length;
            return (
              <button
                key={owner.id}
                type="button"
                className={`flex min-w-[118px] items-center gap-2 rounded-2xl px-3 py-2 text-left shadow-sm ring-1 transition ${
                  active
                    ? "bg-emerald-50 ring-emerald-200"
                    : "bg-white ring-slate-100 hover:bg-slate-50"
                }`}
                onClick={() => setSelectedOwnerId(owner.id)}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: owner.accent }}
                >
                  {owner.initial}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-slate-800">
                    {owner.nickname}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {owner.role} · {count} 片
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <section className="relative overflow-hidden border-b border-emerald-100/80 bg-gradient-to-b from-[#f9fff9] to-[#eef8f0] px-4 pb-4 pt-3">
        <div className="mx-auto max-w-xl">
          <div className="relative h-[390px] overflow-hidden rounded-[28px] bg-white/65 shadow-sm ring-1 ring-emerald-100/80">
            <div className="absolute inset-x-6 top-5 z-10 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-700">
                  {selectedOwner?.nickname}的心情树
                </p>
                <p className="mt-1 max-w-48 text-sm leading-5 text-slate-500">
                  真心话会在自己的树上慢慢长出来。
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-100">
                  今天 {caughtToday} 片被接住
                </div>
                {sharedLeafId ? (
                  <div className="mood-share-pop rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-100">
                    已分享一片叶子
                  </div>
                ) : null}
              </div>
            </div>

            <svg
              className="absolute inset-x-0 bottom-0 h-full w-full"
              viewBox="0 0 360 390"
              role="img"
              aria-label="心情树"
            >
              <path
                className="mood-branch"
                d="M181 368 C178 310 184 260 178 214 C174 176 176 124 190 70"
                fill="none"
                stroke="#8f7657"
                strokeWidth="20"
                strokeLinecap="round"
              />
              <path
                className="mood-branch mood-branch-delay-1"
                d="M180 232 C142 210 113 184 78 139"
                fill="none"
                stroke="#9a8060"
                strokeWidth="11"
                strokeLinecap="round"
              />
              <path
                className="mood-branch mood-branch-delay-2"
                d="M181 213 C220 190 250 156 286 103"
                fill="none"
                stroke="#9a8060"
                strokeWidth="11"
                strokeLinecap="round"
              />
              <path
                className="mood-branch mood-branch-delay-3"
                d="M181 284 C139 270 105 248 61 214"
                fill="none"
                stroke="#a98b67"
                strokeWidth="9"
                strokeLinecap="round"
              />
              <path
                className="mood-branch mood-branch-delay-4"
                d="M181 276 C221 260 257 235 302 197"
                fill="none"
                stroke="#a98b67"
                strokeWidth="9"
                strokeLinecap="round"
              />
              <ellipse cx="181" cy="374" rx="90" ry="13" fill="#dbead9" />
            </svg>

            {ownerLeaves.map((leaf, index) => {
              const theme = moodTheme[leaf.mood];
              const active = selected?.id === leaf.id;
              const shared = sharedLeafId === leaf.id;
              return (
                <button
                  key={leaf.id}
                  type="button"
                  className={`mood-leaf-button ${active ? "mood-leaf-active" : ""} ${
                    shared ? "mood-leaf-sharing" : ""
                  }`}
                  style={{
                    left: `${leaf.x}%`,
                    top: `${leaf.y}%`,
                    "--leaf-color": theme.color,
                    "--leaf-glow": theme.glow,
                    "--leaf-rotate": `${leaf.rotate}deg`,
                    "--leaf-delay": `${index * 95 + 280}ms`,
                  } as React.CSSProperties}
                  aria-label={`${leaf.date} ${theme.label} ${leaf.title}`}
                  onClick={() => setSelectedId(leaf.id)}
                >
                  <span className="mood-leaf-shape" />
                  {caughtLeafIds.has(leaf.id) ? (
                    <span className="mood-caught-mark" aria-hidden>
                      接
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:px-6">
        {selected ? (
          <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-emerald-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${moodTheme[selected.mood].bg}`}
                  >
                    {moodTheme[selected.mood].label}
                  </span>
                  <span className="text-xs font-medium text-slate-400">
                    {selected.author} · {selected.date}
                  </span>
                </div>
                <h2 className="mt-3 text-lg font-bold text-slate-950">
                  {selected.title}
                </h2>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                {visibilityLabel(selected.visibility)}
              </span>
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              {selected.text}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
                onClick={() => shareLeaf(selected.id)}
              >
                分享这片叶子
              </button>
              <button
                type="button"
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-100 transition hover:bg-emerald-50"
                onClick={() => catchLeaf(selected.id)}
              >
                接住这片叶子
              </button>
            </div>
            <div className="mt-4 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
              <div className="mb-2 text-xs font-semibold text-slate-400">
                温柔回应
              </div>
              <div className="flex flex-wrap gap-2">
                {["抱抱", "我看到了", "晚点聊聊"].map((text) => (
                  <button
                    key={text}
                    type="button"
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-emerald-50 hover:text-emerald-700 hover:ring-emerald-100"
                    onClick={() => addReaction(selected.id, text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <div className="mt-3 space-y-1">
                {selectedReactions.length > 0 ? (
                  selectedReactions.map((reaction) => (
                    <div
                      key={reaction}
                      className="mood-reaction-in rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-500 shadow-sm ring-1 ring-slate-100"
                    >
                      {reaction}
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl bg-white px-3 py-2 text-xs text-slate-400 ring-1 ring-slate-100">
                    还没有回应。可以先轻轻接住它。
                  </div>
                )}
              </div>
            </div>
          </article>
        ) : null}

        <aside className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-emerald-100">
          <div className="px-1 pb-2 text-xs font-semibold text-slate-400">
            时间线
          </div>
          <div className="space-y-1">
            {ownerLeaves.map((leaf) => (
              <button
                key={leaf.id}
                type="button"
                className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition ${
                  selected?.id === leaf.id
                    ? "bg-emerald-50"
                    : "hover:bg-slate-50"
                }`}
                onClick={() => setSelectedId(leaf.id)}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: moodTheme[leaf.mood].color }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-700">
                    {leaf.title}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {leaf.date} · {moodTheme[leaf.mood].label}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section className="border-t border-emerald-100 bg-white/90 px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-xl rounded-3xl bg-slate-50 p-3 ring-1 ring-slate-100">
          <div className="mb-3 flex items-center gap-2 px-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
              助
            </div>
            <div>
              <div className="text-sm font-bold text-slate-800">家庭助理</div>
              <div className="text-xs text-slate-400">
                用聊天完成记录、查看和分享
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="ml-auto max-w-[82%] rounded-2xl bg-brand-500 px-4 py-2.5 text-sm leading-6 text-white shadow-sm">
              {assistantPrompt(assistantMode, selectedOwner?.nickname ?? "我")}
            </div>
            <div className="max-w-[88%] rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-700 shadow-sm ring-1 ring-slate-100">
              {assistantReply(assistantMode, selectedOwner?.nickname ?? "你", selected)}
              <div className="mt-3 flex flex-wrap gap-2">
                {assistantMode === "record" ? (
                  <>
                    <button className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
                      保存为叶子
                    </button>
                    <button className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                      先只给自己
                    </button>
                  </>
                ) : assistantMode === "view" ? (
                  <>
                    <button className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
                      打开心情树
                    </button>
                    <button className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                      看本周
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                      onClick={() => selected && shareLeaf(selected.id)}
                    >
                      分享给家人
                    </button>
                    <button className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                      只分享摘要
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ["record", "记录叶子"],
              ["view", "看看心情树"],
              ["share", "分享这片"],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${
                  assistantMode === mode
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200"
                }`}
                onClick={() => setAssistantMode(mode as typeof assistantMode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function assistantPrompt(mode: "record" | "view" | "share", name: string): string {
  if (mode === "view") return `家庭助理，看看${name}最近的心情树。`;
  if (mode === "share") return "把我选中的这片叶子分享给家人。";
  return "家庭助理，我想记录一片今天的心情叶子。";
}

function assistantReply(
  mode: "record" | "view" | "share",
  name: string,
  leaf?: MoodLeaf,
): string {
  if (mode === "view") {
    return `${name}这周留下了几片叶子。最近一片是「${leaf?.title ?? "今天的心情"}」，看起来需要被温柔接住。`;
  }
  if (mode === "share") {
    return `可以。我会只把摘要发到家庭聊天里，完整内容仍按叶子的可见范围打开。`;
  }
  return "可以。你可以先写一句真心话，我会帮你保存成一片叶子；默认只给自己看。";
}

function visibilityLabel(value: MoodLeaf["visibility"]): string {
  if (value === "family") return "家人可见";
  if (value === "shared") return "已分享";
  return "仅自己";
}
