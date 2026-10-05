import type { Page } from "@playwright/test";
import { test, expect, itemA, itemB, session } from "./fixtures";

interface MicrophoneControl {
  allow: (index: number) => void;
  deny: (index: number) => void;
  stats: () => { requests: number; tracks: number; ended: number; started: number; elapsed: number };
}
const microphone = (page: Page) => page.evaluate(() =>
  (window as unknown as { __microphone: MicrophoneControl }).__microphone.stats());
const grant = (page: Page, index = 0) => page.evaluate((index) =>
  (window as unknown as { __microphone: MicrophoneControl }).__microphone.allow(index), index);
const scheduleUrl = `/schedule?view=day&date=2026-10-05&item=${itemA}`;
const flush = (page: Page) => page.evaluate(() => new Promise<void>((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

async function installMicrophone(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("family-chat:voice-recording-consent:v1", "yes");
    const requests: Array<{ resolve: (stream: MediaStream) => void; reject: (error: Error) => void }> = [];
    const tracks: MediaStreamTrack[] = [];
    let started = 0; let startedAt = 0;
    const NativeRecorder = window.MediaRecorder;
    window.MediaRecorder = class extends NativeRecorder {
      start(timeslice?: number) { started += 1; startedAt = Date.now(); super.start(timeslice); }
    };
    navigator.mediaDevices.getUserMedia = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
    Object.defineProperty(window, "__microphone", { value: {
      allow(index: number) {
        // Synthetic browser-generated audio: the hardware microphone is never accessed.
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator(); oscillator.connect(destination); oscillator.start();
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { stop(); void context.close().catch(() => undefined); };
          tracks.push(track);
        }
        requests[index].resolve(destination.stream);
      },
      deny(index: number) { requests[index].reject(new DOMException("Permission denied", "NotAllowedError")); },
      stats: () => ({ requests: requests.length, tracks: tracks.length,
        ended: tracks.filter((track) => track.readyState === "ended").length,
        started, elapsed: startedAt ? Date.now() - startedAt : 0 }),
    } });
  });
}
async function holdVoice(page: Page, requestCount = 1) {
  const button = page.getByRole("button", { name: "录制语音", exact: true });
  await expect(button).toBeEnabled();
  const box = await button.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect.poll(async () => (await microphone(page)).requests).toBe(requestCount);
}

test("denied microphone permission leaves chat usable and can be retried", async ({ page, app }) => {
  await installMicrophone(page); await page.goto("/chat");
  await holdVoice(page);
  await page.evaluate(() => (window as unknown as { __microphone: MicrophoneControl }).__microphone.deny(0));
  await page.mouse.up();
  await expect(page.getByText("无法使用麦克风，请在浏览器设置中允许麦克风权限。", { exact: true })).toBeVisible();
  await holdVoice(page, 2);
  await page.mouse.up(); await grant(page, 1); await flush(page);
  expect((await microphone(page)).started).toBe(0);
  expect(app.count("send_message")).toBe(0);
});

test("a cancelled permission response cannot restart chat recording or cancel its replacement", async ({ page, app }) => {
  await installMicrophone(page); await page.goto("/chat");
  await holdVoice(page);
  await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 })));
  await page.mouse.up();
  await holdVoice(page, 2);
  await grant(page, 0); await flush(page);
  expect(await microphone(page)).toMatchObject({ tracks: 1, ended: 1, started: 0 });
  await grant(page, 1);
  await expect.poll(async () => (await microphone(page)).started).toBe(1);
  await page.mouse.move(1, 1); await page.mouse.up();
  await expect.poll(async () => (await microphone(page)).ended).toBe(2);
  expect(app.count("send_message")).toBe(0); expect(app.count("/api/upload/audio")).toBe(0);
});

test("backgrounding an active chat recording releases tracks without sending", async ({ page, app }) => {
  await installMicrophone(page); await page.goto("/chat"); await holdVoice(page); await grant(page);
  await expect.poll(async () => (await microphone(page)).started).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  await expect.poll(async () => (await microphone(page)).ended).toBe(1);
  await expect(page.getByRole("button", { name: "录制语音", exact: true })).toBeEnabled();
  expect(app.count("send_message")).toBe(0);
});

test("leaving chat while microphone permission is pending releases the late stream", async ({ page, app }) => {
  await installMicrophone(page); await page.goto("/chat"); await holdVoice(page);
  await page.getByRole("link", { name: /个人页/ }).dispatchEvent("click");
  await expect(page).toHaveURL(/\/me/); await page.mouse.up(); await grant(page); await flush(page);
  expect(await microphone(page)).toMatchObject({ tracks: 1, ended: 1, started: 0 });
  expect(app.count("send_message")).toBe(0);
});

for (const cancel of ["pointer", "leave", "close", "switch"] as const) {
  test(`late schedule microphone permission after ${cancel} is discarded`, async ({ page, app }) => {
    await installMicrophone(page); await page.goto(scheduleUrl);
    const panel = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(panel.getByRole("heading", { level: 2, name: "回归日程 A", exact: true })).toBeVisible();
    await holdVoice(page);
    if (cancel === "pointer") {
      await page.getByRole("button", { name: "录制语音", exact: true }).dispatchEvent("pointercancel", { pointerId: 1 });
    } else if (cancel === "leave") {
      await page.mouse.move(1, 1);
    } else if (cancel === "close") {
      await panel.getByRole("button", { name: "取消", exact: true }).dispatchEvent("click");
    } else {
      await page.evaluate(({ familyId, itemId }) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
        data: { type: "family-chat:schedule-reminder", familyId, scheduleItemId: itemId },
      })), { familyId: session.family_id, itemId: itemB });
      await expect(panel.getByRole("heading", { level: 2, name: "回归日程 B", exact: true })).toBeVisible();
    }
    await page.mouse.up(); await grant(page); await flush(page);
    expect(await microphone(page)).toMatchObject({ tracks: 1, ended: 1, started: 0 });
    expect(app.count("create_schedule_context_event")).toBe(0); expect(app.count("/api/upload/audio")).toBe(0);
    if (cancel === "leave") {
      await holdVoice(page, 2); await page.mouse.up(); await grant(page, 1); await flush(page);
      expect(await microphone(page)).toMatchObject({ tracks: 2, ended: 2, started: 0 });
    }
  });
}

test("schedule viewport changes discard active recording and keep the composer usable", async ({ page, app }) => {
  await installMicrophone(page); await page.goto(scheduleUrl); await holdVoice(page); await grant(page);
  await expect.poll(async () => (await microphone(page)).started).toBe(1);
  await page.setViewportSize({ width: 430, height: 520 }); await flush(page); await page.mouse.up();
  await expect.poll(async () => (await microphone(page)).ended).toBe(1);
  await expect(page.getByPlaceholder("写一条记录")).toBeEnabled();
  expect(app.count("create_schedule_context_event")).toBe(0);
});

test("closing schedule during an audio upload aborts XHR without creating a record", async ({ page, app }) => {
  await installMicrophone(page);
  await page.addInitScript(() => {
    let aborts = 0;
    const nativeAbort = XMLHttpRequest.prototype.abort;
    XMLHttpRequest.prototype.abort = function () { aborts += 1; return nativeAbort.call(this); };
    Object.defineProperty(window, "__audioUploadAborts", { value: () => aborts });
  });
  await page.goto(scheduleUrl); await holdVoice(page); await grant(page);
  await expect.poll(async () => (await microphone(page)).elapsed).toBeGreaterThan(800);
  const held = app.hold("/api/upload/audio");
  await page.mouse.up(); await held.arrived;
  await page.locator('[role="dialog"][aria-modal="true"]').getByRole("button", { name: "取消", exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __audioUploadAborts: () => number }).__audioUploadAborts())).toBeGreaterThan(0);
  held.release(); await held.finished; await flush(page);
  expect(app.count("create_schedule_context_event")).toBe(0);
});

test("normal native chat recording uploads once and saves a playable audio message", async ({ page, app }) => {
  app.makeMessages(200);
  await installMicrophone(page); await page.goto("/chat");
  await expect(page.locator("[data-message-id]")).toHaveCount(100);
  await page.locator("[data-chat-scroll]").evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  await expect(page.locator("[data-message-id]")).toHaveCount(200);
  await holdVoice(page); await grant(page);
  await expect.poll(async () => (await microphone(page)).elapsed).toBeGreaterThan(800);
  const bar = await page.locator(".native-input-bar").boundingBox();
  await page.mouse.move(bar!.x + bar!.width / 2, bar!.y + bar!.height / 2); await page.mouse.up();
  await expect.poll(() => app.count("send_message")).toBe(1);
  await expect.poll(async () => (await microphone(page)).ended).toBe(1);
  expect(app.count("/api/upload/audio")).toBe(1);
  await expect(page.locator("[data-message-id]")).toHaveCount(201);
  const audio = page.getByRole("button", { name: /^播放语音消息/ });
  await expect(audio).toBeEnabled(); await audio.click();
  await expect(page.getByRole("button", { name: /^暂停语音消息/ })).toHaveAttribute("aria-pressed", "true");
});

test("normal native schedule recording uploads once and creates one audio record", async ({ page, app }) => {
  await installMicrophone(page); await page.goto(scheduleUrl); await holdVoice(page); await grant(page);
  await expect.poll(async () => (await microphone(page)).elapsed).toBeGreaterThan(800);
  await page.mouse.up();
  await expect.poll(() => app.count("create_schedule_context_event")).toBe(1);
  await expect.poll(async () => (await microphone(page)).ended).toBe(1);
  expect(app.count("/api/upload/audio")).toBe(1);
  await expect(page.getByRole("button", { name: "录制语音", exact: true })).toBeEnabled();
});

test("a schedule audio record committed before closing still requests its collaboration notification", async ({ page, app }) => {
  await installMicrophone(page); await page.goto(scheduleUrl); await holdVoice(page); await grant(page);
  await expect.poll(async () => (await microphone(page)).elapsed).toBeGreaterThan(800);
  const saved = app.hold("create_schedule_context_event");
  await page.mouse.up(); await saved.arrived;
  const panel = page.locator('[role="dialog"][aria-modal="true"]');
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await expect(panel).toHaveCount(0);
  saved.release(); await saved.finished; await flush(page);
  await expect.poll(() => app.count("/api/schedule/collaboration-notify")).toBe(1);
  expect(app.count("create_schedule_context_event")).toBe(1);
  expect(app.count("/api/upload/audio")).toBe(1);
  await expect(panel).toHaveCount(0);
});

test("cold notification entry and successive message targets each recover the intended anchor", async ({ page, app }) => {
  app.makeMessages(1200);
  const firstId = app.messages[0].id; const secondId = app.messages[60].id;
  await page.goto(`/chat?mid=${firstId}`);
  await expect(page.locator(`[data-message-id="${firstId}"]`)).toBeInViewport();
  await expect(page.locator("[data-message-id]")).toHaveCount(101);
  await page.evaluate(({ familyId, messageId }) => {
    history.replaceState(null, "", `/chat?mid=${messageId}`);
    navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
      data: { type: "family-chat:push-received", familyId, messageId },
    }));
  }, { familyId: session.family_id, messageId: secondId });
  await expect(page.locator(`[data-message-id="${secondId}"]`)).toBeInViewport();
  await expect(page.locator("[data-message-id]")).toHaveCount(102);
  // Wait across the existing 180/520ms bottom-follow window to verify a stable destination.
  await page.waitForTimeout(650);
  await expect(page.locator(`[data-message-id="${secondId}"]`)).toBeInViewport();
  await page.evaluate(({ familyId, itemId }) => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
      data: { type: "family-chat:push-received", familyId, messageId: itemId },
    }));
  }, { familyId: "another-family", itemId: app.messages[6].id });
  await flush(page);
  await expect(page.locator(`[data-message-id="${app.messages[6].id}"]`)).toHaveCount(0);
});

test("a notification click with a stale URL opens its target and an older response cannot steal it", async ({ page, app }) => {
  app.makeMessages(200);
  const firstId = app.messages[0].id; const secondId = app.messages[60].id;
  await page.goto("/chat"); await expect(page.locator("[data-message-id]")).toHaveCount(100);
  const first = app.hold("get_message_for_member", undefined, (body) => body.p_message_id === firstId);
  const open = (messageId: string) => page.evaluate(({ familyId, messageId }) => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
      data: { type: "family-chat:push-received", familyId, messageId, openedFromNotification: true },
    }));
  }, { familyId: session.family_id, messageId });
  await open(firstId); await first.arrived;
  await open(secondId);
  await expect(page).toHaveURL(new RegExp(`mid=${secondId}`));
  await expect(page.locator(`[data-message-id="${secondId}"]`)).toBeInViewport();
  first.release(); await first.finished; await flush(page);
  await page.waitForTimeout(650);
  await expect(page).toHaveURL(new RegExp(`mid=${secondId}`));
  await expect(page.locator(`[data-message-id="${secondId}"]`)).toBeInViewport();
});

test("successive schedule reminder signals open each item and ignore another family", async ({ page, app }) => {
  await page.goto(scheduleUrl);
  const panel = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(panel.getByRole("heading", { level: 2, name: "回归日程 A", exact: true })).toBeVisible();
  await expect.poll(() => app.channels.some((channel) => channel.topic.includes("schedule-events:"))).toBe(true);
  for (const [itemId, name] of [[itemB, "回归日程 B"], [itemA, "回归日程 A"]]) {
    await page.evaluate(({ familyId, itemId }) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
      data: { type: "family-chat:schedule-reminder", familyId, scheduleItemId: itemId },
    })), { familyId: session.family_id, itemId });
    await expect(panel.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
  }
  await page.evaluate((itemId) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
    data: { type: "family-chat:schedule-reminder", familyId: "another-family", scheduleItemId: itemId },
  })), itemB);
  await flush(page);
  await expect(panel.getByRole("heading", { level: 2, name: "回归日程 A", exact: true })).toBeVisible();
});
