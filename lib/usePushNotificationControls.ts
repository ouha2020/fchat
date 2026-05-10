"use client";

import { useCallback, useEffect, useState } from "react";

import type { LocalSession } from "@/lib/authLocal";
import {
  DEFAULT_PUSH_PREFERENCES,
  getCurrentPushSubscription,
  getPushPreferences,
  getPushSupportState,
  savePushPreferences,
  subscribeToPush,
  unsubscribePush,
  type PushPreferences,
  type PushSupportState,
} from "@/lib/pushNotificationService";

export function usePushNotificationControls(session: LocalSession | null) {
  const [support, setSupport] = useState<PushSupportState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [preferences, setPreferences] = useState<PushPreferences>(
    DEFAULT_PUSH_PREFERENCES,
  );
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) {
      setSupport(null);
      setEnabled(false);
      setPreferences(DEFAULT_PUSH_PREFERENCES);
      return;
    }

    setSupport(getPushSupportState());
    setPreferences(getPushPreferences(session));
    try {
      setEnabled(Boolean(await getCurrentPushSubscription()));
    } catch {
      setEnabled(false);
    }
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (cancelled) return;
      await refresh();
    }

    void run();

    const handleFocus = () => {
      void run();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      setSupport(getPushSupportState());
      await subscribeToPush(session, preferences);
      setEnabled(true);
      setSupport(getPushSupportState());
    } finally {
      setBusy(false);
    }
  }, [preferences, session]);

  const disable = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      await unsubscribePush(session);
      setEnabled(false);
      setSupport(getPushSupportState());
    } finally {
      setBusy(false);
    }
  }, [session]);

  const updatePreference = useCallback(
    async <K extends keyof PushPreferences>(
      key: K,
      value: PushPreferences[K],
    ) => {
      if (!session) return;
      const next = { ...preferences, [key]: value };
      setPreferences(next);
      savePushPreferences(session, next);

      if (!enabled) return;
      setBusy(true);
      try {
        await subscribeToPush(session, next);
        setEnabled(true);
      } finally {
        setBusy(false);
      }
    },
    [enabled, preferences, session],
  );

  return {
    support,
    enabled,
    preferences,
    busy,
    refresh,
    enable,
    disable,
    updatePreference,
  };
}
