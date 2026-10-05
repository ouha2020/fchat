import type { Page } from "@playwright/test";
import { test, expect, session, otherMemberId, testPng } from "./fixtures";
import { makeMessage } from "@/tests/helpers/messages";

async function loadHistory(page: Page, count: number) {
  const rows = page.locator("[data-message-id]"); await expect(rows).toHaveCount(100);
  for (let total = 200; total <= count; total += 100) {
    await page.locator("[data-chat-scroll]").evaluate((element) => {
      element.scrollTop = 0; element.dispatchEvent(new Event("scroll"));
    });
    await expect(rows).toHaveCount(total);
  }
}

async function cacheCounts(page: Page) {
  return page.evaluate(async (owner) => {
    // Observing cache state must never create an empty DB before the app's schema upgrade.
    if (!(await indexedDB.databases()).some((entry) => entry.name === "family-chat-cache")) {
      return { messages: 0, states: 0 };
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("family-chat-cache"); request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains("messages")) return { messages: 0, states: 0 };
      const transaction = database.transaction(["messages", "sync_state"], "readonly");
      const read = (store: string) => new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = transaction.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [messages, states] = await Promise.all([read("messages"), read("sync_state")]);
      return { messages: messages.filter((row) => row.ownerKey === owner).length,
        states: states.filter((row) => row.ownerKey === owner).length };
    } finally { database.close(); }
  }, `${session.family_id}:${session.member_id}`);
}

test("sending, recalling and duplicate realtime updates retain 1000 loaded messages", async ({ page, app }) => {
  test.setTimeout(90000); app.makeMessages(1000); await page.goto("/chat"); await loadHistory(page, 1000);
  const rows = page.locator("[data-message-id]"); const input = page.getByPlaceholder("说点什么吧…");
  await input.fill("长历史后的新消息"); await input.press("Enter");
  await expect(rows).toHaveCount(1001); await expect(input).toHaveValue("");
  const sent = app.messages.at(-1)!; const target = page.locator(`[data-message-id="${sent.id}"]`);
  await expect(target).toContainText("长历史后的新消息");
  const reads = app.count("get_messages_by_ids_for_member");
  app.messageEvent(sent.id); app.messageEvent(sent.id);
  await expect.poll(() => app.count("get_messages_by_ids_for_member")).toBeGreaterThan(reads);
  await expect(rows).toHaveCount(1001);
  await target.click({ button: "right" }); await page.getByRole("menuitem", { name: "撤回消息", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect(target).toContainText("你撤回了一条消息"); await expect(rows).toHaveCount(1001);
  app.messageEvent(sent.id); await expect(rows).toHaveCount(1001);
  await page.getByText("回归消息 10", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("回归消息 10", { exact: true })).toBeInViewport();
  expect(app.count("send_message")).toBe(1); expect(app.count("delete_message")).toBe(1);
  expect(app.count("/api/push/send-message-notification")).toBe(1);
});

test("reading history cancels remaining bottom-follow callbacks after sending", async ({ page, app }) => {
  app.makeMessages(100); await page.goto("/chat");
  await expect(page.locator("[data-message-id]")).toHaveCount(100);
  await expect(page.getByText("回归消息 100", { exact: true })).toBeInViewport();
  await page.evaluate(() => {
    // Hold only the final bottom-follow timer. Preserve clearTimeout semantics,
    // then release it after history navigation to exercise the actual race.
    const schedule = window.setTimeout.bind(window);
    const cancel = window.clearTimeout.bind(window);
    const pending = new Map<number, () => void>();
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay !== 520 || typeof handler !== "function") return schedule(handler, delay, ...args);
      const id = schedule(() => pending.delete(id), 60000);
      pending.set(id, () => handler(...args));
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = (id) => { if (typeof id === "number") pending.delete(id); cancel(id); };
    const controls = window as Window & { pendingBottomTimers?: () => number; flushBottomTimers?: () => void };
    controls.pendingBottomTimers = () => pending.size;
    controls.flushBottomTimers = () => {
      const callbacks = [...pending.values()];
      for (const id of pending.keys()) cancel(id);
      pending.clear(); callbacks.forEach((callback) => callback());
    };
  });
  const input = page.getByPlaceholder("说点什么吧…");
  await input.fill("发送后查看历史"); await input.press("Enter");
  await expect(page.getByText("发送后查看历史", { exact: true })).toBeInViewport();
  expect(await page.evaluate(() => (window as Window & { pendingBottomTimers?: () => number }).pendingBottomTimers!())).toBeGreaterThan(0);
  const history = page.getByText("回归消息 10", { exact: true });
  await history.evaluate((element) => {
    element.scrollIntoView({ block: "center", behavior: "instant" });
    element.closest("[data-chat-scroll]")!.dispatchEvent(new Event("scroll"));
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.evaluate(() => (window as Window & { flushBottomTimers?: () => void }).flushBottomTimers!());
  await expect(history).toBeInViewport();
  expect(app.count("send_message")).toBe(1);
});

test("a pending image and incoming realtime message survive a recent cache snapshot", async ({ page, app }) => {
  app.makeMessages(200); await page.goto("/chat"); await loadHistory(page, 200);
  const upload = app.hold("/api/upload/image");
  await page.locator('.native-input-bar input[type="file"]').setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: testPng });
  await upload.arrived; await expect(page.locator("[data-message-id]")).toHaveCount(201);
  const incoming = makeMessage({ id: "40000000-0000-4000-8000-000000009999", family_id: session.family_id,
    sender_member_id: otherMemberId, family_seq: 201, content: "上传期间到达的消息", created_at: new Date().toISOString(),
    effect_id: "cake", effect_caption: "回归实时特效" });
  app.messages.push(incoming); app.messageEvent(incoming.id);
  await expect(page.locator("[data-message-id]")).toHaveCount(202);
  const animation = page.getByRole("button", { name: "关闭动画", exact: true });
  await expect(animation).toContainText("回归实时特效"); await animation.click();
  const duplicate = app.hold("get_messages_by_ids_for_member");
  app.messageEvent(incoming.id); await duplicate.arrived; duplicate.release(); await duplicate.finished;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(animation).toHaveCount(0);
  await expect(page.locator('[data-message-id] img[src^="blob:"]')).toBeVisible();
  upload.release(); await upload.finished; await expect.poll(() => app.count("send_message")).toBe(1);
  await expect(page.locator("[data-message-id]")).toHaveCount(202);
  const sent = app.messages.at(-1)!; await expect(page.locator(`[data-message-id="${sent.id}"] img`)).toBeVisible();
  await expect(page.getByText("回归消息 10", { exact: true })).toHaveCount(1);
});

test("sending a location keeps loaded history and the existing location behavior", async ({ page, app, context }) => {
  await context.grantPermissions(["geolocation"]); await context.setGeolocation({ latitude: 35.6, longitude: 139.7 });
  app.makeMessages(200); await page.goto("/chat"); await loadHistory(page, 200);
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "发送位置", exact: true }).click();
  await expect.poll(() => app.count("send_message")).toBe(1);
  await expect(page.locator("[data-message-id]")).toHaveCount(201);
  expect(app.messages.at(-1)).toMatchObject({ message_type: "location", latitude: 35.6, longitude: 139.7 });
  await expect(page.getByText("回归消息 10", { exact: true })).toHaveCount(1);
});

test("another tab expiring the identity prevents a delayed sync from refilling native cache", async ({ page, app, context }) => {
  app.makeMessages(200); await page.goto("/chat");
  await expect.poll(() => cacheCounts(page)).toEqual({ messages: 100, states: 1 });
  const stale = app.hold("list_messages_after_seq", { data: [app.messages[0]] });
  await page.evaluate(() => window.dispatchEvent(new Event("online"))); await stale.arrived;
  const expiration = app.hold("validate_member", { data: [] });
  const other = await context.newPage(); await other.goto("/chat");
  await expiration.arrived; expiration.release(); await expiration.finished;
  await expect.poll(() => other.evaluate(() => localStorage.getItem("family-chat:session"))).toBeNull();
  await expect.poll(() => cacheCounts(other)).toEqual({ messages: 0, states: 0 });
  stale.release(); await stale.finished;
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => cacheCounts(other)).toEqual({ messages: 0, states: 0 });
  expect(app.count("list_messages_delta")).toBe(0);
});

test("same-identity relogin accepts new messages while an earlier tab response stays stale", async ({ page, app, context }) => {
  app.makeMessages(200); await page.goto("/chat");
  await expect.poll(() => cacheCounts(page)).toEqual({ messages: 100, states: 1 });
  const oldRow = makeMessage({ id: "40000000-0000-4000-8000-000000009999", family_id: session.family_id,
    family_seq: 9999, content: "退出前的晚响应", created_at: new Date().toISOString() });
  const stale = app.hold("list_messages_after_seq", { data: [oldRow] });
  await page.evaluate(() => window.dispatchEvent(new Event("online"))); await stale.arrived;
  const expiration = app.hold("validate_member", { data: [] }); const other = await context.newPage(); await other.goto("/chat");
  await expiration.arrived; expiration.release(); await expiration.finished;
  await expect.poll(() => other.evaluate(() => localStorage.getItem("family-chat:session"))).toBeNull();
  await expect(page).toHaveURL(/\/$/);
  const join = page.getByRole("link", { name: /加入家庭/ });
  await expect(join).toBeVisible();
  // Let the home page's mount restore finish while storage is still logged out.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  app.makeMessages(3);
  await other.evaluate((local) => localStorage.setItem("family-chat:session", JSON.stringify(local)), session);
  await join.click();
  await expect(page.locator("[data-message-id]")).toHaveCount(3);
  stale.release(); await stale.finished;
  await expect.poll(() => cacheCounts(page)).toEqual({ messages: 3, states: 1 });
  await expect(page.getByText("退出前的晚响应", { exact: true })).toHaveCount(0);
});
