"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener(
      "load",
      () => {
        navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      },
      { once: true },
    );
  }, []);

  return null;
}
