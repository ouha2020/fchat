"use client";

import { useEffect, useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { CreateKeeperRequestInput } from "@/types/keeper";
import type { FamilyMember } from "@/types/member";
import type {
  ScheduleItemType,
  ScheduleVisibility,
} from "@/types/schedule";

interface Props {
  open: boolean;
  initialText: string;
  members: FamilyMember[];
  currentMemberId: string;
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateKeeperRequestInput) => Promise<void> | void;
}

export default function KeeperRequestSheet({
  open,
  initialText,
  members,
  currentMemberId,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
  const { t } = useLanguage();
  const defaults = useMemo(() => nextLocalDateTimeParts(), []);
  const activeMembers = members.filter((member) => member.status === "active");
  const [requestText, setRequestText] = useState(initialText);
  const [requestType, setRequestType] = useState<ScheduleItemType>("reminder");
  const [assigneeMemberId, setAssigneeMemberId] = useState(currentMemberId);
  const [visibility, setVisibility] = useState<ScheduleVisibility>("private");
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setRequestText(initialText);
  }, [initialText, open]);

  if (!open) return null;

  async function submit() {
    const startsAt = localDateTimeToIso(date, time);
    await onSubmit({
      request_text: requestText,
      request_type: requestType,
      assignee_member_id: assigneeMemberId,
      visibility,
      starts_at: startsAt,
      remind_at: reminderEnabled ? startsAt : null,
      note,
    });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/35 px-3 pb-3 pt-10 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-xl overflow-hidden rounded-[28px] bg-white shadow-2xl shadow-slate-900/20">
        <div className="flex items-center justify-between gap-3 border-b border-emerald-50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-600">
              {t("keeperName")}
            </p>
            <h2 className="truncate text-lg font-bold text-slate-900">
              {t("keeperRequestSheetTitle")}
            </h2>
          </div>
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-100"
            onClick={onCancel}
            disabled={submitting}
          >
            {t("commonCancel")}
          </button>
        </div>

        <div className="max-h-[min(78dvh,680px)] space-y-4 overflow-y-auto px-4 py-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-slate-700">
              {t("keeperRequestContent")}
            </span>
            <textarea
              className="field min-h-24 resize-none py-3"
              value={requestText}
              maxLength={300}
              onChange={(event) => setRequestText(event.target.value)}
              placeholder={t("keeperRequestPlaceholder")}
              disabled={submitting}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">
                {t("keeperRequestType")}
              </span>
              <select
                className="field h-12"
                value={requestType}
                onChange={(event) =>
                  setRequestType(event.target.value as ScheduleItemType)
                }
                disabled={submitting}
              >
                <option value="schedule">{t("scheduleTypeSchedule")}</option>
                <option value="todo">{t("scheduleTypeTodo")}</option>
                <option value="reminder">{t("scheduleTypeReminder")}</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">
                {t("keeperVisibility")}
              </span>
              <select
                className="field h-12"
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value as ScheduleVisibility)
                }
                disabled={submitting}
              >
                <option value="private">{t("scheduleVisibilityPrivate")}</option>
                <option value="family">{t("scheduleVisibilityFamily")}</option>
              </select>
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-slate-700">
              {t("keeperAssignee")}
            </span>
            <select
              className="field h-12"
              value={assigneeMemberId}
              onChange={(event) => setAssigneeMemberId(event.target.value)}
              disabled={submitting}
            >
              {activeMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.nickname}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">
                {t("scheduleDate")}
              </span>
              <input
                className="field h-12"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                disabled={submitting}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">
                {t("scheduleTime")}
              </span>
              <input
                className="field h-12"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                disabled={submitting}
              />
            </label>
          </div>

          <label className="flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            <span>{t("keeperReminderEnabled")}</span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-emerald-500"
              checked={reminderEnabled}
              onChange={(event) => setReminderEnabled(event.target.checked)}
              disabled={submitting}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-slate-700">
              {t("scheduleNote")}
            </span>
            <textarea
              className="field min-h-20 resize-none py-3"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              disabled={submitting}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            className="btn-secondary h-12"
            onClick={onCancel}
            disabled={submitting}
          >
            {t("commonCancel")}
          </button>
          <button
            type="button"
            className="btn-primary h-12"
            onClick={() => void submit()}
            disabled={submitting || !requestText.trim() || !date || !time}
          >
            {submitting ? t("commonLoading") : t("keeperSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}

function nextLocalDateTimeParts(): { date: string; time: string } {
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return {
    date: formatDateInput(next),
    time: formatTimeInput(next),
  };
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeInput(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function localDateTimeToIso(date: string, time: string): string {
  const local = new Date(`${date}T${time || "00:00"}:00`);
  if (Number.isNaN(local.getTime())) throw new Error("invalid_schedule_time");
  return local.toISOString();
}
