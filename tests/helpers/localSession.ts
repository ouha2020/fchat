import { vi } from "vitest";
import type { LocalSession } from "@/lib/authLocal";

export function installLocalSession(session: LocalSession) {
  const data = new Map<string, string>();
  const events = new EventTarget();
  const localStorage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn((key: string) => { data.delete(key); }),
  };
  vi.stubGlobal("window", { localStorage,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events) });
  const setSession = (next: LocalSession | null) => {
    if (next) data.set("family-chat:session", JSON.stringify(next));
    else data.delete("family-chat:session");
  };
  setSession(session);
  return { data, localStorage, setSession, storageEvent: (key: string) => {
    const event = new Event("storage"); Object.defineProperty(event, "key", { value: key });
    events.dispatchEvent(event);
  } };
}
