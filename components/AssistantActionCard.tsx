"use client";

import { useMemo, type KeyboardEvent, type MouseEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { AssistantActionCard } from "@/types/assistant";

interface Props {
  card: AssistantActionCard | null;
  canAct: boolean;
  submitting?: boolean;
  onConfirm: (card: AssistantActionCard) => void;
  onCancel: (card: AssistantActionCard) => void;
  onModify: (card: AssistantActionCard) => void;
  currentMemberId?: string | null;
  onOpenSchedule?: (card: AssistantActionCard) => void;
  onAcceptTask?: (card: AssistantActionCard) => void;
  onCompleteTask?: (card: AssistantActionCard) => void;
  onSnoozeTask?: (card: AssistantActionCard) => void;
}

export default function AssistantActionCardView({
  card,
  canAct,
  submitting = false,
  onConfirm,
  onCancel,
  onModify,
  currentMemberId,
  onOpenSchedule,
  onAcceptTask,
  onCompleteTask,
  onSnoozeTask,
}: Props) {
  const { language, t } = useLanguage();
  const startsAt = card?.payload.starts_at;
  const assigneeLabel =
    typeof card?.payload.assignee_nickname === "string"
      ? card.payload.assignee_nickname
      : null;
  const timeLabel = useMemo(() => {
    if (!startsAt) return null;
    const date = new Date(startsAt);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : language, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }, [language, startsAt]);

  if (!card) {
    return (
      <div className="text-sm text-slate-600">
        <div className="font-semibold text-slate-800">{t("assistantName")}</div>
        <div className="mt-1 text-xs">{t("assistantCardLoading")}</div>
      </div>
    );
  }

  const statusClass =
    card.status === "confirmed"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : card.status === "cancelled"
        ? "bg-slate-100 text-slate-500 ring-slate-200"
        : card.status === "expired"
          ? "bg-rose-50 text-rose-600 ring-rose-100"
          : "bg-amber-50 text-amber-800 ring-amber-100";
  const scheduleItemId = getScheduleItemId(card);
  const canOpenSchedule = !!scheduleItemId && !!onOpenSchedule;

  function openSchedule() {
    if (!card || !canOpenSchedule || !onOpenSchedule) return;
    onOpenSchedule(card);
  }

  function handleCardClick(event: MouseEvent<HTMLDivElement>) {
    if (!canOpenSchedule) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button,a")) return;
    openSchedule();
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!canOpenSchedule) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button,a")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSchedule();
  }

  return (
    <div
      className={`min-w-0 text-sm ${
        canOpenSchedule
          ? "cursor-pointer rounded-2xl transition hover:bg-emerald-50/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          : ""
      }`}
      role={canOpenSchedule ? "button" : undefined}
      tabIndex={canOpenSchedule ? 0 : undefined}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      title={canOpenSchedule ? t("assistantOpenSchedule") : undefined}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold text-emerald-700">
            {t(cardTypeKey(card.card_type))}
          </div>
          <div className="mt-0.5 break-words font-semibold leading-5 text-slate-900">
            {card.title}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${statusClass}`}
        >
          {t(statusKey(card.status))}
        </span>
      </div>

      <div className="mt-2 space-y-1 text-xs leading-5 text-slate-700">
        {timeLabel ? (
          <div>{t("assistantCardTime", { time: timeLabel })}</div>
        ) : null}
        {assigneeLabel ? (
          <div>
            {t("scheduleAssignee")}: {assigneeLabel}
          </div>
        ) : null}
        {card.summary ? (
          <div className="break-words text-slate-600">{card.summary}</div>
        ) : null}
      </div>

      {canOpenSchedule ? (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100 transition active:scale-[0.98]"
            onClick={(event) => {
              event.stopPropagation();
              openSchedule();
            }}
          >
            {t("assistantOpenSchedule")}
          </button>
        </div>
      ) : null}

      {card.status === "pending" && canAct ? (
        <div className="assistant-action-row mt-3">
          <button
            type="button"
            className="assistant-action-button bg-brand-500 text-white shadow-sm"
            disabled={submitting}
            onClick={() => onConfirm(card)}
          >
            {t("assistantConfirm")}
          </button>
          <button
            type="button"
            className="assistant-action-button bg-white text-slate-700 ring-1 ring-slate-200"
            disabled={submitting}
            onClick={() => onModify(card)}
          >
            {t("assistantModify")}
          </button>
          <button
            type="button"
            className="assistant-action-button bg-white text-slate-500 ring-1 ring-slate-200"
            disabled={submitting}
            onClick={() => onCancel(card)}
          >
            {t("assistantCancel")}
          </button>
        </div>
      ) : null}

      {canHandleTask(card, currentMemberId) ? (
        <div className="assistant-action-row mt-3">
          <button
            type="button"
            className="assistant-action-button bg-white text-emerald-700 ring-1 ring-emerald-100"
            disabled={submitting}
            onClick={() => onAcceptTask?.(card)}
          >
            {t("assistantTaskAccept")}
          </button>
          <button
            type="button"
            className="assistant-action-button bg-brand-500 text-white shadow-sm"
            disabled={submitting}
            onClick={() => onCompleteTask?.(card)}
          >
            {t("assistantTaskComplete")}
          </button>
          <button
            type="button"
            className="assistant-action-button bg-white text-slate-600 ring-1 ring-slate-200"
            disabled={submitting}
            onClick={() => onSnoozeTask?.(card)}
          >
            {t("assistantTaskSnooze")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function getScheduleItemId(card: AssistantActionCard): string | null {
  if (card.result_schedule_item_id) return card.result_schedule_item_id;
  const payloadItemId = card.payload.schedule_item_id;
  return typeof payloadItemId === "string" && payloadItemId ? payloadItemId : null;
}

function cardTypeKey(type: AssistantActionCard["card_type"]) {
  if (type === "reminder") return "assistantCardTypeReminder" as const;
  if (type === "schedule") return "assistantCardTypeSchedule" as const;
  if (type === "todo") return "assistantCardTypeTodo" as const;
  if (type === "schedule_update") return "assistantCardTypeScheduleUpdate" as const;
  if (type === "schedule_cancel") return "assistantCardTypeScheduleCancel" as const;
  return "assistantCardTypeImportant" as const;
}

function statusKey(status: AssistantActionCard["status"]) {
  if (status === "confirmed") return "assistantStatusConfirmed" as const;
  if (status === "cancelled") return "assistantStatusCancelled" as const;
  if (status === "expired") return "assistantStatusExpired" as const;
  return "assistantStatusPending" as const;
}

function canHandleTask(
  card: AssistantActionCard,
  currentMemberId?: string | null,
): boolean {
  if (!currentMemberId) return false;
  if (card.card_type !== "todo") return false;
  if (card.status !== "confirmed") return false;
  if (!card.result_schedule_item_id) return false;
  return card.payload.assignee_member_id === currentMemberId;
}
