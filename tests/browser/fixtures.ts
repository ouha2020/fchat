import { test as base, expect, type Route, type WebSocketRoute } from "@playwright/test";
import type { LocalSession } from "@/lib/authLocal";
import type { ScheduleItem, ScheduleContextEvent } from "@/types/schedule";
import type { Message } from "@/types/message";
import { makeMessage } from "@/tests/helpers/messages";
import { deflateSync } from "node:zlib";

export const session: LocalSession = {
  family_id: "10000000-0000-4000-8000-000000000001",
  member_id: "20000000-0000-4000-8000-000000000001",
  member_token: "synthetic-browser-test-token",
  nickname: "回归成员", family_name: "回归家庭", family_code: "TESTONLY",
  role: "father", is_admin: true,
};
export const otherMemberId = "20000000-0000-4000-8000-000000000002";
export const itemA = "30000000-0000-4000-8000-000000000001";
export const itemB = "30000000-0000-4000-8000-000000000002";
export const avatarRef = `storage://chat-images/avatars/${session.family_id}/${session.member_id}/fixture.png`;
function pngChunk(type: string, data: Buffer) {
  const content = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(content.length + 8);
  chunk.writeUInt32BE(data.length, 0); content.copy(chunk, 4);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}
function fixturePng() {
  // A solid 160x96 synthetic image provides a realistic, stable pointer target.
  const header = Buffer.alloc(13); header.writeUInt32BE(160, 0); header.writeUInt32BE(96, 4);
  header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((160 * 3 + 1) * 96, 196);
  for (let row = 0; row < 96; row += 1) pixels[row * (160 * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]);
}
export const testPng = fixturePng();
// Three seconds of generated silence: playback checks do not request a microphone.
const audioSamples = 24_000 * 3;
const testAudio = Buffer.alloc(44 + audioSamples * 2);
testAudio.write("RIFF", 0); testAudio.writeUInt32LE(testAudio.length - 8, 4);
testAudio.write("WAVEfmt ", 8); testAudio.writeUInt32LE(16, 16);
testAudio.writeUInt16LE(1, 20); testAudio.writeUInt16LE(1, 22);
testAudio.writeUInt32LE(24_000, 24); testAudio.writeUInt32LE(48_000, 28);
testAudio.writeUInt16LE(2, 32); testAudio.writeUInt16LE(16, 34);
testAudio.write("data", 36); testAudio.writeUInt32LE(audioSamples * 2, 40);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

export function scheduleItem(id: string, title: string): ScheduleItem {
  return {
    id, title, family_id: session.family_id, creator_member_id: session.member_id,
    assignee_member_id: otherMemberId, assignee_response: "accepted",
    creator_nickname: session.nickname, assignee_nickname: "回归家人",
    note: "合成备注", item_type: "schedule", visibility: "family", status: "active",
    starts_at: "2026-10-05T10:00:00.000Z", ends_at: null, remind_at: null,
    reminded_at: null, reminder_push_attempted_at: null, recurrence_group_id: null,
    recurrence_rule: "none", recurrence_index: null, completed_at: null,
    completed_by_member_id: null, created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  };
}

type Reply = { data: unknown; status?: number };
type Hold = { matches: (path: string, body: Record<string, unknown>) => boolean;
  arrived: ReturnType<typeof deferred<void>>; released: ReturnType<typeof deferred<void>>;
  finished: ReturnType<typeof deferred<void>>;
  reply?: Reply };
type Channel = { socket: WebSocketRoute; topic: string; joinRef: string;
  array: boolean; filters: { id: number; table: string }[] };

export class AppFixture {
  activeSession = session;
  items = [scheduleItem(itemA, "回归日程 A"), scheduleItem(itemB, "回归日程 B")];
  avatar: string | null = null;
  messages: Message[] = [];
  contexts: ScheduleContextEvent[] = [];
  calls: string[] = [];
  unexpected: string[] = [];
  channels: Channel[] = [];
  private holds: Hold[] = [];

  hold(path: string, reply?: Reply, predicate = (_body: Record<string, unknown>) => true) {
    const hold: Hold = {
      matches: (actual, body) => actual.endsWith(path) && predicate(body),
      arrived: deferred<void>(), released: deferred<void>(), finished: deferred<void>(), reply,
    };
    this.holds.push(hold);
    return { arrived: hold.arrived.promise, release: () => hold.released.resolve(),
      finished: hold.finished.promise };
  }

  count(name: string) { return this.calls.filter((call) => call === name).length; }

  makeMessages(count: number) {
    this.messages = Array.from({ length: count }, (_, i) => makeMessage({
      id: `40000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      family_id: session.family_id, family_seq: i + 1,
      sender_member_id: i % 2 ? otherMemberId : session.member_id,
      content: `回归消息 ${i + 1}`,
      created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
    }));
  }

  private rpc(name: string, body: Record<string, unknown>): Reply {
    const id = body.p_item_id ?? body.p_schedule_item_id;
    switch (name) {
      case "validate_member": return { data: body.p_member_id === this.activeSession.member_id &&
        body.p_member_token === this.activeSession.member_token ? [this.activeSession] : [] };
      case "list_family_members_for_member": return { data: [session, {
        ...session, member_id: otherMemberId, nickname: "回归家人", role: "mother",
      }].map((member) => ({ ...member, id: member.member_id, status: "active", avatar_url: null,
        last_active_at: "2026-10-05T00:00:00.000Z" })) };
      case "get_personal_dashboard_for_member": return { data: {
        profile: { ...session, avatar_url: this.avatar }, today_assigned: [], upcoming: [],
        created_by_me: [], recent_done: [],
      } };
      case "get_family_settings_for_member": return { data: [{ family_name: session.family_name,
        family_code: session.family_code, join_enabled: true }] };
      case "list_album_items": return { data: [] };
      case "update_member_avatar": this.avatar = body.p_avatar_url as string | null;
        return { data: this.avatar };
      case "list_schedule_items_for_member":
      case "search_schedule_items_for_member": return { data: this.items.filter((item) =>
        item.starts_at >= String(body.p_range_start) && item.starts_at < String(body.p_range_end)) };
      case "get_schedule_item_for_member": return { data: this.items.filter((item) => item.id === id) };
      case "get_schedule_collaboration_for_member": return { data: {
        comments: [], activity_logs: [], assignee_response: { status: "accepted", responded_at: null, note: null },
      } };
      case "list_schedule_context_events_for_member": return { data: this.contexts.filter((event) => event.schedule_item_id === id) };
      case "get_schedule_reminder_status_for_member": return { data: {
        configured: false, remind_at: null, rules: [], current_member_delivery: null, deliveries: [],
      } };
      case "create_schedule_context_event": return { data: "50000000-0000-4000-8000-000000000001" };
      case "list_messages_for_member": return { data: this.messages.slice(-Number(body.p_limit)).reverse() };
      case "list_messages_before": return { data: this.messages.filter((message) =>
        message.created_at < String(body.p_before_created_at)).slice(-Number(body.p_limit)).reverse() };
      case "get_message_for_member": return { data: this.messages.filter((message) => message.id === body.p_message_id) };
      case "get_messages_by_ids_for_member": return { data: this.messages.filter((message) =>
        (body.p_message_ids as string[]).includes(message.id)) };
      case "list_messages_after_seq": return { data: this.messages.filter((message) =>
        (message.family_seq ?? 0) > Number(body.p_after_seq)).slice(0, Number(body.p_limit)) };
      case "list_messages_delta":
      case "list_important_notifications_for_member":
      case "list_assistant_action_cards_for_member": return { data: [] };
      case "send_message": {
        const message = makeMessage({ id: crypto.randomUUID(), family_id: session.family_id,
          sender_member_id: session.member_id, family_seq: this.messages.length + 1,
          message_type: body.p_message_type as Message["message_type"], content: body.p_content as string | null,
          audio_url: body.p_audio_url as string | null, audio_duration_ms: body.p_audio_duration_ms as number | null,
          image_url: body.p_image_url as string | null,
          latitude: body.p_latitude as number | null, longitude: body.p_longitude as number | null,
          map_url: body.p_map_url as string | null,
          recipient_member_id: body.p_recipient_member_id as string | null,
          created_at: new Date().toISOString() });
        this.messages.push(message); return { data: message.id };
      }
      case "delete_message": {
        const message = this.messages.find((row) => row.id === body.p_message_id);
        if (message) { message.deleted_at = new Date().toISOString(); message.updated_at = message.deleted_at; }
        return { data: null };
      }
      case "mark_messages_delivered":
      case "mark_messages_read":
      case "update_schedule_item_with_reminder_rules":
      case "respond_schedule_assignment":
      case "delete_schedule_item": return { data: null };
      default: this.unexpected.push(`RPC:${name}`); return { status: 501, data: { message: "unmocked RPC" } };
    }
  }

  async route(route: Route) {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const isApp = url.origin === "http://127.0.0.1:3101";
    const isRpc = url.origin === "http://127.0.0.1:4319" && path.startsWith("/rest/v1/rpc/");
    if (isApp && !path.startsWith("/api/") && !["/fixture.png", "/fixture.wav", "/fixture-cache.html"].includes(path)) return route.continue();
    if (!isApp && !isRpc) {
      this.unexpected.push(`network:${url.origin}${path}`);
      return route.abort("blockedbyclient");
    }
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": "*", "access-control-allow-headers": "*",
        "access-control-allow-methods": "POST, GET, OPTIONS",
      } });
    }
    if (path === "/fixture.png") return route.fulfill({ contentType: "image/png", body: testPng });
    if (path === "/fixture.wav") return route.fulfill({ contentType: "audio/wav", body: testAudio });
    if (path === "/fixture-cache.html") return route.fulfill({ contentType: "text/html",
      body: "<!doctype html><html><head><title>Synthetic cache regression</title></head><body></body></html>" });
    const body = (route.request().headers()["content-type"]?.includes("application/json")
      ? route.request().postDataJSON() ?? {} : {}) as Record<string, unknown>;
    const name = path.split("/").at(-1)!;
    this.calls.push(isRpc ? name : path);
    let reply: Reply;
    if (isRpc) reply = structuredClone(this.rpc(name, body));
    else if (path === "/api/media/sign") reply = { data: { url:
      String(body.ref).startsWith("storage://chat-audios/")
        ? "http://127.0.0.1:3101/fixture.wav" : "http://127.0.0.1:3101/fixture.png" } };
    else if (path === "/api/upload/avatar") reply = { data: { url: avatarRef } };
    else if (path === "/api/upload/image") reply = { data: {
      url: `storage://chat-images/family/${session.family_id}/fixture.png` } };
    else if (path === "/api/upload/audio") reply = { data: {
      url: `storage://chat-audios/family/${session.family_id}/fixture.webm` } };
    else if (path === "/api/push/presence" || path === "/api/schedule/collaboration-notify" ||
      path === "/api/push/send-message-notification") reply = { data: { ok: true } };
    else if (path === "/api/push/diagnostics") reply = { data: { ok: true, subscriptions: [], presence: null } };
    else { this.unexpected.push(`API:${path}`); reply = { status: 501, data: { error: "unmocked API" } }; }
    const hold = this.holds.find((entry) => entry.matches(path, body));
    if (hold) {
      this.holds.splice(this.holds.indexOf(hold), 1);
      hold.arrived.resolve();
      await hold.released.promise;
      if (hold.reply) reply = hold.reply;
    }
    await route.fulfill({ status: reply.status ?? 200, json: reply.data,
      headers: { "access-control-allow-origin": "*" } }).catch(() => undefined);
    hold?.finished.resolve();
  }

  socket(socket: WebSocketRoute) {
    socket.onMessage((raw) => {
      const parsed = JSON.parse(String(raw));
      const array = Array.isArray(parsed);
      const [joinRef, ref, topic, event, payload] = array ? parsed :
        [parsed.join_ref, parsed.ref, parsed.topic, parsed.event, parsed.payload];
      if (event === "phx_join") {
        const filters = (payload.config?.postgres_changes ?? []).map((filter: object, i: number) => ({ ...filter, id: i + 1 }));
        this.channels.push({ socket, topic, joinRef, array, filters });
        this.send(socket, array, joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: filters } });
      } else if (event === "heartbeat" || event === "phx_leave") {
        if (event === "phx_leave") this.channels = this.channels.filter((channel) => channel.topic !== topic);
        this.send(socket, array, joinRef, ref, topic, "phx_reply", { status: "ok", response: {} });
      }
    });
    socket.onClose(() => { this.channels = this.channels.filter((channel) => channel.socket !== socket); });
  }

  private send(socket: WebSocketRoute, array: boolean, joinRef: string, ref: string | null,
    topic: string, event: string, payload: unknown) {
    socket.send(JSON.stringify(array ? [joinRef, ref, topic, event, payload] :
      { join_ref: joinRef, ref, topic, event, payload }));
  }

  scheduleEvent(id = itemA) {
    for (const channel of this.channels) {
      const filter = channel.filters.find((entry) => entry.table === "family_schedule_events");
      if (!filter) continue;
      this.send(channel.socket, channel.array, channel.joinRef, null, channel.topic, "postgres_changes", {
        ids: [filter.id], data: { schema: "public", table: "family_schedule_events", type: "INSERT",
          commit_timestamp: new Date().toISOString(), columns: [], errors: null, old_record: {}, record: {
            id: crypto.randomUUID(), family_id: session.family_id, schedule_item_id: id,
            recipient_member_id: session.member_id, event_type: "updated",
          } },
      });
    }
  }

  messageEvent(messageId: string) {
    for (const channel of this.channels) {
      const filter = channel.filters.find((entry) => entry.table === "message_realtime_events");
      if (!filter) continue;
      this.send(channel.socket, channel.array, channel.joinRef, null, channel.topic, "postgres_changes", {
        ids: [filter.id], data: { schema: "public", table: "message_realtime_events", type: "INSERT",
          commit_timestamp: new Date().toISOString(), columns: [], errors: null, old_record: {}, record: {
            id: crypto.randomUUID(), family_id: session.family_id, message_id: messageId, event_type: "insert",
          } },
      });
    }
  }
}

export const test = base.extend<{ app: AppFixture }>({
  app: [async ({ context, page }, use) => {
    const app = new AppFixture();
    await context.addInitScript((local) => {
      if (location.origin !== "http://127.0.0.1:3101") return;
      if (!localStorage.getItem("family-chat:browser-fixture-initialized")) {
        localStorage.setItem("family-chat:session", JSON.stringify(local));
        localStorage.setItem("family-chat:browser-fixture-initialized", "1");
      }
      localStorage.setItem("family-chat:language", "zh");
    }, session);
    await context.route("**/*", (route) => app.route(route));
    await context.routeWebSocket("ws://127.0.0.1:4319/**", (socket) => app.socket(socket));
    page.on("pageerror", (error) => app.unexpected.push(`pageerror:${error.message}`));
    context.on("page", (extra) => extra.on("pageerror", (error) => app.unexpected.push(`pageerror:${error.message}`)));
    await use(app);
    expect(app.unexpected, "all external/API/RPC traffic must be explicitly mocked").toEqual([]);
  }, { auto: true }],
});
export { expect };
