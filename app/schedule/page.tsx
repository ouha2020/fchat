"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import AppLoading from "@/components/AppLoading";
import AudioBubble from "@/components/AudioBubble";
import { useDialog } from "@/components/Dialog";
import { useLanguage } from "@/components/LanguageProvider";
import { useToast } from "@/components/Toast";
import { clearSession, loadSession, saveSession, type LocalSession } from "@/lib/authLocal";
import { humanizeError } from "@/lib/errors";
import { validateMember } from "@/lib/familyService";
import { getJapanHoliday, type JapanHoliday } from "@/lib/japanHolidays";
import { createGoogleMapUrl, getCurrentLocation } from "@/lib/locationService";
import { useResolvedMediaUrl } from "@/lib/mediaClient";
import { listMembers } from "@/lib/memberService";
import { uploadChatAudio } from "@/lib/messageService";
import { startRecording, type RecordingHandle } from "@/lib/recordingService";
import {
  createScheduleContextEvent,
  createScheduleItem,
  deleteScheduleContextEvent,
  deleteScheduleItem,
  getScheduleItem,
  getScheduleCollaboration,
  getScheduleReminderStatus,
  listScheduleContextEvents,
  listScheduleItems,
  respondScheduleAssignment,
  replaceScheduleItemRecurrence,
  searchScheduleItems,
  setScheduleItemStatus,
  snoozeScheduleReminder,
  updateScheduleItem,
} from "@/lib/scheduleService";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import type { FamilyMember } from "@/types/member";
import type {
  ScheduleItem,
  ScheduleCollaboration,
  ScheduleContextEvent,
  ScheduleContextVisibility,
  ScheduleRecurrenceScope,
  ScheduleRecurrenceRule,
  ScheduleReminderOffset,
  ScheduleReminderStatus,
  ScheduleItemType,
  ScheduleVisibility,
} from "@/types/schedule";

type ScheduleViewMode = "day" | "week" | "month";
type ScheduleAssigneeFilter = "all" | string;
type ScheduleTypeFilter = "all" | ScheduleItemType;
type ScheduleVisibilityFilter = "all" | ScheduleVisibility;
const REMINDER_OFFSETS: ScheduleReminderOffset[] = [0, 10, 30, 60, 1440];
const SCHEDULE_FALLBACK_POLL_MS = 30_000;

interface ScheduleReminderMessage {
  type: "family-chat:schedule-reminder";
  familyId?: string | null;
  scheduleItemId?: string | null;
}

interface ScheduleRealtimeEvent {
  id?: string | null;
  family_id?: string | null;
  schedule_item_id?: string | null;
  recipient_member_id?: string | null;
  event_type?: string | null;
}

interface ScheduleFormState {
  title: string;
  note: string;
  itemType: ScheduleItemType;
  visibility: ScheduleVisibility;
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  assigneeMemberId: string;
  reminderOffsets: ScheduleReminderOffset[];
  recurrenceRule: ScheduleRecurrenceRule;
}

const VIEW_MODES: ScheduleViewMode[] = ["month", "week", "day"];
const TYPE_FILTERS: ScheduleTypeFilter[] = [
  "all",
  "schedule",
  "todo",
  "reminder",
];
const VISIBILITY_FILTERS: ScheduleVisibilityFilter[] = [
  "all",
  "family",
  "private",
];
const SCHEDULE_MAX_RECORD_MS = 60_000;
const SCHEDULE_MIN_RECORD_MS = 600;
const SCHEDULE_COMPOSER_ICON_BUTTON_CLASS =
  "native-press inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-[14px] bg-white bg-cover bg-center bg-no-repeat shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200";

export default function SchedulePage() {
  const router = useRouter();
  const dialog = useDialog();
  const toast = useToast();
  const { language, t } = useLanguage();

  const [session, setSession] = useState<LocalSession | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [myTodayItems, setMyTodayItems] = useState<ScheduleItem[]>([]);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>("month");
  const [queryItemId, setQueryItemId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(() =>
    startOfDay(new Date()),
  );
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [assigneeFilter, setAssigneeFilter] =
    useState<ScheduleAssigneeFilter>("all");
  const [typeFilter, setTypeFilter] = useState<ScheduleTypeFilter>("all");
  const [visibilityFilter, setVisibilityFilter] =
    useState<ScheduleVisibilityFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleFormState>(() =>
    defaultFormState(null),
  );
  const [selectedItem, setSelectedItem] = useState<ScheduleItem | null>(null);
  const [collaboration, setCollaboration] =
    useState<ScheduleCollaboration | null>(null);
  const [collaborationLoading, setCollaborationLoading] = useState(false);
  const [contextEvents, setContextEvents] = useState<ScheduleContextEvent[]>([]);
  const [contextEventsLoading, setContextEventsLoading] = useState(false);
  const [reminderStatus, setReminderStatus] =
    useState<ScheduleReminderStatus | null>(null);
  const [reminderStatusLoading, setReminderStatusLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [contextVisibility, setContextVisibility] =
    useState<ScheduleContextVisibility>("family");
  const [contextRecipientId, setContextRecipientId] = useState("");
  const [declineNote, setDeclineNote] = useState("");
  const [showDeclineNote, setShowDeclineNote] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<ScheduleFormState>(() =>
    defaultFormState(null),
  );
  const [editScope, setEditScope] =
    useState<ScheduleRecurrenceScope>("single");
  const [deleteScope, setDeleteScope] =
    useState<ScheduleRecurrenceScope>("single");
  const selectedItemIdRef = useRef<string | null>(null);
  const pendingScheduleRefreshRef = useRef(false);
  const scheduleRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const seenScheduleEventIdsRef = useRef<Set<string>>(new Set());
  const syncWarningShownRef = useRef(false);
  const urlReadyRef = useRef(false);

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === "active"),
    [members],
  );
  const range = useMemo(
    () => getRange(viewMode, selectedDate),
    [selectedDate, viewMode],
  );
  const groupedItems = useMemo(() => groupItemsByDay(items), [items]);
  const visibleDays = useMemo(
    () => daysForView(viewMode, selectedDate),
    [selectedDate, viewMode],
  );
  const monthCalendarDays = useMemo(
    () => calendarDaysForMonth(selectedDate),
    [selectedDate],
  );
  const hasActiveFilters =
    debouncedSearchText.trim().length > 0 ||
    assigneeFilter !== "all" ||
    typeFilter !== "all" ||
    visibilityFilter !== "all";
  const myOpenTodayItems = useMemo(
    () =>
      myTodayItems.filter(
        (item) =>
          item.assignee_member_id === session?.member_id &&
          item.status !== "done",
      ),
    [myTodayItems, session?.member_id],
  );
  useEffect(() => {
    selectedItemIdRef.current = selectedItem?.id ?? null;
  }, [selectedItem?.id]);

  useEffect(() => {
    if (hasActiveFilters) setFiltersOpen(true);
  }, [hasActiveFilters]);

  useEffect(() => {
    const readUrlState = () => {
      const params = new URLSearchParams(window.location.search);
      const nextView = parseViewMode(params.get("view"));
      const nextDate = parseDateParam(params.get("date"));
      const nextQuery = (params.get("q") ?? "").trim().slice(0, 40);
      const nextType = parseTypeFilter(params.get("type"));
      const nextVisibility = parseVisibilityFilter(params.get("visibility"));
      const nextAssignee = parseAssigneeFilter(params.get("assignee"));

      setViewMode(nextView);
      setSelectedDate(nextDate);
      setSearchText(nextQuery);
      setDebouncedSearchText(nextQuery);
      setTypeFilter(nextType);
      setVisibilityFilter(nextVisibility);
      setAssigneeFilter(nextAssignee);
      setQueryItemId(params.get("item"));
      urlReadyRef.current = true;
    };
    readUrlState();
    window.addEventListener("popstate", readUrlState);
    return () => window.removeEventListener("popstate", readUrlState);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchText(searchText.trim().slice(0, 40));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (assigneeFilter === "all" || activeMembers.length === 0) return;
    if (!activeMembers.some((member) => member.id === assigneeFilter)) {
      setAssigneeFilter("all");
    }
  }, [activeMembers, assigneeFilter]);

  useEffect(() => {
    if (!urlReadyRef.current) return;
    const params = new URLSearchParams();
    params.set("view", viewMode);
    params.set("date", toDateInput(selectedDate));
    if (debouncedSearchText) params.set("q", debouncedSearchText);
    if (assigneeFilter !== "all") params.set("assignee", assigneeFilter);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (visibilityFilter !== "all") {
      params.set("visibility", visibilityFilter);
    }
    if (queryItemId) params.set("item", queryItemId);
    const nextUrl = `/schedule?${params.toString()}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== nextUrl) router.replace(nextUrl, { scroll: false });
  }, [
    assigneeFilter,
    debouncedSearchText,
    queryItemId,
    router,
    selectedDate,
    typeFilter,
    viewMode,
    visibilityFilter,
  ]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    if (!isSupabaseConfigured()) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const local = loadSession();
    if (!local) {
      router.replace("/");
      return () => {
        cancelled = true;
      };
    }
    const localSession = local;

    async function run() {
      try {
        const fresh = await validateMember(
          localSession.member_id,
          localSession.member_token,
        );
        if (cancelled) return;
        if (!fresh) {
          clearSession();
          setLoadError(t("chatSessionExpired"));
          setLoading(false);
          return;
        }
        saveSession(fresh);
        setSession(fresh);
        setForm(defaultFormState(fresh));
        const rows = await listMembers(fresh);
        if (cancelled) return;
        setMembers(rows);
      } catch (err) {
        if (!cancelled) {
          setLoadError(humanizeError(err, language) || t("chatLoadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [language, router, t]);

  const refreshItems = useCallback(async () => {
    if (!session) return;
    setItemsLoading(true);
    try {
      const todayStart = startOfDay(new Date());
      const todayEnd = addDays(todayStart, 1);
      const shouldReuseRangeForToday =
        range.start.getTime() === todayStart.getTime() &&
        range.end.getTime() === todayEnd.getTime() &&
        !hasActiveFilters;
      const rowsPromise = searchScheduleItems(session, {
        rangeStart: range.start,
        rangeEnd: range.end,
        query: debouncedSearchText,
        assigneeMemberId:
          assigneeFilter === "all" ? null : assigneeFilter,
        itemType: typeFilter === "all" ? null : typeFilter,
        visibility: visibilityFilter === "all" ? null : visibilityFilter,
        limit: 300,
      });
      const todayRowsPromise = shouldReuseRangeForToday
        ? rowsPromise
        : listScheduleItems(session, todayStart, todayEnd);
      const [rows, todayRows] = await Promise.all([
        rowsPromise,
        todayRowsPromise,
      ]);
      setItems(rows);
      setMyTodayItems(todayRows);
      const currentSelectedId = selectedItemIdRef.current;
      if (currentSelectedId) {
        const refreshed =
          rows.find((item) => item.id === currentSelectedId) ??
          todayRows.find((item) => item.id === currentSelectedId) ??
          null;
        if (refreshed) setSelectedItem(refreshed);
      }
    } catch (err) {
      toast.error(humanizeError(err, language));
    } finally {
      setItemsLoading(false);
    }
  }, [
    assigneeFilter,
    debouncedSearchText,
    hasActiveFilters,
    language,
    range.end,
    range.start,
    session,
    toast,
    typeFilter,
    visibilityFilter,
  ]);

  const clearItemParam = useCallback(() => {
    setQueryItemId(null);
  }, []);

  const notifyScheduleCollaboration = useCallback(
    (scheduleItemId: string, eventType: string) => {
      if (!session) return;
      void fetch("/api/schedule/collaboration-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: session.member_id,
          memberToken: session.member_token,
          scheduleItemId,
          eventType,
        }),
      }).catch(() => undefined);
    },
    [session],
  );

  const refreshCollaboration = useCallback(
    async (scheduleItemId: string) => {
      if (!session || !scheduleItemId || !isUuid(scheduleItemId)) return;
      setCollaborationLoading(true);
      try {
        const data = await getScheduleCollaboration(session, scheduleItemId);
        setCollaboration(data);
      } catch (err) {
        setCollaboration(null);
        toast.error(humanizeError(err, language) || t("scheduleItemUnavailable"));
      } finally {
        setCollaborationLoading(false);
      }
    },
    [language, session, t, toast],
  );

  const refreshContextEvents = useCallback(
    async (scheduleItemId: string) => {
      if (!session || !scheduleItemId || !isUuid(scheduleItemId)) return;
      setContextEventsLoading(true);
      try {
        const rows = await listScheduleContextEvents(session, scheduleItemId);
        setContextEvents(rows);
      } catch (err) {
        setContextEvents([]);
        toast.error(humanizeError(err, language) || t("scheduleItemUnavailable"));
      } finally {
        setContextEventsLoading(false);
      }
    },
    [language, session, t, toast],
  );

  const refreshReminderStatus = useCallback(
    async (scheduleItemId: string, options?: { silent?: boolean }) => {
      if (!session || !scheduleItemId || !isUuid(scheduleItemId)) return;
      setReminderStatusLoading(true);
      try {
        const data = await getScheduleReminderStatus(session, scheduleItemId);
        setReminderStatus(data);
      } catch (err) {
        setReminderStatus(null);
        if (!options?.silent) {
          toast.error(humanizeError(err, language));
        }
      } finally {
        setReminderStatusLoading(false);
      }
    },
    [language, session, toast],
  );

  const openScheduleItem = useCallback(
    async (scheduleItemId: string, updateUrl = true) => {
      if (!session || !scheduleItemId) return;
      if (!isUuid(scheduleItemId)) {
        clearItemParam();
        toast.error(t("scheduleItemUnavailable"));
        return;
      }
      if (updateUrl) {
        setQueryItemId(scheduleItemId);
      }

      const cached =
        items.find((item) => item.id === scheduleItemId) ??
        myTodayItems.find((item) => item.id === scheduleItemId) ??
        null;
      if (cached) {
        setSelectedItem(cached);
        setEditMode(false);
      }

      setDetailLoading(true);
      try {
        const fresh = await getScheduleItem(session, scheduleItemId);
        if (!fresh) {
          setSelectedItem(null);
          setEditMode(false);
          clearItemParam();
          toast.error(t("scheduleItemUnavailable"));
          return;
        }
        setSelectedItem(fresh);
        setEditForm(formStateFromItem(fresh));
        setCommentText("");
        setContextVisibility("family");
        setContextRecipientId("");
        setDeclineNote("");
        setShowDeclineNote(false);
        await Promise.all([
          refreshCollaboration(fresh.id),
          refreshContextEvents(fresh.id),
          refreshReminderStatus(fresh.id),
        ]);
        setEditScope("single");
        setDeleteScope("single");
        setEditMode(false);
      } catch (err) {
        toast.error(humanizeError(err, language) || t("scheduleItemUnavailable"));
        clearItemParam();
      } finally {
        setDetailLoading(false);
      }
    },
    [
      clearItemParam,
      items,
      language,
      myTodayItems,
      refreshCollaboration,
      refreshContextEvents,
      refreshReminderStatus,
      session,
      t,
      toast,
    ],
  );

  const closeDetails = useCallback(() => {
    setSelectedItem(null);
    setCollaboration(null);
    setContextEvents([]);
    setReminderStatus(null);
    setEditMode(false);
    clearItemParam();
  }, [clearItemParam]);

  const refreshSelectedScheduleDetail = useCallback(
    async (scheduleItemId: string) => {
      if (!session || !scheduleItemId || !isUuid(scheduleItemId)) return;
      try {
        const fresh = await getScheduleItem(session, scheduleItemId);
        if (!fresh) {
          setSelectedItem(null);
          setReminderStatus(null);
          setEditMode(false);
          clearItemParam();
          return;
        }
        setSelectedItem(fresh);
        await refreshReminderStatus(fresh.id, { silent: true });
      } catch {
        // Background fallback refresh should not interrupt the schedule UI.
      }
    },
    [clearItemParam, refreshReminderStatus, session],
  );

  const scheduleRefresh = useCallback(
    (force = false) => {
      pendingScheduleRefreshRef.current = true;

      if (
        !force &&
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }

      if (scheduleRefreshTimerRef.current) {
        clearTimeout(scheduleRefreshTimerRef.current);
      }

      scheduleRefreshTimerRef.current = setTimeout(() => {
        pendingScheduleRefreshRef.current = false;
        scheduleRefreshTimerRef.current = null;
        void refreshItems();
        const currentSelectedId = selectedItemIdRef.current;
        if (currentSelectedId) {
          void refreshSelectedScheduleDetail(currentSelectedId);
        }
      }, 180);
    },
    [refreshItems, refreshSelectedScheduleDetail],
  );

  useEffect(() => {
    void refreshItems();
  }, [refreshItems]);

  useEffect(() => {
    if (!session || !queryItemId) return;
    if (selectedItemIdRef.current === queryItemId) return;
    void openScheduleItem(queryItemId, false);
  }, [openScheduleItem, queryItemId, session]);

  useEffect(() => {
    return () => {
      if (scheduleRefreshTimerRef.current) {
        clearTimeout(scheduleRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    const refreshVisiblePage = () => {
      if (document.visibilityState === "visible") scheduleRefresh(true);
    };
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as ScheduleReminderMessage | null;
      if (!data || data.type !== "family-chat:schedule-reminder") return;
      if (data.familyId && data.familyId !== session.family_id) return;
      if (data.scheduleItemId) {
        void openScheduleItem(data.scheduleItemId);
        return;
      }
      scheduleRefresh(true);
    };

    window.addEventListener("focus", refreshVisiblePage);
    document.addEventListener("visibilitychange", refreshVisiblePage);
    navigator.serviceWorker?.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );

    return () => {
      window.removeEventListener("focus", refreshVisiblePage);
      document.removeEventListener("visibilitychange", refreshVisiblePage);
      navigator.serviceWorker?.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
    };
  }, [openScheduleItem, scheduleRefresh, session]);

  useEffect(() => {
    if (!session || !isSupabaseConfigured()) return;

    const sb = getSupabase();
    const channel = sb
      .channel(`schedule-events:${session.member_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "family_schedule_events",
          filter: `recipient_member_id=eq.${session.member_id}`,
        },
        (payload) => {
          const row = payload.new as ScheduleRealtimeEvent;
          if (row.family_id && row.family_id !== session.family_id) return;

          const eventId =
            row.id ??
            `${row.schedule_item_id ?? "unknown"}:${row.event_type ?? "event"}:${
              payload.commit_timestamp ?? Date.now()
            }`;
          const seen = seenScheduleEventIdsRef.current;
          if (seen.has(eventId)) return;
          seen.add(eventId);
          if (seen.size > 500) seen.clear();

          if (
            row.schedule_item_id &&
            row.schedule_item_id === selectedItemIdRef.current
          ) {
            void openScheduleItem(row.schedule_item_id, false);
          }
          scheduleRefresh(false);
        },
      )
      .subscribe((status) => {
        if (
          (status === "CHANNEL_ERROR" || status === "TIMED_OUT") &&
          !syncWarningShownRef.current
        ) {
          syncWarningShownRef.current = true;
          toast.error(t("scheduleSyncUnavailable"));
          scheduleRefresh(true);
        }
      });

    return () => {
      void sb.removeChannel(channel);
    };
  }, [openScheduleItem, scheduleRefresh, session, t, toast]);

  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") scheduleRefresh(false);
    }, SCHEDULE_FALLBACK_POLL_MS);
    return () => window.clearInterval(interval);
  }, [scheduleRefresh, session]);

  useEffect(() => {
    if (!session || form.assigneeMemberId) return;
    setForm((current) => ({
      ...current,
      assigneeMemberId: session.member_id,
    }));
  }, [form.assigneeMemberId, session]);

  async function handleCreate() {
    if (!session) return;
    setBusy("create");
    try {
      const startsAt = localDateTimeToIso(form.date, form.time);
      const endsAt =
        form.endDate && form.endTime
          ? localDateTimeToIso(form.endDate, form.endTime)
          : null;
      const remindAt = reminderToIso(form.reminderOffsets, startsAt);
      await createScheduleItem(session, {
        title: form.title,
        note: form.note,
        item_type: form.itemType,
        visibility: form.visibility,
        starts_at: startsAt,
        ends_at: endsAt,
        remind_at: remindAt,
        reminder_offsets: form.reminderOffsets,
        recurrence_rule: form.recurrenceRule,
        assignee_member_id: form.assigneeMemberId || session.member_id,
      });
      setShowForm(false);
      setForm(defaultFormState(session));
      toast.success(t("scheduleCreateSuccess"));
      await refreshItems();
    } catch (err) {
      toast.error(humanizeError(err, language) || t("scheduleCreateFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleStatus(item: ScheduleItem) {
    if (!session) return;
    const nextStatus = item.status === "done" ? "active" : "done";
    setBusy(item.id);
    try {
      await setScheduleItemStatus(session, item.id, nextStatus);
      await refreshItems();
    } catch (err) {
      toast.error(humanizeError(err, language) || t("scheduleUpdateFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveEdit() {
    if (!session || !selectedItem) return;
    setBusy(`edit:${selectedItem.id}`);
    try {
      const startsAt = localDateTimeToIso(editForm.date, editForm.time);
      const endsAt =
        editForm.endDate && editForm.endTime
          ? localDateTimeToIso(editForm.endDate, editForm.endTime)
          : null;
      const remindAt = reminderToIso(editForm.reminderOffsets, startsAt);
      const scope = selectedItem.recurrence_group_id ? editScope : "single";
      const assigneeChanged =
        editForm.assigneeMemberId &&
        editForm.assigneeMemberId !== selectedItem.assignee_member_id;
      const previousRecurrence = selectedItem.recurrence_rule ?? "none";
      const recurrenceChanged = editForm.recurrenceRule !== previousRecurrence;
      const payload = {
        id: selectedItem.id,
        title: editForm.title,
        note: editForm.note,
        item_type: editForm.itemType,
        visibility: editForm.visibility,
        starts_at: startsAt,
        ends_at: endsAt,
        remind_at: remindAt,
        reminder_offsets: editForm.reminderOffsets,
        recurrence_rule: editForm.recurrenceRule,
        assignee_member_id: editForm.assigneeMemberId || session.member_id,
        recurrence_scope: scope,
      };
      const savedItemId = recurrenceChanged
        ? await replaceScheduleItemRecurrence(session, payload)
        : (await updateScheduleItem(session, payload), selectedItem.id);
      await refreshItems();
      await openScheduleItem(savedItemId, false);
      if (assigneeChanged) {
        notifyScheduleCollaboration(savedItemId, "assigned");
      }
      setEditMode(false);
      toast.success(t("scheduleSaveSuccess"));
    } catch (err) {
      toast.error(humanizeError(err, language) || t("scheduleUpdateFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleSnoozeReminder(deliveryId: string, minutes: 5 | 10 | 30) {
    if (!session || !selectedItem) return;
    setBusy(`snooze:${deliveryId}:${minutes}`);
    try {
      await snoozeScheduleReminder(session, deliveryId, minutes);
      await refreshReminderStatus(selectedItem.id);
      toast.success(t("scheduleReminderSnoozed"));
    } catch (err) {
      toast.error(humanizeError(err, language) || t("scheduleUpdateFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(
    item: ScheduleItem,
    recurrenceScope: ScheduleRecurrenceScope = "single",
  ) {
    if (!session) return;
    const ok = await dialog.confirm({
      title: t("scheduleDelete"),
      message: t("scheduleDeleteConfirm", { title: item.title }),
      danger: true,
    });
    if (!ok) return;

    setBusy(item.id);
    try {
      await deleteScheduleItem(session, item.id, recurrenceScope);
      await refreshItems();
      if (selectedItem?.id === item.id) {
        setSelectedItem(null);
        setEditMode(false);
        clearItemParam();
      }
      toast.success(t("scheduleDeleteSuccess"));
    } catch (err) {
      toast.error(humanizeError(err, language) || t("scheduleDeleteFailed"));
    } finally {
      setBusy(null);
    }
  }

  function resolveContextRecipient(item: ScheduleItem): string | null {
    if (!session) return null;
    return (
      contextRecipientId ||
      activeMembers.find((member) => {
        if (member.id === session.member_id || member.status !== "active") {
          return false;
        }
        if (item.visibility === "family") return true;
        return (
          member.id === item.creator_member_id ||
          member.id === item.assignee_member_id
        );
      })?.id ||
      null
    );
  }

  async function handleAddComment() {
    if (!session || !selectedItem) return;
    setBusy(`comment:${selectedItem.id}`);
    try {
      const fallbackRecipient = resolveContextRecipient(selectedItem);
      await createScheduleContextEvent(session, {
        schedule_item_id: selectedItem.id,
        event_type: "text",
        visibility: contextVisibility,
        recipient_member_id:
          contextVisibility === "private" ? fallbackRecipient : null,
        text_content: commentText.trim(),
      });
      setCommentText("");
      await refreshContextEvents(selectedItem.id);
      notifyScheduleCollaboration(selectedItem.id, "commented");
      toast.success(t("scheduleCommentSuccess"));
    } catch (err) {
      toast.error(humanizeError(err, language));
    } finally {
      setBusy(null);
    }
  }

  async function handleAddLocationRecord() {
    if (!session || !selectedItem) return;
    setBusy(`comment:${selectedItem.id}`);
    try {
      const fallbackRecipient = resolveContextRecipient(selectedItem);
      const fix = await getCurrentLocation();
      await createScheduleContextEvent(session, {
        schedule_item_id: selectedItem.id,
        event_type: "location",
        visibility: contextVisibility,
        recipient_member_id:
          contextVisibility === "private" ? fallbackRecipient : null,
        latitude: fix.latitude,
        longitude: fix.longitude,
        location_label: t("messageLocationShared"),
      });
      await refreshContextEvents(selectedItem.id);
      notifyScheduleCollaboration(selectedItem.id, "commented");
      toast.success(t("scheduleCommentSuccess"));
    } catch (err) {
      toast.error(humanizeError(err, language) || t("chatLocationError"));
    } finally {
      setBusy(null);
    }
  }

  async function handleAddAudioRecord(
    blob: Blob,
    mimeType: string,
    durationMs: number,
  ) {
    if (!session || !selectedItem) return;
    setBusy(`comment:${selectedItem.id}`);
    try {
      const fallbackRecipient = resolveContextRecipient(selectedItem);
      const url = await uploadChatAudio(session, blob, mimeType);
      await createScheduleContextEvent(session, {
        schedule_item_id: selectedItem.id,
        event_type: "audio",
        visibility: contextVisibility,
        recipient_member_id:
          contextVisibility === "private" ? fallbackRecipient : null,
        audio_url: url,
        audio_duration_ms: durationMs,
      });
      await refreshContextEvents(selectedItem.id);
      notifyScheduleCollaboration(selectedItem.id, "commented");
      toast.success(t("scheduleCommentSuccess"));
    } catch (err) {
      toast.error(humanizeError(err, language) || t("inputAudioSendFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!session || !selectedItem) return;
    const ok = await dialog.confirm({
      title: t("scheduleDelete"),
      message: t("scheduleCommentDeleteConfirm"),
      danger: true,
    });
    if (!ok) return;

    setBusy(`comment-delete:${commentId}`);
    try {
      await deleteScheduleContextEvent(session, commentId);
      await refreshContextEvents(selectedItem.id);
      toast.success(t("scheduleCommentDeleted"));
    } catch (err) {
      toast.error(humanizeError(err, language));
    } finally {
      setBusy(null);
    }
  }

  async function handleRespondAssignment(response: "accepted" | "declined") {
    if (!session || !selectedItem) return;
    setBusy(`response:${selectedItem.id}`);
    try {
      await respondScheduleAssignment(
        session,
        selectedItem.id,
        response,
        response === "declined" ? declineNote : null,
      );
      setDeclineNote("");
      setShowDeclineNote(false);
      await openScheduleItem(selectedItem.id, false);
      notifyScheduleCollaboration(selectedItem.id, response);
      toast.success(t("scheduleRespondSuccess"));
    } catch (err) {
      toast.error(humanizeError(err, language));
    } finally {
      setBusy(null);
    }
  }

  function handlePreviousRange() {
    setSelectedDate((current) => shiftDateForView(current, viewMode, -1));
  }

  function handleNextRange() {
    setSelectedDate((current) => shiftDateForView(current, viewMode, 1));
  }

  function handleViewModeChange(mode: ScheduleViewMode) {
    setShowForm(false);
    setViewMode(mode);
  }

  function handleTodayRange() {
    setSelectedDate(startOfDay(new Date()));
  }

  function handleSelectDay(date: Date) {
    setSelectedDate(startOfDay(date));
    setViewMode("day");
  }

  function handleQuickAdd(date: Date = selectedDate) {
    if (!session) return;
    setForm(defaultFormStateForDate(session, date));
    setShowForm(true);
  }

  function handleClearFilters() {
    setSearchText("");
    setDebouncedSearchText("");
    setAssigneeFilter("all");
    setTypeFilter("all");
    setVisibilityFilter("all");
  }

  if (loading) {
    return <AppLoading tone="schedule" message={t("commonLoading")} />;
  }

  if (loadError) {
    return (
      <div className="app-page">
        <div className="section-card text-center">
          <h1 className="text-lg font-bold text-slate-900">
            {t("scheduleTitle")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{loadError}</p>
          <Link href="/" className="btn-primary mt-5">
            {t("chatBackHome")}
          </Link>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="app-page schedule-page">
      <header className="mb-3 flex items-center gap-3">
        <Link
          href="/chat"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-lg font-semibold text-brand-600 shadow-sm ring-1 ring-slate-100"
          aria-label={t("commonBackToChat")}
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-slate-950">
            {t("scheduleTitle")}
          </h1>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {session.family_name} ·{" "}
            {t("scheduleTodayPendingCount", {
              count: myOpenTodayItems.length,
            })}
          </p>
        </div>
      </header>

      <div
        className={
          filtersOpen
            ? "schedule-fab-shell schedule-fab-shell-hidden"
            : "schedule-fab-shell"
        }
      >
        <button
          type="button"
          className="schedule-fab-button"
          aria-label={showForm ? t("commonCancel") : t("scheduleNew")}
          title={showForm ? t("commonCancel") : t("scheduleNew")}
          onClick={() => {
            if (showForm) {
              setShowForm(false);
              return;
            }
            handleQuickAdd(selectedDate);
          }}
        >
          {showForm ? "×" : "+"}
        </button>
      </div>

      <MyTodaySection
        items={myOpenTodayItems}
        t={t}
        language={language}
        onSelectToday={handleTodayRange}
        onOpen={openScheduleItem}
      />

      <ScheduleFilters
        docked
        searchText={searchText}
        assigneeFilter={assigneeFilter}
        typeFilter={typeFilter}
        visibilityFilter={visibilityFilter}
        members={activeMembers}
        hasActiveFilters={hasActiveFilters}
        open={filtersOpen}
        t={t}
        onSearchTextChange={setSearchText}
        onAssigneeFilterChange={setAssigneeFilter}
        onTypeFilterChange={setTypeFilter}
        onVisibilityFilterChange={setVisibilityFilter}
        onToggleOpen={() => setFiltersOpen((current) => !current)}
        onClear={handleClearFilters}
      />

      <ScheduleRangeControl
        viewMode={viewMode}
        selectedDate={selectedDate}
        t={t}
        language={language}
        onViewModeChange={handleViewModeChange}
        onPrevious={handlePreviousRange}
        onNext={handleNextRange}
        onToday={handleTodayRange}
      />

      {showForm ? (
        <section className="section-card mb-4 flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t("scheduleNew")}</h2>
          <label>
            <span className="label">{t("scheduleFormTitle")}</span>
            <input
              className="field"
              value={form.title}
              maxLength={60}
              placeholder={t("scheduleTitlePlaceholder")}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="label">{t("scheduleType")}</span>
              <select
                className="field"
                value={form.itemType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    itemType: event.target.value as ScheduleItemType,
                  }))
                }
              >
                <option value="schedule">{t("scheduleTypeSchedule")}</option>
                <option value="todo">{t("scheduleTypeTodo")}</option>
                <option value="reminder">{t("scheduleTypeReminder")}</option>
              </select>
            </label>
            <label>
              <span className="label">{t("scheduleVisibility")}</span>
              <select
                className="field"
                value={form.visibility}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    visibility: event.target.value as ScheduleVisibility,
                  }))
                }
              >
                <option value="family">{t("scheduleVisibilityFamily")}</option>
                <option value="private">{t("scheduleVisibilityPrivate")}</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="label">{t("scheduleDate")}</span>
              <input
                className="field"
                type="date"
                value={form.date}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span className="label">{t("scheduleTime")}</span>
              <input
                className="field"
                type="time"
                value={form.time}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    time: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="label">{t("scheduleEndDate")}</span>
              <input
                className="field"
                type="date"
                value={form.endDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span className="label">{t("scheduleEndTime")}</span>
              <input
                className="field"
                type="time"
                value={form.endTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    endTime: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <label>
            <span className="label">{t("scheduleAssignee")}</span>
            <select
              className="field"
              value={form.assigneeMemberId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assigneeMemberId: event.target.value,
                }))
              }
            >
              {activeMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.nickname}
                </option>
              ))}
            </select>
          </label>

          <ReminderOffsetChips
            value={form.reminderOffsets}
            t={t}
            onChange={(reminderOffsets) =>
              setForm((current) => ({ ...current, reminderOffsets }))
            }
          />

          <label>
            <span className="label">{t("scheduleRepeat")}</span>
            <select
              className="field"
              value={form.recurrenceRule}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  recurrenceRule: event.target.value as ScheduleRecurrenceRule,
                }))
              }
            >
              <option value="none">{t("scheduleRepeatNone")}</option>
              <option value="daily">{t("scheduleRepeatDaily")}</option>
              <option value="weekly">{t("scheduleRepeatWeekly")}</option>
              <option value="monthly">{t("scheduleRepeatMonthly")}</option>
            </select>
          </label>

          <label>
            <span className="label">{t("scheduleNote")}</span>
            <textarea
              className="field min-h-20 resize-none"
              value={form.note}
              maxLength={500}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
            />
          </label>

          <button
            type="button"
            className="btn-primary"
            disabled={busy === "create"}
            onClick={handleCreate}
          >
            {busy === "create" ? t("commonLoading") : t("scheduleCreate")}
          </button>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        {itemsLoading ? (
          <div className="card text-sm text-slate-500">{t("commonLoading")}</div>
        ) : viewMode === "month" ? (
          <MonthView
            groupedItems={groupedItems}
            visibleDays={monthCalendarDays}
            selectedDate={selectedDate}
            t={t}
            language={language}
            onSelectDay={handleSelectDay}
            onOpen={openScheduleItem}
          />
        ) : viewMode === "week" ? (
          <WeekView
            groupedItems={groupedItems}
            visibleDays={visibleDays}
            session={session}
            busy={busy}
            t={t}
            language={language}
            onOpen={openScheduleItem}
            onToggle={handleToggleStatus}
            onDelete={handleDelete}
          />
        ) : (
          <DayView
            items={items}
            session={session}
            busy={busy}
            hasActiveFilters={hasActiveFilters}
            t={t}
            language={language}
            onOpen={openScheduleItem}
            onQuickAdd={() => handleQuickAdd(selectedDate)}
            onToggle={handleToggleStatus}
            onDelete={handleDelete}
          />
        )}
      </section>

      {selectedItem ? (
        <ScheduleDetailPanel
          item={selectedItem}
          members={activeMembers}
          session={session}
          busy={busy}
          detailLoading={detailLoading}
          collaboration={collaboration}
          collaborationLoading={collaborationLoading}
          contextEvents={contextEvents}
          contextEventsLoading={contextEventsLoading}
          reminderStatus={reminderStatus}
          reminderStatusLoading={reminderStatusLoading}
          commentText={commentText}
          contextVisibility={contextVisibility}
          contextRecipientId={contextRecipientId}
          declineNote={declineNote}
          showDeclineNote={showDeclineNote}
          editMode={editMode}
          editForm={editForm}
          editScope={editScope}
          deleteScope={deleteScope}
          t={t}
          language={language}
          onClose={closeDetails}
          onCommentTextChange={setCommentText}
          onContextVisibilityChange={setContextVisibility}
          onContextRecipientChange={setContextRecipientId}
          onDeclineNoteChange={setDeclineNote}
          onShowDeclineNoteChange={setShowDeclineNote}
          onAddComment={handleAddComment}
          onAddLocation={handleAddLocationRecord}
          onAddAudio={handleAddAudioRecord}
          onDeleteComment={handleDeleteComment}
          onRespondAssignment={handleRespondAssignment}
          onEdit={() => {
            setEditForm(formStateFromItem(selectedItem, reminderStatus));
            setEditScope("single");
            setEditMode(true);
          }}
          onCancelEdit={() => setEditMode(false)}
          onEditFormChange={(next) => {
            setEditForm(next);
            if (
              selectedItem.recurrence_group_id &&
              next.recurrenceRule !== (selectedItem.recurrence_rule ?? "none") &&
              editScope === "single"
            ) {
              setEditScope("future");
            }
          }}
          onEditScopeChange={setEditScope}
          onDeleteScopeChange={setDeleteScope}
          onSaveEdit={handleSaveEdit}
          onSnoozeReminder={handleSnoozeReminder}
          onToggle={() => handleToggleStatus(selectedItem)}
          onDelete={() => handleDelete(selectedItem, deleteScope)}
        />
      ) : null}
    </div>
  );
}

function ScheduleCard({
  item,
  session,
  busy,
  t,
  language,
  onOpen,
  onToggle,
  onDelete,
}: {
  item: ScheduleItem;
  session: LocalSession;
  busy: boolean;
  t: ReturnType<typeof useLanguage>["t"];
  language: ReturnType<typeof useLanguage>["language"];
  onOpen: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const canToggle =
    item.creator_member_id === session.member_id ||
    item.assignee_member_id === session.member_id;
  const canDelete =
    canToggle || (session.is_admin && item.visibility === "family");
  const done = item.status === "done";
  const hasReminder = Boolean(item.remind_at);
  const tone = scheduleToneClasses(item);

  return (
    <article
      className={`relative overflow-hidden rounded-2xl bg-white p-3 pl-4 shadow-sm ring-1 transition ${tone.cardRing} ${
        done ? "opacity-70" : ""
      }`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${tone.accent}`}
      />
      <div className="flex items-start gap-3">
        <div className="relative z-10 w-14 shrink-0 text-center">
          <div className={`mx-auto mb-1 h-2.5 w-2.5 rounded-full ${tone.dot}`} />
          <div className={`text-sm font-bold ${tone.time}`}>
            {formatTime(item.starts_at, language)}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {formatDate(item.starts_at, language)}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <h2
              className={`min-w-0 flex-1 break-words text-base font-semibold leading-5 ${
                done ? "line-through text-slate-500" : "text-slate-900"
              }`}
            >
              {item.title}
            </h2>
            {item.visibility === "private" ? <LockBadge /> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-slate-500">
            <span className={`rounded-full px-2 py-1 font-semibold ring-1 ${tone.badge}`}>
              {itemTypeLabel(item.item_type, t)}
            </span>
            <span className="hidden">·</span>
            <span
              className={`rounded-full px-2 py-1 font-medium ring-1 ${
                item.visibility === "private"
                  ? "bg-violet-50 text-violet-700 ring-violet-100"
                  : "bg-slate-100 text-slate-600 ring-slate-200"
              }`}
            >
              {item.visibility === "family"
                ? t("scheduleVisibilityFamily")
                : t("scheduleVisibilityPrivate")}
            </span>
            <span className="hidden">·</span>
            <span className="max-w-full truncate rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
              {t("scheduleAssignee")}: {item.assignee_nickname}
            </span>
            {item.recurrence_rule && item.recurrence_rule !== "none" ? (
              <>
                <span className="hidden">·</span>
                <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-700 ring-1 ring-emerald-100">
                  {recurrenceLabel(item.recurrence_rule, t)}
                </span>
              </>
            ) : null}
          </div>
          {hasReminder && item.remind_at ? (
            <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-xl bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-100">
              <span>
                {t("scheduleReminderTime")}:{" "}
                {formatTime(item.remind_at, language)}
              </span>
              <span className="h-1 w-1 rounded-full bg-amber-300" />
              <span>
                {item.reminded_at
                  ? t("scheduleReminderSent")
                  : t("scheduleReminderPending")}
              </span>
            </div>
          ) : null}
          {item.note ? (
            <p className="mt-2 max-h-12 overflow-hidden whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
              {item.note}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 pl-0 sm:pl-[68px]">
        {canToggle ? (
          <button
            type="button"
            className="btn-secondary min-w-0 px-2 text-sm"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            {done ? t("scheduleRestore") : t("scheduleDone")}
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            className={`btn-ghost min-w-0 px-2 text-sm text-rose-600 hover:bg-rose-50 ${
              canToggle ? "" : "col-span-2"
            }`}
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            {t("scheduleDelete")}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ScheduleDetailPanel({
  item,
  members,
  session,
  busy,
  detailLoading,
  collaboration,
  collaborationLoading,
  contextEvents,
  contextEventsLoading,
  reminderStatus,
  reminderStatusLoading,
  commentText,
  contextVisibility,
  contextRecipientId,
  declineNote,
  showDeclineNote,
  editMode,
  editForm,
  editScope,
  deleteScope,
  t,
  language,
  onClose,
  onCommentTextChange,
  onContextVisibilityChange,
  onContextRecipientChange,
  onDeclineNoteChange,
  onShowDeclineNoteChange,
  onAddComment,
  onAddLocation,
  onAddAudio,
  onDeleteComment,
  onRespondAssignment,
  onEdit,
  onCancelEdit,
  onEditFormChange,
  onEditScopeChange,
  onDeleteScopeChange,
  onSaveEdit,
  onSnoozeReminder,
  onToggle,
  onDelete,
}: {
  item: ScheduleItem;
  members: FamilyMember[];
  session: LocalSession;
  busy: string | null;
  detailLoading: boolean;
  collaboration: ScheduleCollaboration | null;
  collaborationLoading: boolean;
  contextEvents: ScheduleContextEvent[];
  contextEventsLoading: boolean;
  reminderStatus: ScheduleReminderStatus | null;
  reminderStatusLoading: boolean;
  commentText: string;
  contextVisibility: ScheduleContextVisibility;
  contextRecipientId: string;
  declineNote: string;
  showDeclineNote: boolean;
  editMode: boolean;
  editForm: ScheduleFormState;
  editScope: ScheduleRecurrenceScope;
  deleteScope: ScheduleRecurrenceScope;
  t: ReturnType<typeof useLanguage>["t"];
  language: ReturnType<typeof useLanguage>["language"];
  onClose: () => void;
  onCommentTextChange: (value: string) => void;
  onContextVisibilityChange: (value: ScheduleContextVisibility) => void;
  onContextRecipientChange: (value: string) => void;
  onDeclineNoteChange: (value: string) => void;
  onShowDeclineNoteChange: (value: boolean) => void;
  onAddComment: () => void;
  onAddLocation: () => Promise<void>;
  onAddAudio: (blob: Blob, mimeType: string, durationMs: number) => Promise<void>;
  onDeleteComment: (commentId: string) => void;
  onRespondAssignment: (response: "accepted" | "declined") => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onEditFormChange: (next: ScheduleFormState) => void;
  onEditScopeChange: (scope: ScheduleRecurrenceScope) => void;
  onDeleteScopeChange: (scope: ScheduleRecurrenceScope) => void;
  onSaveEdit: () => void;
  onSnoozeReminder: (deliveryId: string, minutes: 5 | 10 | 30) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const recordingHandleRef = useRef<RecordingHandle | null>(null);
  const recordingPointerHeldRef = useRef(false);
  const recordingTimeoutRef = useRef<number | null>(null);
  const titleId = `schedule-detail-title-${item.id}`;
  const composerOptionsId = `schedule-composer-options-${item.id}`;
  const whisperPickerId = `schedule-composer-whisper-${item.id}`;
  const [composerOptionsOpen, setComposerOptionsOpen] = useState(false);
  const [whisperPickerOpen, setWhisperPickerOpen] = useState(false);
  const [conversationExpanded, setConversationExpanded] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [viewportStyle, setViewportStyle] = useState<CSSProperties>({
    height: "100dvh",
  });
  const detailPanelStyle: CSSProperties = {
    height: "min(92dvh, calc(100% - 1rem))",
    maxHeight: "min(92dvh, calc(100% - 1rem))",
  };
  const canEdit =
    item.creator_member_id === session.member_id ||
    item.assignee_member_id === session.member_id ||
    (session.is_admin && item.visibility === "family");
  const isRecurring = Boolean(item.recurrence_group_id);
  const editBusy = busy === `edit:${item.id}`;
  const itemBusy = busy === item.id;
  const responseBusy = busy === `response:${item.id}`;
  const commentBusy = busy === `comment:${item.id}`;
  const response = collaboration?.assignee_response ?? {
    status: "pending",
    responded_at: null,
    note: null,
  };
  const isAssignee = item.assignee_member_id === session.member_id;
  const canComment = item.status !== "cancelled";
  const contextRecipientOptions = members.filter((member) => {
    if (member.id === session.member_id || member.status !== "active") return false;
    if (item.visibility === "family") return true;
    return (
      member.id === item.creator_member_id ||
      member.id === item.assignee_member_id
    );
  });
  const selectedContextRecipient =
    contextRecipientOptions.find((member) => member.id === contextRecipientId) ??
    contextRecipientOptions[0] ??
    null;
  const canPickWhisper = contextRecipientOptions.length > 0;
  const composerBusy = commentBusy;
  const whisperModeLabel =
    contextVisibility === "private" && selectedContextRecipient
      ? t("whisperModeLabel", { nickname: selectedContextRecipient.nickname })
      : null;
  const commentPlaceholder =
    contextVisibility === "private"
      ? selectedContextRecipient
        ? t("scheduleRecordPrivatePlaceholder", {
            nickname: selectedContextRecipient.nickname,
          })
        : t("scheduleRecordPrivate")
      : t("scheduleRecordPlaceholder");
  const sendDisabled =
    composerBusy ||
    commentText.trim().length === 0 ||
    (contextVisibility === "private" && !selectedContextRecipient);
  const recordRows = contextEvents
    .map((event) => ({
      id: `event:${event.id}`,
      event,
      created_at: event.created_at,
    }))
    .sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
  );
  const deliveries = reminderStatus?.deliveries ?? [];
  const deliveryCounts = deliveries.reduce<Record<string, number>>((acc, delivery) => {
    acc[delivery.status] = (acc[delivery.status] ?? 0) + 1;
    return acc;
  }, {});
  const highlightedDeliveries = deliveries
    .filter((delivery) => delivery.status === "failed" || delivery.status === "gone")
    .slice(0, 3);
  const scheduleTimeRange = `${formatDate(item.starts_at, language)} ${formatTime(
    item.starts_at,
    language,
  )}${
    item.ends_at
      ? ` - ${formatTime(item.ends_at, language)}`
      : ""
  }`;
  const reminderTimeLabel = item.remind_at
    ? `${formatDate(item.remind_at, language)} ${formatTime(item.remind_at, language)}`
    : t("scheduleReminderNone");
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );

  function clearRecordingTimeout() {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  }

  async function stopScheduleRecording(cancel = false) {
    clearRecordingTimeout();
    const handle = recordingHandleRef.current;
    if (!handle) return;
    recordingHandleRef.current = null;
    setRecordingActive(false);

    if (cancel) {
      handle.cancel();
      return;
    }

    try {
      const result = await handle.stop();
      if (result.durationMs < SCHEDULE_MIN_RECORD_MS) {
        setComposerNotice(t("inputRecordingTooShort"));
        return;
      }
      await onAddAudio(result.blob, result.mimeType, result.durationMs);
    } catch (err) {
      setComposerNotice(humanizeError(err, language) || t("inputAudioSendFailed"));
    }
  }

  async function handleVoicePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (composerBusy || recordingActive) return;
    event.preventDefault();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    recordingPointerHeldRef.current = true;
    setComposerNotice(null);
    setComposerOptionsOpen(false);
    setWhisperPickerOpen(false);

    try {
      const handle = await startRecording();
      recordingHandleRef.current = handle;
      setRecordingActive(true);
      try {
        target.setPointerCapture?.(pointerId);
      } catch {
        // Pointer may have ended while the browser permission prompt was open.
      }
      recordingTimeoutRef.current = window.setTimeout(() => {
        void stopScheduleRecording(false);
      }, SCHEDULE_MAX_RECORD_MS);
      if (!recordingPointerHeldRef.current) {
        void stopScheduleRecording(false);
      }
    } catch (err) {
      setComposerNotice(
        humanizeError(err, language) ||
          t("inputRecordStartError", {
            message: err instanceof Error ? err.message : t("commonUnknownMember"),
          }),
      );
    }
  }

  function handleVoicePointerUp(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    recordingPointerHeldRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    void stopScheduleRecording(false);
  }

  function handleVoicePointerCancel() {
    recordingPointerHeldRef.current = false;
    void stopScheduleRecording(true);
  }

  useEffect(() => {
    setComposerOptionsOpen(false);
    setWhisperPickerOpen(false);
    setConversationExpanded(false);
    setComposerNotice(null);
  }, [item.id]);

  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) {
        window.clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
      recordingPointerHeldRef.current = false;
      recordingHandleRef.current?.cancel();
      recordingHandleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const visualViewport = window.visualViewport;

    function updateViewport() {
      if (!visualViewport) {
        setViewportStyle({ height: "100dvh" });
        return;
      }

      setViewportStyle({
        height: `${visualViewport.height}px`,
        transform: `translateY(${visualViewport.offsetTop}px)`,
      });
    }

    updateViewport();
    visualViewport?.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    return () => {
      visualViewport?.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
    };
  }, []);

  useEffect(() => {
    const restoreTarget =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (restoreTarget?.isConnected) {
        restoreTarget.focus({ preventScroll: true });
      }
    };
  }, [item.id]);

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (editMode) {
        onCancelEdit();
        return;
      }
      onClose();
      return;
    }

    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = getFocusableElements(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-end overflow-hidden bg-slate-950/35 px-0 sm:items-center sm:px-6"
      style={viewportStyle}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className="flex w-full flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl focus:outline-none sm:mx-auto sm:max-w-2xl sm:rounded-3xl"
        style={detailPanelStyle}
      >
        <div className="shrink-0 p-4 pb-3 sm:p-5 sm:pb-3">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
              {t("scheduleDetail")}
            </p>
            <h2
              id={titleId}
              className="mt-1 break-words text-xl font-bold text-slate-900"
            >
              {item.title}
            </h2>
          </div>
          {!editMode ? (
            <button
              ref={closeButtonRef}
              type="button"
              className="btn-ghost shrink-0 px-3"
              onClick={onClose}
            >
              {t("commonCancel")}
            </button>
          ) : null}
        </div>

        {detailLoading ? (
          <div className="mb-3 rounded-2xl bg-white p-3 text-sm text-slate-500 ring-1 ring-slate-100">
            {t("commonLoading")}
          </div>
        ) : null}
        </div>

        {editMode ? (
          <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5">
            <ScheduleEditFields
              form={editForm}
              members={members}
              t={t}
              onChange={onEditFormChange}
            />
            {isRecurring ? (
              <ScopeSelect
                label={t("scheduleEditScope")}
                value={editScope}
                t={t}
                description={t("scheduleEditScopeHelp")}
                onChange={onEditScopeChange}
              />
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn-ghost"
                disabled={editBusy}
                onClick={onCancelEdit}
              >
                {t("commonCancel")}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={editBusy}
                onClick={onSaveEdit}
              >
                {editBusy ? t("commonLoading") : t("scheduleSaveChanges")}
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`flex min-h-0 flex-1 flex-col gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5 ${
              conversationExpanded ? "overflow-hidden" : "overflow-y-auto"
            }`}
          >
            <div
              className={
                conversationExpanded
                  ? "hidden"
                  : "shrink-0 rounded-2xl bg-white p-3 text-sm text-slate-700 ring-1 ring-slate-100"
              }
            >
              <div className="flex flex-wrap gap-2">
                <DetailPill
                  label={t("scheduleType")}
                  value={itemTypeLabel(item.item_type, t)}
                />
                <DetailPill
                  label={t("scheduleVisibility")}
                  value={
                    item.visibility === "family"
                      ? t("scheduleVisibilityFamily")
                      : t("scheduleVisibilityPrivate")
                  }
                />
                <DetailPill
                  label={t("scheduleAssignee")}
                  value={item.assignee_nickname}
                />
                <DetailPill
                  label={t("scheduleRepeat")}
                  value={recurrenceLabel(item.recurrence_rule ?? "none", t)}
                />
                <DetailPill
                  label={t("scheduleStatus")}
                  value={
                    item.status === "done"
                      ? t("scheduleStatusDone")
                      : t("scheduleStatusActive")
                  }
                />
                <DetailPill
                  label={t("scheduleStartTime")}
                  value={scheduleTimeRange}
                />
                <DetailPill
                  label={t("scheduleReminder")}
                  value={reminderTimeLabel}
                />
              </div>
            </div>

            {item.note && !conversationExpanded ? (
              <details className="shrink-0 rounded-2xl bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-100">
                <summary className="cursor-pointer list-none text-xs font-semibold text-slate-500">
                  {t("scheduleNote")}
                </summary>
                <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-words leading-6">
                  {item.note}
                </p>
              </details>
            ) : null}

            <details
              className={
                conversationExpanded
                  ? "hidden"
                  : "shrink-0 rounded-2xl bg-white p-3 ring-1 ring-slate-100"
              }
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-slate-900">
                  {t("scheduleReminderStatus")}
                </span>
                {reminderStatusLoading ? (
                  <span className="text-xs text-slate-400">
                    {t("commonLoading")}
                  </span>
                ) : deliveries.length ? (
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-100">
                    {deliveries.length}
                  </span>
                ) : null}
              </summary>
              {!reminderStatus?.configured && !item.remind_at ? (
                <p className="mt-2 rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
                  {t("scheduleReminderNotSet")}
                </p>
              ) : (
                <div className="mt-2 max-h-[28dvh] space-y-2 overflow-y-auto pr-1">
                  <div className="rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-100">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {t("scheduleReminderWillSendAt")}
                      </span>
                      {reminderStatus?.rules?.length ? (
                        reminderStatus.rules.map((offset) => (
                          <span
                            key={offset}
                            className="rounded-full bg-white/70 px-2 py-1 text-xs font-semibold text-amber-800"
                          >
                            {reminderOffsetLabel(offset, t)}
                          </span>
                        ))
                      ) : item.remind_at ? (
                        <span className="text-xs font-semibold">
                          {formatDate(item.remind_at, language)}{" "}
                          {formatTime(item.remind_at, language)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <ReminderDeliveryCard
                    delivery={reminderStatus?.current_member_delivery ?? null}
                    t={t}
                    language={language}
                    canSnooze={item.status === "active"}
                    busy={busy}
                    onSnooze={onSnoozeReminder}
                  />
                  {(reminderStatus?.deliveries.length ?? 0) > 1 ? (
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-slate-900">
                          {t("scheduleReminderDeliveryMembers")}
                        </h4>
                        <span className="text-xs text-slate-400">
                          {deliveries.length}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {["pending", "sent", "failed", "gone", "skipped"].map((status) =>
                          deliveryCounts[status] ? (
                            <span
                              key={status}
                              className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-100"
                            >
                              {reminderDeliveryLabel(status, t)} {deliveryCounts[status]}
                            </span>
                          ) : null,
                        )}
                      </div>
                      {highlightedDeliveries.length ? (
                        <div className="mt-2 grid gap-1.5">
                          {highlightedDeliveries.map((delivery) => (
                            <ReminderDeliveryCard
                              key={delivery.id}
                              delivery={delivery}
                              t={t}
                              language={language}
                              compact
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </details>

            <section
              className={`flex flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_10px_28px_rgba(71,64,49,0.06)] ring-1 ring-slate-100 ${
                conversationExpanded ? "min-h-0 flex-1" : "shrink-0"
              }`}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-3">
                <h3 className="text-base font-semibold text-slate-900">
                  {t("scheduleConversation")}
                </h3>
                <div className="flex shrink-0 items-center gap-2">
                  {collaborationLoading ? (
                    <span className="text-xs text-slate-400">
                      {t("commonLoading")}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="native-press inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-50 text-slate-500 ring-1 ring-slate-200 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                    aria-label={
                      conversationExpanded
                        ? t("scheduleConversationCollapse")
                        : t("scheduleConversationExpand")
                    }
                    title={
                      conversationExpanded
                        ? t("scheduleConversationCollapse")
                        : t("scheduleConversationExpand")
                    }
                    onClick={() =>
                      setConversationExpanded((expanded) => !expanded)
                    }
                  >
                    {conversationExpanded ? (
                      <svg
                        aria-hidden="true"
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M8 3v5H3" />
                        <path d="M16 3v5h5" />
                        <path d="M8 21v-5H3" />
                        <path d="M16 21v-5h5" />
                      </svg>
                    ) : (
                      <svg
                        aria-hidden="true"
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M15 3h6v6" />
                        <path d="M9 21H3v-6" />
                        <path d="M21 3l-7 7" />
                        <path d="M3 21l7-7" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {contextEventsLoading ? (
                  <div className="mx-3 my-3 flex min-h-40 flex-1 items-center justify-center rounded-[22px] bg-slate-50 text-sm text-slate-500 ring-1 ring-slate-100">
                    {t("commonLoading")}
                  </div>
                ) : (
                  <div
                    className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 ${
                      conversationExpanded
                        ? "[&>*:first-child]:mt-auto"
                        : "max-h-[34dvh]"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <ScheduleConversationAvatar label="家" tone="keeper" />
                      <div className="flex min-w-0 flex-1 flex-col items-start gap-1 sm:max-w-lg">
                        <div className="flex max-w-full min-w-0 items-center gap-1.5 text-[11px] leading-4 text-slate-500">
                          <span className="max-w-full truncate font-medium text-slate-700">
                            {t("keeperName")}
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="shrink-0">
                            {t("scheduleAssigneeResponse")}
                          </span>
                        </div>
                        <div className="w-full max-w-full rounded-[22px] rounded-bl-md bg-slate-50 px-3.5 py-3 text-sm text-slate-800 ring-1 ring-slate-100">
                          <div className="mb-2 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                              {itemTypeLabel(item.item_type, t)}
                            </span>
                            <span className={responseBadgeClass(response.status)}>
                              {assigneeResponseLabel(response.status, t)}
                            </span>
                          </div>
                          <h4 className="break-words text-base font-bold leading-6 text-slate-950">
                            {item.title}
                          </h4>
                          <p className="mt-1 break-words text-xs leading-5 text-slate-600">
                            {t("scheduleStartTime")}: {scheduleTimeRange}
                          </p>
                          {item.note ? (
                            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">
                              {item.note}
                            </p>
                          ) : null}
                          {response.note ? (
                            <p className="mt-2 whitespace-pre-wrap break-words rounded-2xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                              {response.note}
                            </p>
                          ) : null}
                          {isAssignee && item.status === "active" ? (
                            <div className="mt-3 flex flex-col gap-2">
                              {showDeclineNote ? (
                                <textarea
                                  className="field min-h-20 resize-none"
                                  value={declineNote}
                                  maxLength={300}
                                  placeholder={t("scheduleDeclineReason")}
                                  onChange={(event) =>
                                    onDeclineNoteChange(event.target.value)
                                  }
                                />
                              ) : null}
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  className="btn-secondary min-w-0 px-3"
                                  disabled={responseBusy}
                                  onClick={() => onRespondAssignment("accepted")}
                                >
                                  {t("scheduleAcceptAssignment")}
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost min-w-0 px-3 text-rose-600 hover:bg-rose-50"
                                  disabled={responseBusy}
                                  onClick={() => {
                                    if (!showDeclineNote) {
                                      onShowDeclineNoteChange(true);
                                      return;
                                    }
                                    onRespondAssignment("declined");
                                  }}
                                >
                                  {t("scheduleDeclineAssignment")}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {recordRows.length ? (
                      recordRows.map((row) => {
                      const event = row.event;
                      const senderMemberId = event.sender_member_id ?? null;
                      const isMine = senderMemberId === session.member_id;
                      const isSystem = isScheduleTimelineSystemEvent(event);
                      const nickname = event.sender_nickname ?? t("keeperName");
                      const createdAt = event.created_at ?? row.created_at;
                      const text = isSystem
                        ? scheduleTimelineFallback(event, t)
                        : event.text_content ?? scheduleTimelineFallback(event, t);
                      const isPrivate = event.visibility === "private";
                      const senderMember = senderMemberId
                        ? memberById.get(senderMemberId) ?? null
                        : null;
                      const isAudioRecord =
                        event.event_type === "audio" && Boolean(event.audio_url);
                      const isLocationRecord = event.event_type === "location";
                      const avatarLabel = (isMine ? t("membersMe") : nickname).slice(0, 1);
                      const canDeleteRecord =
                        isMine && ["text", "audio", "location"].includes(event.event_type);
                      if (isSystem) {
                        return (
                          <div key={row.id} className="flex justify-start pl-11 pr-3">
                            <div className="max-w-[90%] rounded-2xl bg-slate-50 px-3 py-1.5 text-left text-[11px] font-medium text-slate-500 ring-1 ring-slate-100">
                              <span className="break-words">{text}</span>
                              <span className="ml-1 text-slate-400">
                                {formatTime(createdAt, language)}
                              </span>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={row.id}>
                          <div
                            className={`mb-1 flex items-center gap-1 text-[11px] text-slate-500 ${
                              isMine ? "justify-end pr-11" : "pl-11"
                            }`}
                          >
                            <span className="max-w-28 truncate">
                              {isMine ? t("membersMe") : nickname}
                            </span>
                            <span aria-hidden="true">/</span>
                            <span>{formatTime(createdAt, language)}</span>
                            {canDeleteRecord ? (
                              <>
                                <span aria-hidden="true">/</span>
                                <button
                                  type="button"
                                  className="font-semibold text-slate-400 hover:text-rose-500 disabled:opacity-50"
                                  disabled={busy === `comment-delete:${event.id}`}
                                  onClick={() => onDeleteComment(event.id)}
                                >
                                  {t("scheduleDelete")}
                                </button>
                              </>
                            ) : null}
                          </div>
                          <div
                            className={`flex items-end gap-2 ${
                              isMine ? "justify-end" : "justify-start"
                            }`}
                          >
                            {!isMine ? (
                              <ScheduleConversationAvatar
                                label={avatarLabel}
                                session={session}
                                avatarRef={senderMember?.avatar_url ?? null}
                                tone={
                                  event.sender_type === "keeper"
                                    ? "keeper"
                                    : "member"
                                }
                              />
                            ) : null}
                            <div
                              className={
                                isAudioRecord
                                  ? "max-w-[78%]"
                                  : `max-w-[78%] rounded-[20px] px-3.5 py-2.5 text-sm shadow-[0_10px_24px_rgba(77,67,50,0.08)] ${
                                      isMine
                                        ? "rounded-br-md bg-brand-600 text-white ring-1 ring-white/20"
                                        : event.sender_type === "keeper"
                                          ? "rounded-bl-md bg-white/95 text-slate-800 ring-1 ring-emerald-100/80"
                                          : "rounded-bl-md bg-white/95 text-slate-800 ring-1 ring-white/80"
                                    }`
                              }
                            >
                              {isPrivate ? (
                                <div
                                  className={`mb-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                    isMine && !isAudioRecord
                                      ? "bg-white/20 text-white"
                                      : "bg-violet-100 text-violet-700"
                                  }`}
                                >
                                  {t("messageWhisperLabel")}
                                </div>
                              ) : null}
                              {isPrivate && isMine && event.recipient_nickname ? (
                                <p
                                  className={`mb-1 text-[11px] ${
                                    isAudioRecord
                                      ? "text-violet-600"
                                      : "text-white/80"
                                  }`}
                                >
                                  {t("messageWhisperTo", {
                                    nickname: event.recipient_nickname,
                                  })}
                                </p>
                              ) : null}
                              {isAudioRecord ? (
                                <ScheduleContextAudioBubble
                                  session={session}
                                  event={event}
                                  isMine={isMine}
                                />
                              ) : isLocationRecord ? (
                                <ScheduleLocationBubble
                                  event={event}
                                  isMine={isMine}
                                  t={t}
                                />
                              ) : (
                                <p className="whitespace-pre-wrap break-words leading-6">
                                  {text}
                                </p>
                              )}
                            </div>
                            {isMine ? (
                              <ScheduleConversationAvatar
                                label={avatarLabel}
                                session={session}
                                avatarRef={senderMember?.avatar_url ?? null}
                                tone="mine"
                              />
                            ) : null}
                          </div>
                        </div>
                      );
                      })
                    ) : (
                      <div className="flex justify-start pl-11 pr-3">
                        <div className="max-w-[90%] rounded-2xl bg-slate-50 px-3 py-1.5 text-left text-[11px] font-medium text-slate-500 ring-1 ring-slate-100">
                          {t("scheduleConversationEmpty")}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {canComment ? (
                  <div className="relative z-20 shrink-0 overflow-visible border-t border-slate-100 bg-white px-3 py-2 sm:px-4">
                    {composerOptionsOpen ? (
                      <div
                        id={composerOptionsId}
                        className="chat-input-actions-popover native-scroll"
                        role="menu"
                        aria-label={t("scheduleRecordOptions")}
                      >
                        <button
                          type="button"
                          className={SCHEDULE_COMPOSER_ICON_BUTTON_CLASS}
                          style={{ backgroundImage: "url(/ui-icons/location.png)" }}
                          aria-label={t("inputSendLocation")}
                          title={t("inputSendLocation")}
                          role="menuitem"
                          disabled={composerBusy || recordingActive}
                          onClick={() => {
                            setComposerOptionsOpen(false);
                            setWhisperPickerOpen(false);
                            void onAddLocation();
                          }}
                        />
                        <button
                          type="button"
                          className={SCHEDULE_COMPOSER_ICON_BUTTON_CLASS}
                          style={{
                            backgroundImage: "url(/ui-icons/whisper-lock.png)",
                          }}
                          aria-label={t("inputWhisper")}
                          title={
                            canPickWhisper
                              ? t("inputWhisper")
                              : t("inputWhisperNoMembers")
                          }
                          role="menuitem"
                          aria-haspopup="dialog"
                          aria-expanded={whisperPickerOpen}
                          aria-controls={
                            whisperPickerOpen ? whisperPickerId : undefined
                          }
                          disabled={
                            composerBusy || recordingActive || !canPickWhisper
                          }
                          onClick={() => {
                            setWhisperPickerOpen((open) => !open);
                            if (!contextRecipientId && selectedContextRecipient) {
                              onContextRecipientChange(selectedContextRecipient.id);
                            }
                            onContextVisibilityChange("private");
                          }}
                        />
                      </div>
                    ) : null}
                    {whisperPickerOpen ? (
                      <div
                        id={whisperPickerId}
                        className="chat-input-whisper-popover"
                        role="dialog"
                        aria-label={t("inputWhisperPick")}
                      >
                        <div className="flex items-center gap-2 border-b border-violet-50 px-3 py-2 text-sm font-semibold text-violet-800">
                          <span
                            aria-hidden="true"
                            className="h-5 w-5 shrink-0 rounded-md bg-cover bg-center"
                            style={{
                              backgroundImage: "url(/ui-icons/whisper-lock.png)",
                            }}
                          />
                          <span>{t("inputWhisperPick")}</span>
                        </div>
                        <div className="native-scroll max-h-48 overflow-y-auto p-2">
                          {contextRecipientOptions.map((member) => (
                            <button
                              key={member.id}
                              type="button"
                              className="flex min-h-10 w-full items-center gap-2 rounded-[14px] px-2 text-left text-sm text-slate-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"
                              onClick={() => {
                                onContextRecipientChange(member.id);
                                onContextVisibilityChange("private");
                                setComposerOptionsOpen(false);
                                setWhisperPickerOpen(false);
                                commentInputRef.current?.focus({
                                  preventScroll: true,
                                });
                              }}
                            >
                              <ScheduleConversationAvatar
                                label={member.nickname.slice(0, 1)}
                                session={session}
                                avatarRef={member.avatar_url}
                              />
                              <span className="min-w-0 flex-1 truncate font-semibold">
                                {member.nickname}
                              </span>
                              {member.id === contextRecipientId ? (
                                <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                                  {t("inputWhisperCurrent")}
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="w-full border-t border-slate-100 px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-200"
                          onClick={() => setWhisperPickerOpen(false)}
                        >
                          {t("commonCancel")}
                        </button>
                      </div>
                    ) : null}
                    {whisperModeLabel ? (
                      <div className="mb-2 flex items-center gap-2 rounded-2xl bg-violet-50/90 px-3 py-2 text-xs font-semibold text-violet-700 ring-1 ring-violet-100">
                        <span className="min-w-0 flex-1 truncate">
                          {whisperModeLabel}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-violet-500 underline-offset-2 hover:underline"
                          onClick={() => {
                            onContextVisibilityChange("family");
                            onContextRecipientChange("");
                            setWhisperPickerOpen(false);
                          }}
                        >
                          {t("whisperExit")}
                        </button>
                      </div>
                    ) : null}
                    {recordingActive || composerNotice ? (
                      <div
                        className={`mb-2 rounded-2xl px-3 py-2 text-xs font-semibold ring-1 ${
                          recordingActive
                            ? "bg-brand-50 text-brand-700 ring-brand-100"
                            : "bg-rose-50 text-rose-700 ring-rose-100"
                        }`}
                      >
                        {recordingActive ? t("inputRecordingHoldHint") : composerNotice}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={`${SCHEDULE_COMPOSER_ICON_BUTTON_CLASS} ${
                          composerOptionsOpen || contextVisibility === "private"
                            ? "ring-2 ring-brand-200"
                            : ""
                        }`}
                        style={{ backgroundImage: "url(/ui-icons/plus.png)" }}
                        aria-label={t("scheduleRecordOptions")}
                        title={t("scheduleRecordOptions")}
                        aria-haspopup="menu"
                        aria-expanded={composerOptionsOpen}
                        aria-controls={
                          composerOptionsOpen ? composerOptionsId : undefined
                        }
                        disabled={composerBusy || recordingActive}
                        onClick={() => {
                          setComposerNotice(null);
                          setWhisperPickerOpen(false);
                          setComposerOptionsOpen((open) => !open);
                        }}
                      />
                      <button
                        type="button"
                        className={`${SCHEDULE_COMPOSER_ICON_BUTTON_CLASS} ${
                          recordingActive ? "ring-2 ring-brand-300" : ""
                        }`}
                        style={{ backgroundImage: "url(/ui-icons/voice.png)" }}
                        aria-label={
                          recordingActive
                            ? t("inputStopRecording")
                            : t("inputRecordVoice")
                        }
                        title={
                          recordingActive
                            ? t("inputStopRecording")
                            : t("inputRecordVoice")
                        }
                        disabled={composerBusy}
                        onPointerDown={(event) => {
                          void handleVoicePointerDown(event);
                        }}
                        onPointerUp={handleVoicePointerUp}
                        onPointerCancel={handleVoicePointerCancel}
                        onPointerLeave={() => {
                          recordingPointerHeldRef.current = false;
                          if (recordingActive) void stopScheduleRecording(false);
                        }}
                      />
                      <textarea
                        ref={commentInputRef}
                        className="field max-h-32 min-h-[44px] flex-1 resize-none rounded-[18px] border-slate-200 bg-slate-50/80 py-3 shadow-none focus:border-brand-300 focus:bg-white"
                        value={commentText}
                        maxLength={300}
                        rows={1}
                        placeholder={commentPlaceholder}
                        style={{ fontSize: 16 }}
                        onChange={(event) =>
                          onCommentTextChange(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            if (!sendDisabled) {
                              setComposerOptionsOpen(false);
                              setWhisperPickerOpen(false);
                              onAddComment();
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn-primary native-press h-10 shrink-0 rounded-[16px] px-4 shadow-[0_10px_18px_rgba(79,108,247,0.22)]"
                        disabled={sendDisabled}
                        onClick={() => {
                          setComposerOptionsOpen(false);
                          setWhisperPickerOpen(false);
                          onAddComment();
                        }}
                      >
                        {commentBusy ? t("commonLoading") : t("commonSend")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

            </section>

            {isRecurring && !conversationExpanded ? (
              <div className="shrink-0">
                <ScopeSelect
                  label={t("scheduleDeleteScope")}
                  value={deleteScope}
                  t={t}
                  onChange={onDeleteScopeChange}
                />
              </div>
            ) : null}

            {canEdit && !conversationExpanded ? (
              <div className="grid shrink-0 grid-cols-3 gap-2">
                <button type="button" className="btn-secondary" onClick={onEdit}>
                  {t("scheduleEdit")}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={itemBusy}
                  onClick={onToggle}
                >
                  {item.status === "done" ? t("scheduleRestore") : t("scheduleDone")}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-rose-600 hover:bg-rose-50"
                  disabled={itemBusy}
                  onClick={onDelete}
                >
                  {t("scheduleDelete")}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleConversationAvatar({
  label,
  session,
  avatarRef,
  tone = "member",
}: {
  label: string;
  session?: LocalSession | null;
  avatarRef?: string | null;
  tone?: "keeper" | "member" | "mine";
}) {
  const avatarUrl = useResolvedMediaUrl(session ?? null, avatarRef ?? null);
  const toneClass =
    tone === "keeper"
      ? "bg-emerald-100 text-emerald-700 ring-emerald-50"
      : tone === "mine"
        ? "bg-brand-600 text-white ring-white/30"
        : "bg-white/90 text-slate-700 ring-white/80";

  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold shadow-[0_8px_18px_rgba(71,64,49,0.08)] ring-1 ${toneClass}`}
      aria-hidden="true"
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        label
      )}
    </div>
  );
}

function ScheduleContextAudioBubble({
  session,
  event,
  isMine,
}: {
  session: LocalSession;
  event: ScheduleContextEvent;
  isMine: boolean;
}) {
  const audioUrl = useResolvedMediaUrl(session, event.audio_url, {
    contextEventId: event.id,
  });
  if (!audioUrl) return null;

  return (
    <AudioBubble
      messageId={event.id}
      url={audioUrl}
      durationMs={event.audio_duration_ms}
      isMine={isMine}
    />
  );
}

function ScheduleLocationBubble({
  event,
  isMine,
  t,
}: {
  event: ScheduleContextEvent;
  isMine: boolean;
  t: ReturnType<typeof useLanguage>["t"];
}) {
  const mapUrl =
    event.latitude != null && event.longitude != null
      ? createGoogleMapUrl(event.latitude, event.longitude)
      : null;
  const detail = event.location_label || t("messageLocationShared");

  return (
    <a
      href={mapUrl ?? "#"}
      target={mapUrl ? "_blank" : undefined}
      rel={mapUrl ? "noreferrer" : undefined}
      onClick={(event) => {
        if (!mapUrl) event.preventDefault();
      }}
      className="flex min-w-40 max-w-full flex-col gap-1 no-underline sm:max-w-56"
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 rounded-md bg-cover bg-center"
          style={{ backgroundImage: "url(/ui-icons/location.png)" }}
        />
        <span>{t("messageLocationTitle")}</span>
      </span>
      <span
        className={`text-xs leading-5 ${
          isMine ? "text-brand-50" : "text-slate-700"
        }`}
      >
        {detail}
      </span>
      <span
        className={`text-xs font-medium leading-5 ${
          isMine ? "text-brand-100" : "text-brand-500"
        }`}
      >
        {t("messageOpenMap")}
      </span>
    </a>
  );
}

function ScheduleEditFields({
  form,
  members,
  t,
  onChange,
}: {
  form: ScheduleFormState;
  members: FamilyMember[];
  t: ReturnType<typeof useLanguage>["t"];
  onChange: (next: ScheduleFormState) => void;
}) {
  return (
    <>
      <label>
        <span className="label">{t("scheduleFormTitle")}</span>
        <input
          className="field"
          value={form.title}
          maxLength={60}
          onChange={(event) => onChange({ ...form, title: event.target.value })}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="label">{t("scheduleType")}</span>
          <select
            className="field"
            value={form.itemType}
            onChange={(event) =>
              onChange({
                ...form,
                itemType: event.target.value as ScheduleItemType,
              })
            }
          >
            <option value="schedule">{t("scheduleTypeSchedule")}</option>
            <option value="todo">{t("scheduleTypeTodo")}</option>
            <option value="reminder">{t("scheduleTypeReminder")}</option>
          </select>
        </label>
        <label>
          <span className="label">{t("scheduleVisibility")}</span>
          <select
            className="field"
            value={form.visibility}
            onChange={(event) =>
              onChange({
                ...form,
                visibility: event.target.value as ScheduleVisibility,
              })
            }
          >
            <option value="family">{t("scheduleVisibilityFamily")}</option>
            <option value="private">{t("scheduleVisibilityPrivate")}</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="label">{t("scheduleDate")}</span>
          <input
            className="field"
            type="date"
            value={form.date}
            onChange={(event) => onChange({ ...form, date: event.target.value })}
          />
        </label>
        <label>
          <span className="label">{t("scheduleTime")}</span>
          <input
            className="field"
            type="time"
            value={form.time}
            onChange={(event) => onChange({ ...form, time: event.target.value })}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="label">{t("scheduleEndDate")}</span>
          <input
            className="field"
            type="date"
            value={form.endDate}
            onChange={(event) =>
              onChange({ ...form, endDate: event.target.value })
            }
          />
        </label>
        <label>
          <span className="label">{t("scheduleEndTime")}</span>
          <input
            className="field"
            type="time"
            value={form.endTime}
            onChange={(event) =>
              onChange({ ...form, endTime: event.target.value })
            }
          />
        </label>
      </div>
      <label>
        <span className="label">{t("scheduleAssignee")}</span>
        <select
          className="field"
          value={form.assigneeMemberId}
          onChange={(event) =>
            onChange({ ...form, assigneeMemberId: event.target.value })
          }
        >
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.nickname}
            </option>
          ))}
        </select>
      </label>
      <ReminderOffsetChips
        value={form.reminderOffsets}
        t={t}
        onChange={(reminderOffsets) => onChange({ ...form, reminderOffsets })}
      />
      <label>
        <span className="label">{t("scheduleRepeat")}</span>
        <select
          className="field"
          value={form.recurrenceRule}
          onChange={(event) =>
            onChange({
              ...form,
              recurrenceRule: event.target.value as ScheduleRecurrenceRule,
            })
          }
        >
          <option value="none">{t("scheduleRepeatNone")}</option>
          <option value="daily">{t("scheduleRepeatDaily")}</option>
          <option value="weekly">{t("scheduleRepeatWeekly")}</option>
          <option value="monthly">{t("scheduleRepeatMonthly")}</option>
        </select>
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {t("scheduleRepeatEditHelp")}
        </span>
      </label>
      <label>
        <span className="label">{t("scheduleNote")}</span>
        <textarea
          className="field min-h-24 resize-none"
          value={form.note}
          maxLength={500}
          onChange={(event) => onChange({ ...form, note: event.target.value })}
        />
      </label>
    </>
  );
}

function ScopeSelect({
  label,
  value,
  t,
  description,
  onChange,
}: {
  label: string;
  value: ScheduleRecurrenceScope;
  t: ReturnType<typeof useLanguage>["t"];
  description?: string;
  onChange: (scope: ScheduleRecurrenceScope) => void;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <select
        className="field"
        value={value}
        onChange={(event) =>
          onChange(event.target.value as ScheduleRecurrenceScope)
        }
      >
        <option value="single">{t("scheduleScopeSingle")}</option>
        <option value="future">{t("scheduleScopeFuture")}</option>
        <option value="all">{t("scheduleScopeAll")}</option>
      </select>
      {description ? (
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {description}
        </span>
      ) : null}
    </label>
  );
}

function ReminderOffsetChips({
  value,
  t,
  onChange,
}: {
  value: ScheduleReminderOffset[];
  t: ReturnType<typeof useLanguage>["t"];
  onChange: (offsets: ScheduleReminderOffset[]) => void;
}) {
  function toggle(offset: ScheduleReminderOffset) {
    const next = value.includes(offset)
      ? value.filter((current) => current !== offset)
      : [...value, offset];
    onChange(next.sort((a, b) => a - b));
  }

  return (
    <div>
      <span className="label">{t("scheduleReminder")}</span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {REMINDER_OFFSETS.map((offset) => {
          const active = value.includes(offset);
          return (
            <button
              key={offset}
              type="button"
              className={
                active
                  ? "rounded-2xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm"
                  : "rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              }
              onClick={() => toggle(offset)}
            >
              {reminderOffsetLabel(offset, t)}
            </button>
          );
        })}
      </div>
      {value.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">
          {t("scheduleReminderNone")}
        </p>
      ) : null}
    </div>
  );
}

function DetailPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex max-w-full min-w-0 items-center rounded-full bg-slate-50 px-3 py-1.5 ring-1 ring-slate-100">
      <span className="mr-1 shrink-0 text-xs text-slate-500">{label}</span>
      <span className="min-w-0 truncate text-xs font-semibold text-slate-900">
        {value}
      </span>
    </div>
  );
}

function ReminderDeliveryCard({
  delivery,
  t,
  language,
  compact = false,
  canSnooze = false,
  busy,
  onSnooze,
}: {
  delivery: ScheduleReminderStatus["current_member_delivery"];
  t: ReturnType<typeof useLanguage>["t"];
  language: ReturnType<typeof useLanguage>["language"];
  compact?: boolean;
  canSnooze?: boolean;
  busy?: string | null;
  onSnooze?: (deliveryId: string, minutes: 5 | 10 | 30) => void;
}) {
  if (!delivery) {
    return (
      <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
        {t("scheduleReminderStatusPending")}
      </div>
    );
  }

  return (
    <div className={`rounded-2xl bg-slate-50 text-sm text-slate-700 ${compact ? "px-2.5 py-2" : "p-3"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className={`${compact ? "text-xs" : ""} truncate font-medium text-slate-900`}>
            {compact ? delivery.nickname : t("commonMe")}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-400">
            {reminderKindLabel(delivery.reminder_kind, t)} ·{" "}
            {formatDate(delivery.scheduled_for, language)}{" "}
            {formatTime(delivery.scheduled_for, language)}
          </div>
        </div>
        <span className={reminderDeliveryBadgeClass(delivery.status)}>
          {reminderDeliveryLabel(delivery.status, t)}
        </span>
      </div>
      {delivery.delivered_at ? (
        <div className="mt-2 text-xs text-slate-500">
          {t("scheduleReminderSentAt")}:{" "}
          {formatDate(delivery.delivered_at, language)}{" "}
          {formatTime(delivery.delivered_at, language)}
        </div>
      ) : null}
      {delivery.status === "failed" ? (
        <div className="mt-2 text-xs text-rose-600">
          {t("scheduleReminderRetrying")}
        </div>
      ) : null}
      {!compact &&
      canSnooze &&
      (delivery.status === "pending" || delivery.status === "failed") &&
      onSnooze ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[5, 10, 30].map((minutes) => (
            <button
              key={minutes}
              type="button"
              className="rounded-xl bg-white px-2 py-2 text-xs font-semibold text-brand-600 ring-1 ring-brand-100"
              disabled={busy?.startsWith(`snooze:${delivery.id}:`)}
              onClick={() => onSnooze(delivery.id, minutes as 5 | 10 | 30)}
            >
              {minutes === 5
                ? t("scheduleReminderSnooze5")
                : minutes === 10
                  ? t("scheduleReminderSnooze10")
                  : t("scheduleReminderSnooze30")}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ScheduleRangeControl({
  viewMode,
  selectedDate,
  t,
  language,
  onViewModeChange,
  onPrevious,
  onNext,
  onToday,
}: {
  viewMode: ScheduleViewMode;
  selectedDate: Date;
  t: ReturnType<typeof useLanguage>["t"];
  language: ReturnType<typeof useLanguage>["language"];
  onViewModeChange: (mode: ScheduleViewMode) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const includesToday = rangeContainsToday(viewMode, selectedDate);
  const holiday = viewMode !== "month" ? getJapanHoliday(selectedDate) : null;

  return (
    <section className="mb-3 rounded-[22px] bg-white/95 p-2.5 shadow-sm ring-1 ring-slate-100">
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100/80 p-1">
        {VIEW_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={`h-9 rounded-xl text-sm font-semibold transition ${
              viewMode === mode
                ? "bg-white text-brand-700 shadow-sm ring-1 ring-white/80"
                : "text-slate-600 hover:bg-white/70"
            }`}
            onClick={() => onViewModeChange(mode)}
          >
            {viewModeLabel(mode, t)}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="native-press flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-lg font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          aria-label={t("schedulePrevious")}
          onClick={onPrevious}
        >
          ‹
        </button>
        <button
          type="button"
          className="native-press flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-2xl bg-gradient-to-r from-slate-50 to-white px-3 py-2 text-left ring-1 ring-slate-200 transition hover:from-white hover:to-brand-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          onClick={onToday}
        >
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">
            {rangeTitle(viewMode, selectedDate, language)}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {includesToday ? (
              <span className="inline-flex min-h-6 items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-bold text-brand-700 ring-1 ring-brand-100">
                {t("scheduleTodayButton")}
              </span>
            ) : null}
            {holiday ? <HolidayChip holiday={holiday} compact /> : null}
          </span>
        </button>
        <button
          type="button"
          className="native-press flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-lg font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          aria-label={t("scheduleNext")}
          onClick={onNext}
        >
          ›
        </button>
      </div>
    </section>
  );
}

function ScheduleFilters({
  docked = false,
  searchText,
  assigneeFilter,
  typeFilter,
  visibilityFilter,
  members,
  hasActiveFilters,
  open,
  t,
  onSearchTextChange,
  onAssigneeFilterChange,
  onTypeFilterChange,
  onVisibilityFilterChange,
  onToggleOpen,
  onClear,
}: {
  docked?: boolean;
  searchText: string;
  assigneeFilter: ScheduleAssigneeFilter;
  typeFilter: ScheduleTypeFilter;
  visibilityFilter: ScheduleVisibilityFilter;
  members: FamilyMember[];
  hasActiveFilters: boolean;
  open: boolean;
  t: ReturnType<typeof useLanguage>["t"];
  onSearchTextChange: (value: string) => void;
  onAssigneeFilterChange: (value: ScheduleAssigneeFilter) => void;
  onTypeFilterChange: (value: ScheduleTypeFilter) => void;
  onVisibilityFilterChange: (value: ScheduleVisibilityFilter) => void;
  onToggleOpen: () => void;
  onClear: () => void;
}) {
  const filterFields = (
    <div
      className={`grid grid-cols-1 gap-2 sm:grid-cols-3 ${
        docked ? "mb-2" : "mt-2"
      }`}
    >
      <label>
        <span className="sr-only">{t("scheduleAssignee")}</span>
        <select
          className="field h-10 rounded-xl"
          value={assigneeFilter}
          onChange={(event) =>
            onAssigneeFilterChange(
              event.target.value as ScheduleAssigneeFilter,
            )
          }
        >
          <option value="all">{t("scheduleAllAssignees")}</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.nickname}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">{t("scheduleType")}</span>
        <select
          className="field h-10 rounded-xl"
          value={typeFilter}
          onChange={(event) =>
            onTypeFilterChange(event.target.value as ScheduleTypeFilter)
          }
        >
          {TYPE_FILTERS.map((value) => (
            <option key={value} value={value}>
              {typeFilterLabel(value, t)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">{t("scheduleVisibility")}</span>
        <select
          className="field h-10 rounded-xl"
          value={visibilityFilter}
          onChange={(event) =>
            onVisibilityFilterChange(
              event.target.value as ScheduleVisibilityFilter,
            )
          }
        >
          {VISIBILITY_FILTERS.map((value) => (
            <option key={value} value={value}>
              {visibilityFilterLabel(value, t)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
  const activeFilterNotice = hasActiveFilters ? (
    <div
      className={`flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 ${
        docked ? "mb-2" : "mt-2"
      }`}
    >
      <span className="truncate text-xs font-medium text-slate-500">
        {t("scheduleFiltersActive")}
      </span>
      <button
        type="button"
        className="shrink-0 text-sm font-semibold text-brand-600"
        onClick={onClear}
      >
        {t("scheduleClearFilters")}
      </button>
    </div>
  ) : null;

  return (
    <section
      className={
        docked
          ? "schedule-filter-panel"
          : "mb-3 rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-slate-100"
      }
    >
      {docked ? activeFilterNotice : null}
      {docked && open ? filterFields : null}
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("scheduleSearch")}</span>
          <input
            className={`field rounded-xl ${docked ? "h-11" : "h-10"}`}
            value={searchText}
            maxLength={40}
            placeholder={t("scheduleSearchPlaceholder")}
            onChange={(event) => onSearchTextChange(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={`${docked ? "h-11 rounded-[16px]" : "h-10 rounded-xl"} shrink-0 px-3 text-sm font-semibold transition ${
            open || hasActiveFilters
              ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100"
              : "bg-slate-50 text-slate-700 ring-1 ring-slate-200"
          }`}
          onClick={onToggleOpen}
          aria-expanded={open}
        >
          {hasActiveFilters ? t("scheduleFiltersActive") : t("scheduleFilters")}
        </button>
      </div>
      {!docked && open ? filterFields : null}
      {!docked ? activeFilterNotice : null}
    </section>
  );
}

function HolidayChip({
  holiday,
  compact = false,
}: {
  holiday: JapanHoliday;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center rounded-full bg-rose-50 font-semibold text-rose-700 ring-1 ring-rose-100 ${
        compact ? "px-2 py-0.5 text-[11px]" : "mt-1 px-2 py-0.5 text-[11px]"
      }`}
      title={holiday.name}
    >
      <span className="mr-1 rounded-full bg-rose-100 px-1 text-[10px] leading-4">
        休
      </span>
      <span className="max-w-[7rem] truncate">{holiday.name}</span>
    </span>
  );
}

function MyTodaySection({
  items,
  t,
  language,
  onSelectToday,
  onOpen,
}: {
  items: ScheduleItem[];
  t: ReturnType<typeof useLanguage>["t"];
  language: ReturnType<typeof useLanguage>["language"];
  onSelectToday: () => void;
  onOpen: (itemId: string) => void;
}) {
  const preview = items.slice(0, 2);
  const extraCount = Math.max(0, items.length - preview.length);

  return (
    <section className="mb-3 rounded-2xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            {t("scheduleMyToday")}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("schedulePendingCount", { count: items.length })}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700"
          onClick={onSelectToday}
        >
          {t("scheduleTodayButton")}
        </button>
      </div>
      {preview.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{t("scheduleMyTodayEmpty")}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {preview.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2 text-left text-sm text-slate-700"
              onClick={() => onOpen(item.id)}
            >
              <span className="shrink-0 font-semibold text-brand-600">
                {formatTime(item.starts_at, language)}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {item.visibility === "private" ? <LockBadge /> : null}
            </button>
          ))}
          {extraCount > 0 ? (
            <p className="px-1 text-xs text-slate-500">
              {t("scheduleMoreItems", { count: extraCount })}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ScheduleEmptyState({
  hasActiveFilters,
  t,
  onQuickAdd,
}: {
  hasActiveFilters: boolean;
  t: ReturnType<typeof useLanguage>["t"];
  onQuickAdd: () => void;
}) {
  return (
    <div className="rounded-2xl bg-white px-5 py-8 text-center shadow-sm ring-1 ring-slate-100">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-2xl">
        {hasActiveFilters ? "⌕" : "+"}
      </div>
      <h2 className="mt-3 text-base font-semibold text-slate-900">
        {hasActiveFilters
          ? t("scheduleSearchEmptyTitle")
          : t("scheduleNoPlanTitle")}
      </h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">
        {hasActiveFilters
          ? t("scheduleSearchEmptyDescription")
          : t("scheduleNoPlanDescription")}
      </p>
      {!hasActiveFilters ? (
        <button
          type="button"
          className="btn-primary mt-4"
          onClick={onQuickAdd}
        >
          {t("scheduleNewForDay")}
        </button>
      ) : null}
    </div>
  );
}

function DayView({
  items,
  session,
  busy,
  hasActiveFilters,
  t,
  language,
  onOpen,
  onQuickAdd,
  onToggle,
  onDelete,
}: {
  items: ScheduleItem[];
  session: LocalSession;
  busy: string | null;
  hasActiveFilters: boolean;
  t: ReturnType<typeof useLanguage>["t"];
  language: ReturnType<typeof useLanguage>["language"];
  onOpen: (itemId: string) => void;
  onQuickAdd: () => void;
  onToggle: (item: ScheduleItem) => void;
  onDelete: (item: ScheduleItem) => void;
}) {
  if (items.length === 0) {
    return (
      <ScheduleEmptyState
        hasActiveFilters={hasActiveFilters}
        t={t}
        onQuickAdd={onQuickAdd}
      />
    );
  }

  return (
    <div className="relative flex flex-col gap-3 before:absolute before:left-[31px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-slate-200">
      {items.map((item) => (
        <ScheduleCard
          key={item.id}
          item={item}
          session={session}
          busy={busy === item.id}
          t={t}
          language={language}
          onOpen={() => onOpen(item.id)}
          onToggle={() => onToggle(item)}
          onDelete={() => onDelete(item)}
        />
      ))}
    </div>
  );
}

function WeekView({
  groupedItems,
  visibleDays,
  session,
  busy,
  t,
  language,
  onOpen,
  onToggle,
  onDelete,
}: {
  groupedItems: Map<string, ScheduleItem[]>;
  visibleDays: Date[];
  session: LocalSession;
  busy: string | null;
  t: ReturnType<typeof useLanguage>["t"];
  language: ReturnType<typeof useLanguage>["language"];
  onOpen: (itemId: string) => void;
  onToggle: (item: ScheduleItem) => void;
  onDelete: (item: ScheduleItem) => void;
}) {
  return (
    <>
      {visibleDays.map((day) => {
        const dayItems = groupedItems.get(toDateKey(day)) ?? [];
        const holiday = getJapanHoliday(day);
        return (
          <section key={toDateKey(day)} className="flex flex-col gap-2">
            <h2 className="flex min-w-0 items-center gap-2 px-1 text-sm font-semibold text-slate-600">
              <span className="truncate">{formatWeekDayTitle(day, language)}</span>
              {holiday ? <HolidayChip holiday={holiday} compact /> : null}
            </h2>
            {dayItems.length === 0 ? (
              <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-400 ring-1 ring-slate-100">
                {t("scheduleDayEmpty")}
              </div>
            ) : (
              dayItems.map((item) => (
                <ScheduleCard
                  key={item.id}
                  item={item}
                  session={session}
                  busy={busy === item.id}
                  t={t}
                  language={language}
                  onOpen={() => onOpen(item.id)}
                  onToggle={() => onToggle(item)}
                  onDelete={() => onDelete(item)}
                />
              ))
            )}
          </section>
        );
      })}
    </>
  );
}

type ScheduleTone = "schedule" | "todo" | "reminder" | "private" | "done";

interface ScheduleToneClasses {
  accent: string;
  badge: string;
  cardRing: string;
  dot: string;
  monthChip: string;
  time: string;
}

function scheduleItemTone(item: ScheduleItem): ScheduleTone {
  if (item.status === "done") return "done";
  if (item.visibility === "private") return "private";
  return item.item_type;
}

function scheduleToneClasses(item: ScheduleItem): ScheduleToneClasses {
  switch (scheduleItemTone(item)) {
    case "todo":
      return {
        accent: "bg-violet-500",
        badge: "bg-violet-50 text-violet-700 ring-violet-100",
        cardRing: "ring-slate-100 hover:ring-violet-100",
        dot: "bg-violet-500",
        monthChip: "bg-violet-500 text-white ring-violet-200",
        time: "text-violet-700",
      };
    case "reminder":
      return {
        accent: "bg-amber-400",
        badge: "bg-amber-50 text-amber-700 ring-amber-100",
        cardRing: "ring-slate-100 hover:ring-amber-100",
        dot: "bg-amber-400",
        monthChip: "bg-amber-300 text-amber-950 ring-amber-200",
        time: "text-amber-700",
      };
    case "private":
      return {
        accent: "bg-fuchsia-500",
        badge: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100",
        cardRing: "ring-slate-100 hover:ring-fuchsia-100",
        dot: "bg-fuchsia-500",
        monthChip: "bg-fuchsia-500 text-white ring-fuchsia-200",
        time: "text-fuchsia-700",
      };
    case "done":
      return {
        accent: "bg-slate-300",
        badge: "bg-slate-100 text-slate-500 ring-slate-200",
        cardRing: "ring-slate-100",
        dot: "bg-slate-300",
        monthChip: "bg-slate-200 text-slate-500 ring-slate-200 line-through",
        time: "text-slate-500",
      };
    default:
      return {
        accent: "bg-cyan-500",
        badge: "bg-cyan-50 text-cyan-700 ring-cyan-100",
        cardRing: "ring-slate-100 hover:ring-cyan-100",
        dot: "bg-cyan-500",
        monthChip: "bg-cyan-500 text-white ring-cyan-200",
        time: "text-cyan-700",
      };
  }
}

function dayNumberClass({
  day,
  isHoliday,
  isToday,
  isSelected,
  isCurrentMonth,
}: {
  day: Date;
  isHoliday: boolean;
  isToday: boolean;
  isSelected: boolean;
  isCurrentMonth: boolean;
}): string {
  const base =
    "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 text-[11px] font-bold leading-5";
  if (isSelected) return `${base} bg-brand-500 text-white`;
  if (isToday) return `${base} bg-amber-100 text-amber-700 ring-1 ring-amber-200`;
  if (!isCurrentMonth) return `${base} text-slate-300`;
  if (isHoliday) return `${base} bg-rose-50 text-rose-600 ring-1 ring-rose-100`;
  if (day.getDay() === 0) return `${base} text-rose-500`;
  if (day.getDay() === 6) return `${base} text-blue-500`;
  return `${base} text-slate-700`;
}

function MonthView({
  groupedItems,
  visibleDays,
  selectedDate,
  t,
  language,
  onSelectDay,
  onOpen,
}: {
  groupedItems: Map<string, ScheduleItem[]>;
  visibleDays: Date[];
  selectedDate: Date;
  t: ReturnType<typeof useLanguage>["t"];
  language: ReturnType<typeof useLanguage>["language"];
  onSelectDay: (date: Date) => void;
  onOpen: (itemId: string) => void;
}) {
  const todayKey = toDateKey(new Date());
  const selectedKey = toDateKey(selectedDate);
  const selectedMonth = selectedDate.getMonth();
  const weekDayLabels = weekDaysForLocale(language);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 bg-slate-50/80">
        {weekDayLabels.map((label, index) => (
          <div
            key={label}
            className={`border-b border-slate-200 px-1 py-1.5 text-center text-[11px] font-semibold ${
              index === 0
                ? "text-rose-500"
                : index === 6
                  ? "text-blue-500"
                  : "text-slate-400"
            } ${index === 6 ? "" : "border-r border-slate-200"}`}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {visibleDays.map((day, index) => {
          const key = toDateKey(day);
          const dayItems = groupedItems.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const holiday = getJapanHoliday(day);
          const isCurrentMonth = day.getMonth() === selectedMonth;
          const isLastColumn = index % 7 === 6;
          const isLastRow = index >= visibleDays.length - 7;
          const visibleItems = dayItems.slice(0, 3);
          const extraCount = Math.max(0, dayItems.length - visibleItems.length);

          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              aria-label={`${formatDate(day.toISOString(), language)} ${t("scheduleItemCount", {
                count: dayItems.length,
              })}`}
              className={`min-w-0 cursor-pointer p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 ${
                isLastColumn ? "" : "border-r border-slate-100"
              } ${isLastRow ? "" : "border-b border-slate-100"} ${
                isSelected
                  ? "bg-brand-50/80 ring-1 ring-inset ring-brand-200"
                  : isToday
                    ? "bg-amber-50/70"
                    : holiday && isCurrentMonth
                      ? "bg-rose-50/60 hover:bg-rose-50"
                    : isCurrentMonth
                      ? "bg-white hover:bg-slate-50"
                      : "bg-slate-50/70 text-slate-300"
              }`}
              onClick={() => onSelectDay(day)}
              onKeyDown={(event) => {
                if (event.currentTarget !== event.target) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectDay(day);
                }
              }}
            >
              <div className="flex min-h-[82px] min-w-0 flex-col sm:min-h-[106px]">
                <div className="flex items-start justify-between gap-1">
                  <span
                    className={dayNumberClass({
                      day,
                      isToday,
                      isHoliday: Boolean(holiday),
                      isSelected,
                      isCurrentMonth,
                    })}
                  >
                    {day.getDate()}
                  </span>
                  {holiday && isCurrentMonth ? (
                    <span
                      className="max-w-[3.5rem] truncate rounded-[4px] bg-rose-100 px-1 text-[9px] font-semibold leading-4 text-rose-700"
                      title={holiday.name}
                    >
                      {holiday.shortName}
                    </span>
                  ) : isToday ? (
                    <span className="hidden rounded-[4px] bg-amber-100 px-1 text-[9px] font-semibold leading-4 text-amber-700 min-[420px]:inline">
                      {t("scheduleTodayButton")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                  {visibleItems.map((item) => (
                    <ScheduleMonthChip
                      key={item.id}
                      item={item}
                      onOpen={() => onOpen(item.id)}
                    />
                  ))}
                  {extraCount > 0 ? (
                    <span className="min-w-0 truncate rounded-[4px] bg-slate-100 px-1 text-[9px] font-semibold leading-4 text-slate-500 sm:text-[10px] sm:leading-5">
                      {t("scheduleMoreItems", { count: extraCount })}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ScheduleMonthChip({
  item,
  onOpen,
}: {
  item: ScheduleItem;
  onOpen: () => void;
}) {
  const tone = scheduleToneClasses(item);
  return (
    <button
      type="button"
      title={item.title}
      className={`flex h-4 min-w-0 items-center gap-0.5 rounded-[4px] px-1 text-left text-[9px] font-semibold leading-none ring-1 transition hover:brightness-95 sm:h-5 sm:text-[10px] ${tone.monthChip}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {item.visibility === "private" ? <MiniLockBadge /> : null}
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
    </button>
  );
}

function MiniLockBadge() {
  return (
    <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-white/80 text-violet-700">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-2 w-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    </span>
  );
}

function LockBadge() {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-50 text-violet-600 ring-1 ring-violet-100">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    </span>
  );
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "textarea:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      (element.offsetWidth > 0 ||
        element.offsetHeight > 0 ||
        element === document.activeElement),
  );
}

function defaultFormState(session: LocalSession | null): ScheduleFormState {
  const now = new Date();
  now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
  return {
    title: "",
    note: "",
    itemType: "schedule",
    visibility: "family",
    date: toDateInput(now),
    time: toTimeInput(now),
    endDate: "",
    endTime: "",
    assigneeMemberId: session?.member_id ?? "",
    reminderOffsets: [0],
    recurrenceRule: "none",
  };
}

function defaultFormStateForDate(
  session: LocalSession,
  date: Date,
): ScheduleFormState {
  const target = startOfDay(date);
  const today = startOfDay(new Date());
  const start = new Date(target);
  if (target.getTime() === today.getTime()) {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    start.setHours(now.getHours(), now.getMinutes(), 0, 0);
  } else {
    start.setHours(9, 0, 0, 0);
  }

  return {
    ...defaultFormState(session),
    date: toDateInput(start),
    time: toTimeInput(start),
    assigneeMemberId: session.member_id,
  };
}

function formStateFromItem(
  item: ScheduleItem,
  reminderStatus?: ScheduleReminderStatus | null,
): ScheduleFormState {
  const startsAt = new Date(item.starts_at);
  const endsAt = item.ends_at ? new Date(item.ends_at) : null;
  return {
    title: item.title,
    note: item.note ?? "",
    itemType: item.item_type,
    visibility: item.visibility,
    date: toDateInput(startsAt),
    time: toTimeInput(startsAt),
    endDate: endsAt ? toDateInput(endsAt) : "",
    endTime: endsAt ? toTimeInput(endsAt) : "",
    assigneeMemberId: item.assignee_member_id,
    reminderOffsets:
      reminderStatus?.rules && reminderStatus.rules.length > 0
        ? reminderStatus.rules
        : reminderOffsetsFromItem(item),
    recurrenceRule: item.recurrence_rule ?? "none",
  };
}

function reminderOffsetsFromItem(item: ScheduleItem): ScheduleReminderOffset[] {
  if (!item.remind_at) return [];
  const starts = new Date(item.starts_at).getTime();
  const remind = new Date(item.remind_at).getTime();
  const diffMinutes = Math.round((starts - remind) / 60_000);
  if (diffMinutes === 0) return [0];
  if (diffMinutes === 10) return [10];
  if (diffMinutes === 30) return [30];
  if (diffMinutes === 60) return [60];
  if (diffMinutes === 1440) return [1440];
  return [0];
}

function typeFilterLabel(
  value: ScheduleTypeFilter,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  if (value === "all") return t("scheduleAllTypes");
  return itemTypeLabel(value, t);
}

function visibilityFilterLabel(
  value: ScheduleVisibilityFilter,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  if (value === "all") return t("scheduleAllVisibility");
  if (value === "private") return t("scheduleVisibilityPrivate");
  return t("scheduleVisibilityFamily");
}

function assigneeResponseLabel(
  value: string,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  if (value === "accepted") return t("scheduleResponseAccepted");
  if (value === "declined") return t("scheduleResponseDeclined");
  return t("scheduleResponsePending");
}

function isScheduleTimelineSystemEvent(event: ScheduleContextEvent): boolean {
  return !["text", "audio", "location"].includes(event.event_type);
}

function scheduleTimelineFallback(
  event: ScheduleContextEvent,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  switch (event.event_type) {
    case "audio":
      return t("chatAudioMessage");
    case "location":
      return t("messageLocationShared");
    case "created":
      return t("scheduleTimelineCreated");
    case "assigned":
      return t("scheduleTimelineAssigned");
    case "accepted":
      return t("scheduleTimelineAccepted");
    case "declined":
      return t("scheduleTimelineDeclined");
    case "completed":
      return t("scheduleTimelineCompleted");
    case "restored":
      return t("scheduleTimelineRestored");
    case "deleted":
      return t("scheduleTimelineDeleted");
    case "reminder_updated":
      return t("scheduleTimelineReminderUpdated");
    case "updated":
      return t("scheduleTimelineUpdated");
    default:
      return t("scheduleTimelineSystem");
  }
}

function responseBadgeClass(value: string): string {
  if (value === "accepted") {
    return "rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100";
  }
  if (value === "declined") {
    return "rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-100";
  }
  return "rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-100";
}

function reminderDeliveryLabel(
  value: string,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  if (value === "sent") return t("scheduleReminderStatusSent");
  if (value === "skipped") return t("scheduleReminderStatusSkipped");
  if (value === "failed") return t("scheduleReminderStatusFailed");
  if (value === "gone") return t("scheduleReminderStatusGone");
  return t("scheduleReminderStatusPending");
}

function reminderOffsetLabel(
  offset: ScheduleReminderOffset,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  if (offset === 0) return t("scheduleReminderAtTime");
  if (offset === 10) return t("scheduleReminderBefore10");
  if (offset === 30) return t("scheduleReminderBefore30");
  if (offset === 60) return t("scheduleReminderBefore60");
  return t("scheduleReminderBefore1440");
}

function reminderKindLabel(
  value: string,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  if (value === "snooze") return t("scheduleReminderKindSnooze");
  if (value === "overdue") return t("scheduleReminderKindOverdue");
  return t("scheduleReminderKindBeforeStart");
}

function reminderDeliveryBadgeClass(value: string): string {
  if (value === "sent") {
    return "rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100";
  }
  if (value === "failed" || value === "gone") {
    return "rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-100";
  }
  if (value === "skipped") {
    return "rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200";
  }
  return "rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-100";
}

function itemTypeLabel(
  type: ScheduleItemType,
  t: ReturnType<typeof useLanguage>["t"],
) {
  switch (type) {
    case "todo":
      return t("scheduleTypeTodo");
    case "reminder":
      return t("scheduleTypeReminder");
    default:
      return t("scheduleTypeSchedule");
  }
}

function parseViewMode(value: string | null): ScheduleViewMode {
  if (value === "day" || value === "week" || value === "month") return value;
  return "month";
}

function parseTypeFilter(value: string | null): ScheduleTypeFilter {
  return value === "schedule" || value === "todo" || value === "reminder"
    ? value
    : "all";
}

function parseVisibilityFilter(value: string | null): ScheduleVisibilityFilter {
  return value === "family" || value === "private" ? value : "all";
}

function parseAssigneeFilter(value: string | null): ScheduleAssigneeFilter {
  if (!value || value === "all") return "all";
  return isUuid(value) ? value : "all";
}

function parseDateParam(value: string | null): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return startOfDay(new Date());
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return startOfDay(new Date());
  return startOfDay(parsed);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function viewModeLabel(
  mode: ScheduleViewMode,
  t: ReturnType<typeof useLanguage>["t"],
) {
  switch (mode) {
    case "week":
      return t("scheduleViewWeek");
    case "month":
      return t("scheduleViewMonth");
    default:
      return t("scheduleViewDay");
  }
}

function recurrenceLabel(
  rule: ScheduleRecurrenceRule,
  t: ReturnType<typeof useLanguage>["t"],
) {
  switch (rule) {
    case "daily":
      return t("scheduleRepeatDaily");
    case "weekly":
      return t("scheduleRepeatWeekly");
    case "monthly":
      return t("scheduleRepeatMonthly");
    default:
      return t("scheduleRepeatNone");
  }
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfWeek(date: Date): Date {
  const copy = startOfDay(date);
  const day = copy.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(copy, mondayOffset);
}

function startOfCalendarWeek(date: Date): Date {
  const copy = startOfDay(date);
  return addDays(copy, -copy.getDay());
}

function startOfMonth(date: Date): Date {
  const copy = startOfDay(date);
  copy.setDate(1);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function getRange(
  mode: ScheduleViewMode,
  selectedDate: Date,
): { start: Date; end: Date } {
  if (mode === "week") {
    const start = startOfWeek(selectedDate);
    return { start, end: addDays(start, 7) };
  }
  if (mode === "month") {
    const start = startOfMonth(selectedDate);
    return { start, end: addMonths(start, 1) };
  }
  const start = startOfDay(selectedDate);
  return { start, end: addDays(start, 1) };
}

function rangeContainsToday(
  mode: ScheduleViewMode,
  selectedDate: Date,
): boolean {
  const today = startOfDay(new Date()).getTime();
  const range = getRange(mode, selectedDate);
  return today >= range.start.getTime() && today < range.end.getTime();
}

function daysForView(mode: ScheduleViewMode, selectedDate: Date): Date[] {
  const range = getRange(mode, selectedDate);
  const days: Date[] = [];
  for (let day = range.start; day < range.end; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

function calendarDaysForMonth(selectedDate: Date): Date[] {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = addMonths(monthStart, 1);
  const gridStart = startOfCalendarWeek(monthStart);
  const endWeekStart = startOfCalendarWeek(addDays(monthEnd, -1));
  const gridEnd = addDays(endWeekStart, 7);
  const days: Date[] = [];
  for (let day = gridStart; day < gridEnd; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

function shiftDateForView(
  date: Date,
  mode: ScheduleViewMode,
  amount: number,
): Date {
  if (mode === "week") return addDays(date, amount * 7);
  if (mode === "month") return addMonths(date, amount);
  return addDays(date, amount);
}

function groupItemsByDay(items: ScheduleItem[]): Map<string, ScheduleItem[]> {
  const grouped = new Map<string, ScheduleItem[]>();
  for (const item of items) {
    const key = toDateKey(new Date(item.starts_at));
    const rows = grouped.get(key) ?? [];
    rows.push(item);
    grouped.set(key, rows);
  }
  return grouped;
}

function toDateKey(date: Date): string {
  return toDateInput(date);
}

function rangeTitle(
  mode: ScheduleViewMode,
  selectedDate: Date,
  language: string,
): string {
  if (mode === "week") {
    const start = startOfWeek(selectedDate);
    const end = addDays(start, 6);
    return `${formatDate(start.toISOString(), language)} - ${formatDate(
      end.toISOString(),
      language,
    )}`;
  }
  if (mode === "month") {
    return new Intl.DateTimeFormat(localeFor(language), {
      year: "numeric",
      month: "2-digit",
    }).format(selectedDate);
  }
  return new Intl.DateTimeFormat(localeFor(language), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(selectedDate);
}

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toTimeInput(date: Date): string {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function localDateTimeToIso(date: string, time: string): string {
  if (!date || !time) throw new Error("invalid_schedule_time");
  const parsed = new Date(`${date}T${time}:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("invalid_schedule_time");
  return parsed.toISOString();
}

function reminderToIso(
  offsets: ScheduleReminderOffset[],
  startsAtIso: string,
): string | null {
  if (offsets.length === 0) return null;
  const date = new Date(startsAtIso);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_schedule_time");
  const maxOffset = Math.max(...offsets);
  date.setMinutes(date.getMinutes() - maxOffset);
  return date.toISOString();
}

function formatTime(value: string, language: string): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

function formatWeekDayTitle(date: Date, language: string): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function weekDaysForLocale(language: string): string[] {
  const sunday = new Date("2026-05-17T00:00:00");
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(localeFor(language), {
      weekday: "short",
    }).format(addDays(sunday, index)),
  );
}

function localeFor(language: string): string {
  if (language === "ja") return "ja-JP";
  if (language === "en") return "en-US";
  return "zh-CN";
}
