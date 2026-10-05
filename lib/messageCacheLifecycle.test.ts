import { afterEach, describe, expect, it, vi } from "vitest";
import { captureMessageCacheContext, invalidateMessageCacheContext, isMessageContextCurrent,
  messageVersionKey, watchMessageContext } from "@/lib/messageCacheLifecycle";
import { installLocalSession } from "@/tests/helpers/localSession";
import { makeSession } from "@/tests/helpers/messages";

afterEach(() => vi.unstubAllGlobals());

describe("message operations keep their original identity and version", () => {
  it("invalidates logout/relogin with the same credentials and admits new work", () => {
    const session = makeSession(); const local = installLocalSession(session);
    const old = captureMessageCacheContext(session);
    invalidateMessageCacheContext(session); local.setSession(null); local.setSession(session);
    expect(isMessageContextCurrent(old)).toBe(false);
    expect(isMessageContextCurrent(captureMessageCacheContext(session))).toBe(true);
    expect([...local.data.values()].filter((value) => value.includes(session.member_token))).toHaveLength(1);
  });

  it.each([{ member_id: "bob" }, { family_id: "other" }, { member_token: "replacement" }])(
    "rejects work when identity changes: %j", (change) => {
      const session = makeSession(); const local = installLocalSession(session);
      const context = captureMessageCacheContext(session); local.setSession(makeSession(change));
      expect(isMessageContextCurrent(context)).toBe(false);
    },
  );

  it("keeps profile refreshes valid", () => {
    const session = makeSession(); const local = installLocalSession(session);
    const context = captureMessageCacheContext(session);
    local.setSession(makeSession({ nickname: "New name", family_name: "New family label" }));
    expect(isMessageContextCurrent(context)).toBe(true);
  });

  it("checks shared versions before the other tab's storage event arrives", () => {
    const session = makeSession(); const local = installLocalSession(session);
    const context = captureMessageCacheContext(session); const invalid = vi.fn();
    const release = watchMessageContext(context, invalid);
    local.localStorage.setItem(messageVersionKey(session), "other-tab-version");
    expect(isMessageContextCurrent(context)).toBe(false);
    local.storageEvent(messageVersionKey(session)); expect(invalid).toHaveBeenCalledOnce();
    release(); local.storageEvent(messageVersionKey(session)); expect(invalid).toHaveBeenCalledOnce();
  });

  it("disables persistent caching when version metadata cannot be written", () => {
    const session = makeSession(); const local = installLocalSession(session);
    local.localStorage.setItem.mockImplementation(() => { throw new Error("storage unavailable"); });
    const context = captureMessageCacheContext(session);
    expect(context.version).toBeNull(); expect(isMessageContextCurrent(context)).toBe(true);
    invalidateMessageCacheContext(session); expect(isMessageContextCurrent(context)).toBe(false);
  });
});
