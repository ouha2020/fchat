import ts from "typescript";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, session } from "./fixtures";
import type * as MessageCache from "@/lib/messageCache";
import type * as Lifecycle from "@/lib/messageCacheLifecycle";
import type * as MediaCache from "@/lib/mediaCacheStore";
import { makeMessage } from "@/tests/helpers/messages";

type CacheModule = typeof MessageCache & typeof Lifecycle & typeof MediaCache;
declare global { interface Window { __messageCacheTest: CacheModule;
  __mediaPending: { release: () => void; completion: Promise<void> } } }
let cacheBundle: string;

test.beforeAll(() => {
  // Test-only bundle of the shipped cache code. Native Chromium IndexedDB is not mocked.
  const files = ["messageCache", "messageCacheLifecycle", "messageList", "messageNormalization", "mediaCacheStore"];
  const modules = files.map((name) => {
    const source = readFileSync(path.resolve("lib", `${name}.ts`), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    } }).outputText;
    return `${JSON.stringify(`@/lib/${name}`)}: (exports, require) => { ${code} }`;
  }).join(",");
  cacheBundle = `(() => { const factories = { ${modules} }; const loaded = {};
    function require(id) { if (!loaded[id]) { const exports = {}; loaded[id] = exports;
      if (!factories[id]) throw Error('Unexpected test module'); factories[id](exports, require); }
      return loaded[id]; }
    window.__messageCacheTest = { ...require('@/lib/messageCache'), ...require('@/lib/messageCacheLifecycle'), ...require('@/lib/mediaCacheStore') };
  })();`;
});

test("native media cache rejects an old-tab put and delayed cleanup keeps a new login's image", async ({ page, context }) => {
  const ref = `storage://chat-images/family/${session.family_id}/fixture.png`;
  await page.evaluate(async ({ session, ref }) => {
    const store = window.__messageCacheTest;
    const put = Cache.prototype.put; let release!: () => void;
    let entered!: () => void;
    const arrived = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Hold the actual Cache API write after the initial identity check.
    Cache.prototype.put = async function (key, response) {
      entered();
      await gate; return put.call(this, key, response);
    };
    const completion = store.writeCachedImageBlob(session, ref, new Blob(["old download"]))
      .finally(() => { Cache.prototype.put = put; });
    window.__mediaPending = { release, completion };
    await arrived;
  }, { session, ref });
  const other = await context.newPage(); await other.goto("/fixture-cache.html");
  await other.addScriptTag({ content: cacheBundle });
  await other.evaluate(async ({ session, ref }) => {
    const store = window.__messageCacheTest;
    store.invalidateMessageCacheContext(session);
    localStorage.removeItem("family-chat:session");
    localStorage.setItem("family-chat:session", JSON.stringify(session));
    await store.writeCachedImageBlob(session, ref, new Blob(["new login image"]));
  }, { session, ref });
  const result = await page.evaluate(async ({ session, ref }) => {
    const store = window.__messageCacheTest;
    window.__mediaPending.release(); await window.__mediaPending.completion;
    await store.clearImageCacheForSession(session, true);
    const image = await store.readCachedImageBlob(session, ref);
    const keys = await (await caches.open("family-chat-media-v3")).keys();
    return { text: await image?.text(), entries: keys.length, tokenInKey: keys.some((key) => key.url.includes(session.member_token)) };
  }, { session, ref });
  expect(result).toEqual({ text: "new login image", entries: 1, tokenInKey: false });
});

test.beforeEach(async ({ page }) => {
  await page.goto("/fixture-cache.html");
  await page.addScriptTag({ content: cacheBundle });
});

test("native IndexedDB keeps its 1000 row bound, strips client fields, and returns the recent window", async ({ page }) => {
  const rows = Array.from({ length: 1003 }, (_, index) => makeMessage({ id: String(index).padStart(4, "0"),
    family_id: session.family_id, created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(),
    local_preview_url: "blob:synthetic", upload_status: "failed", upload_progress: 0.2 }));
  const result = await page.evaluate(async ({ session, rows }) => {
    const cache = window.__messageCacheTest;
    const recent = await cache.upsertMessagesAndSyncState(session, rows, { lastSyncedSeq: 1003 });
    const all = await cache.loadCachedMessages(session, 2000);
    return { recent: recent.length, total: all.length, first: all[0].id,
      clientFields: all.some((row) => "upload_status" in row || "local_preview_url" in row),
      seq: (await cache.getSyncState(session))?.lastSyncedSeq };
  }, { session, rows });
  expect(result).toEqual({ recent: 100, total: 1000, first: "0003", clientFields: false, seq: 1003 });
});

test("a delayed old cleanup keeps new login rows and rejects an old write context", async ({ page }) => {
  const result = await page.evaluate(async ({ session, oldRow, newRow }) => {
    const cache = window.__messageCacheTest; const old = cache.captureMessageCacheContext(session);
    await cache.upsertMessagesAndSyncState(session, [oldRow], { lastSyncedSeq: 1 }, old);
    cache.invalidateMessageCacheContext(session);
    localStorage.removeItem("family-chat:session"); localStorage.setItem("family-chat:session", JSON.stringify(session));
    const current = cache.captureMessageCacheContext(session);
    await cache.upsertMessagesAndSyncState(session, [newRow], { lastSyncedSeq: 2 }, current);
    await cache.clearMessageCacheForSession(session, true);
    let rejected = false;
    try { await cache.upsertMessagesAndSyncState(session, [oldRow], { lastSyncedSeq: 999 }, old); }
    catch { rejected = true; }
    return { rejected, ids: (await cache.loadCachedMessages(session)).map((row) => row.id),
      seq: (await cache.getSyncState(session))?.lastSyncedSeq };
  }, { session, oldRow: makeMessage({ id: "old", family_id: session.family_id }),
    newRow: makeMessage({ id: "new", family_id: session.family_id }) });
  expect(result).toEqual({ rejected: true, ids: ["new"], seq: 2 });
});

test("invalidation during a native IndexedDB write aborts both messages and checkpoint", async ({ page }) => {
  const result = await page.evaluate(async ({ session, row }) => {
    const cache = window.__messageCacheTest; const context = cache.captureMessageCacheContext(session);
    const get = IDBObjectStore.prototype.get; let interrupted = false;
    IDBObjectStore.prototype.get = function (key) {
      const request = get.call(this, key);
      if (this.name === "messages" && !interrupted) {
        interrupted = true;
        request.addEventListener("success", () => cache.invalidateMessageCacheContext(session), { once: true });
      }
      return request;
    };
    let rejected = false;
    try { await cache.upsertMessagesAndSyncState(session, [row], { lastSyncedSeq: 99 }, context); }
    catch { rejected = true; }
    finally { IDBObjectStore.prototype.get = get; }
    await cache.clearMessageCacheForSession(session, true);
    return { interrupted, rejected, rows: (await cache.loadCachedMessages(session)).length,
      state: await cache.getSyncState(session) };
  }, { session, row: makeMessage({ id: "interrupted", family_id: session.family_id }) });
  expect(result).toEqual({ interrupted: true, rejected: true, rows: 0, state: null });
});

test("native cache rejects stale recalled snapshots and keeps seq monotonic", async ({ page }) => {
  const result = await page.evaluate(async ({ session, original, recalled }) => {
    const cache = window.__messageCacheTest;
    await cache.upsertMessagesAndSyncState(session, [recalled], { lastSyncedSeq: 10 });
    await cache.upsertMessagesAndSyncState(session, [original], { lastSyncedSeq: 2 });
    return { deleted: (await cache.loadCachedMessages(session))[0].deleted_at,
      seq: (await cache.getSyncState(session))?.lastSyncedSeq };
  }, { session, original: makeMessage({ id: "recalled", family_id: session.family_id }),
    recalled: makeMessage({ id: "recalled", family_id: session.family_id, deleted_at: "2026-10-05T01:00:00Z", content: null }) });
  expect(result).toEqual({ deleted: "2026-10-05T01:00:00Z", seq: 10 });
});

test("an unavailable native cache fails safely without fabricating cached content", async ({ page }) => {
  const result = await page.evaluate(async ({ session, row }) => {
    Object.defineProperty(window, "indexedDB", { value: undefined });
    try { await window.__messageCacheTest.upsertMessagesToCache(session, [row]); return false; }
    catch (error) { return error instanceof Error && error.message === "indexeddb_unavailable"; }
  }, { session, row: makeMessage({ id: "rpc-success", family_id: session.family_id }) });
  expect(result).toBe(true);
});

test("unversioned legacy rows are ignored and pruned when the new session caches authorized data", async ({ page }) => {
  const result = await page.evaluate(async ({ session, row }) => {
    const cache = window.__messageCacheTest;
    await cache.registerCacheOpen(session);
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("family-chat-cache"); request.onsuccess = () => resolve(request.result);
    });
    const ownerKey = `${session.family_id}:${session.member_id}`;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["messages", "sync_state"], "readwrite");
      transaction.objectStore("messages").put({ ...row, id: "legacy", ownerKey, cacheKey: `${ownerKey}:legacy` });
      transaction.objectStore("sync_state").put({ ownerKey, lastSyncedSeq: 999 });
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
    });
    const before = { rows: (await cache.loadCachedMessages(session)).length, state: await cache.getSyncState(session) };
    await cache.upsertMessagesAndSyncState(session, [row], { lastSyncedSeq: 1 });
    const raw = await new Promise<unknown[]>((resolve) => {
      const request = db.transaction("messages").objectStore("messages").getAll();
      request.onsuccess = () => resolve(request.result);
    }); db.close();
    return { before, ids: (await cache.loadCachedMessages(session)).map((message) => message.id),
      stored: raw.length, seq: (await cache.getSyncState(session))?.lastSyncedSeq };
  }, { session, row: makeMessage({ id: "authorized", family_id: session.family_id }) });
  expect(result).toEqual({ before: { rows: 0, state: null }, ids: ["authorized"], stored: 1, seq: 1 });
});

test("old-version rows do not consume the current identity's recent window", async ({ page }) => {
  const ids = await page.evaluate(async ({ session, row }) => {
    const cache = window.__messageCacheTest;
    await cache.upsertMessagesToCache(session, [row]);
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("family-chat-cache"); request.onsuccess = () => resolve(request.result);
    });
    const ownerKey = `${session.family_id}:${session.member_id}`;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      for (let index = 0; index < 101; index += 1) {
        const id = `legacy-${index}`;
        transaction.objectStore("messages").put({ ...row, id, ownerKey, cacheKey: `${ownerKey}:${id}`, cacheVersion: "old-version" });
      }
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
    });
    db.close();
    return (await cache.loadCachedMessages(session)).map((message) => message.id);
  }, { session, row: makeMessage({ id: "current", family_id: session.family_id }) });
  expect(ids).toEqual(["current"]);
});
