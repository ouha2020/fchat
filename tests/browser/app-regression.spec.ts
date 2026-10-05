import { test, expect, itemA, itemB, avatarRef, testPng, session, otherMemberId } from "./fixtures";
import type { Page } from "@playwright/test";

const scheduleUrl = "/schedule?view=day&date=2026-10-05";
const flushUpdates = (page: Page) => page.evaluate(() =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

test("realtime refresh preserves comment privacy, draft and an active edit", async ({ page, app }) => {
  await page.goto(`${scheduleUrl}&item=${itemA}`);
  const panel = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(panel.getByRole("heading", { name: "回归日程 A", exact: true, level: 2 })).toBeVisible();
  await expect.poll(() => app.channels.some((channel) => channel.topic.includes("schedule-events:"))).toBe(true);
  await expect(panel.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "记录选项", exact: true }).click();
  await panel.getByRole("menuitem", { name: "悄悄话", exact: true }).click();
  await panel.getByRole("button", { name: /回归家人/ }).click();
  const input = panel.getByPlaceholder("悄悄话给 回归家人");
  await input.fill("尚未发送的私密草稿");
  const reads = app.count("get_schedule_item_for_member");
  app.items[0].title = "远端更新 A";
  app.scheduleEvent();
  await expect(panel.getByRole("heading", { name: "远端更新 A", exact: true, level: 2 })).toBeVisible();
  await expect.poll(() => app.count("get_schedule_item_for_member")).toBeGreaterThan(reads);
  await expect(input).toHaveValue("尚未发送的私密草稿");

  await panel.getByRole("button", { name: "编辑", exact: true }).click();
  const title = panel.locator('input[maxlength="60"]');
  await title.fill("正在编辑的标题");
  const edits = app.count("get_schedule_item_for_member");
  app.items[0].title = "第二次远端更新 A";
  app.scheduleEvent();
  await expect.poll(() => app.count("get_schedule_item_for_member")).toBeGreaterThan(edits);
  await expect(panel.getByRole("heading", { name: "第二次远端更新 A", exact: true, level: 2 })).toBeVisible();
  await expect(title).toHaveValue("正在编辑的标题");
  await expect(panel.getByRole("button", { name: "保存修改", exact: true })).toBeVisible();
});

test("initial detail response keeps new typing; a closed old detail cannot replace another item", async ({ page, app }) => {
  await page.goto(scheduleUrl);
  await expect(page.getByText("回归日程 A", { exact: true })).toBeVisible();
  const held = app.hold("get_schedule_item_for_member");
  await page.getByText("回归日程 A", { exact: true }).click();
  await held.arrived;
  const panel = page.getByRole("dialog");
  await panel.getByPlaceholder("写一条记录").fill("加载详情期间输入");
  held.release();
  await held.finished;
  await flushUpdates(page);
  await expect(panel.getByPlaceholder("写一条记录")).toHaveValue("加载详情期间输入");
  await panel.getByRole("button", { name: "取消", exact: true }).click();

  const old = app.hold("get_schedule_item_for_member");
  await page.getByText("回归日程 A", { exact: true }).click();
  await old.arrived;
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByText("回归日程 B", { exact: true }).click();
  await expect(panel.getByRole("heading", { name: "回归日程 B", exact: true, level: 2 })).toBeVisible();
  await panel.getByPlaceholder("写一条记录").fill("B 的草稿");
  old.release();
  await old.finished;
  await flushUpdates(page);
  await expect(panel.getByRole("heading", { name: "回归日程 B", exact: true, level: 2 })).toBeVisible();
  await expect(panel.getByPlaceholder("写一条记录")).toHaveValue("B 的草稿");
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await expect(panel).toHaveCount(0);
});

test("sending an older comment does not clear text typed while it is pending", async ({ page, app }) => {
  await page.goto(`${scheduleUrl}&item=${itemA}`);
  const panel = page.getByRole("dialog");
  const input = panel.getByPlaceholder("写一条记录");
  await expect(input).toBeVisible();
  await input.fill("第一条记录");
  const old = app.hold("create_schedule_context_event");
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  await old.arrived;
  await input.fill("下一条草稿");
  old.release();
  await old.finished;
  await flushUpdates(page);
  await expect(page.getByText("评论已发送", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("下一条草稿");
});

test("a comment completed after switching details leaves the current draft untouched", async ({ page, app }) => {
  await page.goto(`${scheduleUrl}&item=${itemA}`);
  const panel = page.getByRole("dialog");
  await panel.getByPlaceholder("写一条记录").fill("A 的记录");
  const old = app.hold("create_schedule_context_event");
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  await old.arrived;
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByText("回归日程 B", { exact: true }).click();
  await panel.getByPlaceholder("写一条记录").fill("B 的新草稿");
  old.release();
  await old.finished;
  await flushUpdates(page);
  await expect(panel.getByRole("heading", { name: "回归日程 B", exact: true, level: 2 })).toBeVisible();
  await expect(panel.getByPlaceholder("写一条记录")).toHaveValue("B 的新草稿");
});

test("focus and visibility refreshes share one personal dashboard read", async ({ page, app }) => {
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "个人页", exact: true })).toBeVisible();
  const initial = app.count("get_personal_dashboard_for_member");
  const held = app.hold("get_personal_dashboard_for_member");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await held.arrived;
  // A frame barrier lets all three event handlers run before counting requests.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(app.count("get_personal_dashboard_for_member")).toBe(initial + 1);
  held.release();
  await held.finished;
  await flushUpdates(page);
  await expect(page.getByRole("heading", { name: "个人页", exact: true })).toBeVisible();
});

test("stale dashboard cannot restore a removed avatar; Dialog traps and restores focus", async ({ page, app }) => {
  app.avatar = avatarRef;
  await page.goto("/me");
  const remove = page.getByRole("button", { name: "删除头像", exact: true });
  await expect(remove).toBeVisible();
  const held = app.hold("get_personal_dashboard_for_member");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await held.arrived;
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "删除头像", exact: true });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  expect(app.count("update_member_avatar")).toBe(0);
  await remove.click();
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("button", { name: "上传头像", exact: true })).toBeEnabled();
  held.release();
  await held.finished;
  await flushUpdates(page);
  await expect(remove).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传头像", exact: true })).toBeEnabled();
});

test("leaving an avatar upload aborts XHR and does not save the profile", async ({ page, app }) => {
  await page.addInitScript(() => {
    const nativeAbort = XMLHttpRequest.prototype.abort;
    Object.defineProperty(window, "__uploadAborts", { value: { count: 0 } });
    XMLHttpRequest.prototype.abort = function () {
      (window as unknown as { __uploadAborts: { count: number } }).__uploadAborts.count += 1;
      return nativeAbort.call(this);
    };
  });
  await page.goto("/me");
  await expect(page.getByRole("button", { name: "上传头像", exact: true })).toBeEnabled();
  const held = app.hold("/api/upload/avatar");
  await page.locator('input[type="file"]').setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: testPng });
  await held.arrived;
  await page.getByRole("link", { name: /返回聊天/ }).click();
  await expect(page).toHaveURL(/\/chat/);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __uploadAborts: { count: number } }).__uploadAborts.count)).toBeGreaterThan(0);
  held.release();
  await held.finished;
  await flushUpdates(page);
  expect(app.count("update_member_avatar")).toBe(0);
});

test("a dashboard error arriving after navigation cannot show a stale toast", async ({ page, app }) => {
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "个人页", exact: true })).toBeVisible();
  const held = app.hold("get_personal_dashboard_for_member", { status: 500, data: { message: "late-dashboard-fixture-error" } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await held.arrived;
  await page.getByRole("link", { name: /返回聊天/ }).click();
  await expect(page).toHaveURL(/\/chat/);
  held.release();
  await held.finished;
  await flushUpdates(page);
  await expect(page.getByText("late-dashboard-fixture-error", { exact: false })).toHaveCount(0);
});

for (const width of [360, 390, 430]) {
  test(`schedule and personal page fit ${width}px and a compressed keyboard viewport`, async ({ page, app }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "个人页", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.goto(`${scheduleUrl}&item=${itemA}`);
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.setViewportSize({ width, height: 520 });
    const input = panel.getByPlaceholder("写一条记录");
    await input.fill("键盘压缩高度的草稿");
    await expect(panel.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    const box = await input.boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= 520).toBe(true);
    const buttonBox = await panel.getByRole("button", { name: "发送", exact: true }).boundingBox();
    expect(buttonBox && buttonBox.y + buttonBox.height <= 520).toBe(true);
    expect(app.count("create_schedule_context_event")).toBe(0);
  });
}

test("1000 chat messages share observers, retain anchors and release observers on navigation", async ({ page, app }) => {
  test.setTimeout(90_000);
  app.makeMessages(1000);
  await page.addInitScript(() => {
    const intersections = new Map<IntersectionObserver, Set<Element>>();
    const resizes = new Map<ResizeObserver, Set<Element>>();
    const nativeIntersection = window.IntersectionObserver;
    const nativeResize = window.ResizeObserver;
    window.IntersectionObserver = class extends nativeIntersection {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options); intersections.set(this, new Set());
      }
      observe(element: Element) { intersections.get(this)!.add(element); super.observe(element); }
      unobserve(element: Element) { intersections.get(this)?.delete(element); super.unobserve(element); }
      disconnect() { intersections.delete(this); super.disconnect(); }
    };
    window.ResizeObserver = class extends nativeResize {
      constructor(callback: ResizeObserverCallback) { super(callback); resizes.set(this, new Set()); }
      observe(element: Element, options?: ResizeObserverOptions) { resizes.get(this)!.add(element); super.observe(element, options); }
      unobserve(element: Element) { resizes.get(this)?.delete(element); super.unobserve(element); }
      disconnect() { resizes.delete(this); super.disconnect(); }
    };
    Object.defineProperty(window, "__chatObservers", { value: () => ({
      intersection: [...intersections.values()].filter((rows) => [...rows].some((row) => row.hasAttribute("data-message-id"))).length,
      resize: [...resizes.values()].filter((rows) => [...rows].some((row) => row.hasAttribute("data-message-id"))).length,
    }) });
  });
  await page.goto("/chat");
  const rows = page.locator("[data-message-id]");
  await expect(rows).toHaveCount(100);
  for (let count = 200; count <= 1000; count += 100) {
    await page.locator("[data-chat-scroll]").evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
    await expect(rows).toHaveCount(count);
  }
  const metrics = () => page.evaluate(() =>
    (window as unknown as { __chatObservers: () => { intersection: number; resize: number } }).__chatObservers());
  await expect.poll(metrics).toEqual({ intersection: 1, resize: 1 });
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await page.getByText("回归消息 10", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("回归消息 10", { exact: true })).toBeInViewport();
  await page.getByText("回归消息 999", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("回归消息 999", { exact: true })).toBeInViewport();
  await page.getByText("回归消息 999", { exact: true }).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByRole("link", { name: /个人页/ }).click();
  await expect(page).toHaveURL(/\/me/);
  await expect.poll(metrics).toEqual({ intersection: 0, resize: 0 });
});

test("memoized message rows preserve image preview, audio, location, whisper and recalled messages", async ({ page, app }) => {
  app.makeMessages(6);
  Object.assign(app.messages[1], { message_type: "image", content: null,
    image_url: `storage://chat-images/${session.family_id}/fixture.png` });
  Object.assign(app.messages[2], { message_type: "audio", content: null, audio_duration_ms: 3000,
    audio_url: `storage://chat-audios/${session.family_id}/fixture.webm` });
  Object.assign(app.messages[3], { message_type: "location", content: null,
    latitude: 35.6, longitude: 139.7, address: "合成位置", map_url: "https://www.google.com/maps?q=35.6,139.7" });
  app.messages[4].recipient_member_id = otherMemberId;
  app.messages[5].deleted_at = "2026-10-05T00:00:00.000Z";
  await page.goto("/chat");
  await expect(page.locator("[data-message-id]")).toHaveCount(6);
  await expect(page.getByText("回归消息 5", { exact: true })).toBeVisible();
  await expect(page.getByText("回归消息 6", { exact: true })).toHaveCount(0);
  await expect(page.getByText("合成位置", { exact: true })).toBeVisible();
  const audio = page.getByRole("button", { name: /^播放语音消息/ });
  await audio.click();
  const playing = page.getByRole("button", { name: /^暂停语音消息/ });
  await expect(playing).toHaveAttribute("aria-pressed", "true");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  const image = page.locator(`[data-message-id="${app.messages[1].id}"] img`);
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await image.click();
  await expect(page).toHaveURL(/\/image-preview\?mid=/);
  const preview = page.locator("main img");
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((element) => (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page).toHaveURL(/\/chat/);
});
