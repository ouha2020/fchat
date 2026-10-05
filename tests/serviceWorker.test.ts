import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Exercise the shipped worker, without registering it or sending an OS notification.
const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
function worker() {
  const origin = "https://family.test";
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const windows: Array<{ url: string; visibilityState: string; focus: ReturnType<typeof vi.fn>;
    navigate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }> = [];
  const notifications: Array<{ data: Record<string, unknown>; tag?: string; close: ReturnType<typeof vi.fn> }> = [];
  const clients = { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async (url: string) => url) };
  const registration = { showNotification: vi.fn(async () => undefined), getNotifications: vi.fn(async () => notifications) };
  runInNewContext(workerSource, { URL, Request, Response, AbortController, setTimeout, clearTimeout,
    clients, self: { location: { origin }, clients, registration,
      addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, handler) } });
  return {
    clients, registration, notifications,
    addWindow(path: string, visibilityState = "visible") {
      const client = { url: new URL(path, origin).href, visibilityState, focus: vi.fn(), navigate: vi.fn(), postMessage: vi.fn() };
      client.focus.mockImplementation(async () => client);
      client.navigate.mockImplementation(async (url: string) => { client.url = url; return client; });
      windows.push(client); return client;
    },
    async emit(name: string, values: Record<string, unknown>) {
      const promises: Promise<unknown>[] = [];
      handlers.get(name)!({ ...values, waitUntil: (pending: Promise<unknown>) => promises.push(pending) });
      await Promise.all(promises);
    },
  };
}

describe("shipped Service Worker notification paths", () => {
  it("navigates an existing chat to each different message and forwards only the safe signal", async () => {
    const app = worker(); const client = app.addWindow("/chat");
    for (const messageId of ["first-message", "second-message"]) {
      const close = vi.fn();
      await app.emit("notificationclick", { notification: { close, data: { url: "/chat", familyId: "fixture-family", messageId } } });
      expect(close).toHaveBeenCalledOnce();
      expect(client.url).toBe(`https://family.test/chat?mid=${messageId}`);
      expect(client.postMessage).toHaveBeenLastCalledWith({ type: "family-chat:push-received", familyId: "fixture-family", messageId, openedFromNotification: true });
    }
    expect(client.navigate).toHaveBeenCalledTimes(2);
    expect(client.focus).toHaveBeenCalledTimes(2);
    expect(app.clients.openWindow).not.toHaveBeenCalled();
  });

  it("opens a schedule reminder at the encoded item when no schedule window exists", async () => {
    const app = worker(); app.addWindow("/chat");
    await app.emit("notificationclick", { notification: { close: vi.fn(), data: { type: "schedule-reminder", scheduleItemId: "item / 1" } } });
    expect(app.clients.openWindow).toHaveBeenCalledWith("https://family.test/schedule?item=item%20%2F%201");
  });

  it("forwards the latest target even when an existing window cannot navigate", async () => {
    const app = worker(); const client = app.addWindow("/chat?mid=old");
    client.navigate.mockRejectedValue(new Error("offline"));
    await app.emit("notificationclick", { notification: { close: vi.fn(), data: { messageId: "latest", familyId: "fixture-family" } } });
    expect(client.focus).toHaveBeenCalledOnce();
    expect(client.postMessage).toHaveBeenCalledWith({ type: "family-chat:push-received", familyId: "fixture-family", messageId: "latest", openedFromNotification: true });
  });

  it("notifies only visible same-origin clients and strips payload extras from the client signal", async () => {
    const app = worker(); const visible = app.addWindow("/chat");
    const hidden = app.addWindow("/chat", "hidden"); const foreign = app.addWindow("https://other.test/chat");
    await app.emit("push", { data: { json: () => ({ title: "家庭聊天", body: "有新消息", familyId: "fixture-family", messageId: "fixture-message", ignored: "fixture-extra" }) } });
    expect(visible.postMessage).toHaveBeenCalledWith({ type: "family-chat:push-received", familyId: "fixture-family", messageId: "fixture-message" });
    expect(hidden.postMessage).not.toHaveBeenCalled(); expect(foreign.postMessage).not.toHaveBeenCalled();
    expect(app.registration.showNotification).toHaveBeenCalledOnce();
  });

  it("limits chat cleanup to the requested family and leaves schedule reminders intact", async () => {
    const app = worker();
    const chat = { data: { familyId: "A", messageId: "m" }, close: vi.fn() };
    const other = { data: { familyId: "B", messageId: "m" }, close: vi.fn() };
    const schedule = { data: { familyId: "A", type: "schedule-reminder", scheduleItemId: "i" }, close: vi.fn() };
    app.notifications.push(chat, other, schedule);
    await app.emit("message", { data: { type: "family-chat:close-notifications", familyId: "A", closeAllForFamily: true } });
    expect(chat.close).toHaveBeenCalledOnce(); expect(other.close).not.toHaveBeenCalled(); expect(schedule.close).not.toHaveBeenCalled();
  });
});
