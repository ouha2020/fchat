"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { loadSession } from "@/lib/authLocal";
import { updatePushPresence } from "@/lib/pushNotificationService";

const HEARTBEAT_MS = 30_000;

export default function AppPresenceTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const currentPage = pageName(pathname);

    const syncPresence = (isActive: boolean, keepalive = false) => {
      const session = loadSession();
      if (!session) return;
      updatePushPresence(session, isActive, keepalive, currentPage);
    };

    syncPresence(document.visibilityState === "visible");
    const heartbeat = window.setInterval(() => {
      syncPresence(document.visibilityState === "visible");
    }, HEARTBEAT_MS);

    const handleVisibility = () => {
      syncPresence(document.visibilityState === "visible", true);
    };
    const markInactive = () => syncPresence(false, true);

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", markInactive);
    window.addEventListener("beforeunload", markInactive);

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", markInactive);
      window.removeEventListener("beforeunload", markInactive);
      markInactive();
    };
  }, [pathname]);

  return null;
}

function pageName(pathname: string | null): string {
  if (!pathname || pathname === "/") return "home";
  const firstSegment = pathname.split("/").filter(Boolean)[0];
  return firstSegment ?? "app";
}
