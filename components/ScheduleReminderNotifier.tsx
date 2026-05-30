"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { useToast } from "@/components/Toast";
import { loadSession, type LocalSession } from "@/lib/authLocal";
import { getScheduleReminderStatus } from "@/lib/scheduleService";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import type { ScheduleReminderDelivery } from "@/types/schedule";

const SERVICE_WORKER_REMINDER_TYPE = "family-chat:schedule-reminder";
const REMINDER_EVENT_TYPE = "reminder_updated";
const NOTIFY_DEDUPE_MS = 90_000;
const DELIVERY_FRESH_MS = 120_000;
const DELIVERY_FUTURE_GRACE_MS = 30_000;

interface ScheduleReminderClientMessage {
  type?: string;
  familyId?: string | null;
  scheduleItemId?: string | null;
}

interface ScheduleRealtimeEventRow {
  id?: string | null;
  family_id?: string | null;
  schedule_item_id?: string | null;
  event_type?: string | null;
}

export default function ScheduleReminderNotifier() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { info } = useToast();
  const notifiedRef = useRef<Map<string, number>>(new Map());
  const seenRealtimeEventsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const session = loadSession();
    if (!session) return;

    let cancelled = false;
    let cleanupRealtime: (() => void) | null = null;

    const showReminderNotice = (scheduleItemId: string | null | undefined) => {
      const key = `${session.family_id}:${scheduleItemId ?? "unknown"}`;
      if (!markNotified(notifiedRef.current, key)) return;
      info(t("scheduleReminderForegroundToast"));
    };

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as ScheduleReminderClientMessage | null;
      if (!data || data.type !== SERVICE_WORKER_REMINDER_TYPE) return;
      if (data.familyId && data.familyId !== session.family_id) return;
      showReminderNotice(data.scheduleItemId);
    };

    navigator.serviceWorker?.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );

    if (isSupabaseConfigured()) {
      const sb = getSupabase();
      const channel = sb
        .channel(`schedule-reminder-notifier:${session.member_id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "family_schedule_events",
            filter: `recipient_member_id=eq.${session.member_id}`,
          },
          (payload) => {
            const row = payload.new as ScheduleRealtimeEventRow;
            if (!isReminderRealtimeEvent(row, session)) return;

            const eventId =
              row.id ??
              `${row.schedule_item_id}:${payload.commit_timestamp ?? Date.now()}`;
            if (!markRealtimeSeen(seenRealtimeEventsRef.current, eventId)) return;

            void (async () => {
              if (!row.schedule_item_id || cancelled) return;
              try {
                const status = await getScheduleReminderStatus(
                  session,
                  row.schedule_item_id,
                );
                if (
                  !cancelled &&
                  shouldNotifyForDelivery(status.current_member_delivery)
                ) {
                  showReminderNotice(row.schedule_item_id);
                }
              } catch {
                // Realtime notification is best-effort. The schedule page still refreshes itself.
              }
            })();
          },
        )
        .subscribe();

      cleanupRealtime = () => {
        void sb.removeChannel(channel);
      };
    }

    return () => {
      cancelled = true;
      navigator.serviceWorker?.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
      cleanupRealtime?.();
    };
  }, [info, pathname, t]);

  return null;
}

function isReminderRealtimeEvent(
  row: ScheduleRealtimeEventRow,
  session: LocalSession,
): boolean {
  if (row.event_type !== REMINDER_EVENT_TYPE) return false;
  if (!row.schedule_item_id) return false;
  if (row.family_id && row.family_id !== session.family_id) return false;
  return true;
}

function shouldNotifyForDelivery(
  delivery: ScheduleReminderDelivery | null,
): boolean {
  if (!delivery) return false;

  const scheduledAt = Date.parse(delivery.scheduled_for);
  if (!Number.isFinite(scheduledAt)) return false;
  if (scheduledAt > Date.now() + DELIVERY_FUTURE_GRACE_MS) return false;

  const activityAt = Date.parse(
    delivery.delivered_at ?? delivery.last_attempt_at ?? delivery.updated_at,
  );
  if (!Number.isFinite(activityAt)) return false;
  if (Date.now() - activityAt > DELIVERY_FRESH_MS) return false;

  if (delivery.status === "sent" || delivery.status === "failed") return true;
  if (delivery.status === "skipped") {
    return (
      delivery.skipped_reason === "active_recently" ||
      delivery.skipped_reason === "no_subscription"
    );
  }

  return false;
}

function markNotified(map: Map<string, number>, key: string): boolean {
  const now = Date.now();
  for (const [entryKey, notifiedAt] of map) {
    if (now - notifiedAt > NOTIFY_DEDUPE_MS) {
      map.delete(entryKey);
    }
  }

  const lastNotifiedAt = map.get(key);
  if (lastNotifiedAt && now - lastNotifiedAt < NOTIFY_DEDUPE_MS) {
    return false;
  }

  map.set(key, now);
  return true;
}

function markRealtimeSeen(set: Set<string>, eventId: string): boolean {
  if (set.has(eventId)) return false;
  set.add(eventId);
  if (set.size > 500) set.clear();
  return true;
}
