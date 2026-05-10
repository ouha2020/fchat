"use client";

import { useEffect } from "react";

const SW_REFRESH_KEY = "family-chat:sw-refreshed-v4";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let refreshing = false;
    const handleControllerChange = () => {
      if (refreshing) return;
      if (window.sessionStorage.getItem(SW_REFRESH_KEY) === "1") {
        return;
      }
      refreshing = true;
      window.sessionStorage.setItem(SW_REFRESH_KEY, "1");
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

    window.addEventListener(
      "load",
      () => {
        navigator.serviceWorker
          .register("/sw.js", { updateViaCache: "none" })
          .then((registration) => registration.update())
          .catch(() => undefined);
      },
      { once: true },
    );

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
    };
  }, []);

  return null;
}
