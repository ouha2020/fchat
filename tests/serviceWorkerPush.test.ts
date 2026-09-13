import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

const serviceWorkerSource = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);

describe("service worker push delivery", () => {
  it("shows a notification even when an app window is visible", async () => {
    const worker = loadServiceWorker("visible");

    await worker.dispatchPush();

    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "family-chat:push-received",
        familyId: "family-1",
        messageId: "message-1",
      }),
    );
    expect(worker.showNotification).toHaveBeenCalledOnce();
  });

  it("shows a notification when no app window is visible", async () => {
    const worker = loadServiceWorker("hidden");

    await worker.dispatchPush();

    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.showNotification).toHaveBeenCalledOnce();
  });
});

function loadServiceWorker(visibilityState: "visible" | "hidden") {
  const listeners = new Map<string, (event: unknown) => void>();
  const postMessage = vi.fn();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const clients = {
    matchAll: vi.fn().mockResolvedValue([
      {
        visibilityState,
        url: "https://hometree.example/chat",
        postMessage,
      },
    ]),
    openWindow: vi.fn(),
  };
  const workerSelf = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    clients,
    location: { origin: "https://hometree.example" },
    registration: {
      showNotification,
      getNotifications: vi.fn().mockResolvedValue([]),
    },
    skipWaiting: vi.fn(),
  };

  runInNewContext(serviceWorkerSource, {
    self: workerSelf,
    clients,
    caches: {
      keys: vi.fn().mockResolvedValue([]),
      open: vi.fn(),
      delete: vi.fn(),
      match: vi.fn(),
    },
    AbortController,
    Request,
    Response,
    URL,
    fetch: vi.fn(),
    setTimeout,
    clearTimeout,
  });

  return {
    postMessage,
    showNotification,
    async dispatchPush() {
      const listener = listeners.get("push");
      if (!listener) throw new Error("push_listener_missing");

      let pending: Promise<unknown> | undefined;
      listener({
        data: {
          json: () => ({
            title: "HomeTree",
            body: "New message",
            type: "message",
            url: "/chat",
            familyId: "family-1",
            messageId: "message-1",
            tag: "family-chat:message-1",
          }),
        },
        waitUntil: (promise: Promise<unknown>) => {
          pending = promise;
        },
      });
      await pending;
    },
  };
}
