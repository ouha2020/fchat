"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { loadSession } from "@/lib/authLocal";
import { captureMessageCacheContext, watchMessageContext } from "@/lib/messageCacheLifecycle";

const MEMBER_ROUTES = new Set(["chat", "schedule", "album", "image-preview", "members", "me", "settings", "admin"]);

/** Retire mounted private content on a same-tab or cross-tab identity change. */
export default function MemberSessionBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <SessionBoundary key={pathname} protectedRoute={MEMBER_ROUTES.has(pathname.split("/")[1])}>
    {children}
  </SessionBoundary>;
}

function SessionBoundary({ children, protectedRoute }: { children: ReactNode; protectedRoute: boolean }) {
  const router = useRouter();
  const [retired, setRetired] = useState(false);
  useEffect(() => {
    if (!protectedRoute) return;
    const session = loadSession();
    if (!session) return;
    return watchMessageContext(captureMessageCacheContext(session), () => {
      setRetired(true);
      router.replace("/");
    });
  }, [protectedRoute, router]);
  return retired ? null : children;
}
