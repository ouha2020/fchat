import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeChatMessage } from "@/lib/chatViewportObserver";

const cleanups: (() => void)[] = [];
let intersections: IntersectionObserverCallback[];
let sizes: ResizeObserverCallback[];
let observers: { unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[];

beforeEach(() => {
  intersections = [];
  sizes = [];
  observers = [];
  const install = (name: string, callbacks: unknown[]) => {
    vi.stubGlobal(name, class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(callback: unknown) { callbacks.push(callback); observers.push(this); }
    });
  };
  install("IntersectionObserver", intersections);
  install("ResizeObserver", sizes);
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

const row = (root: Element | null) => ({ closest: () => root }) as unknown as Element;
const callbacks = () => ({ visibility: vi.fn(), height: vi.fn() });
const observe = (element: Element, handlers = callbacks()) => {
  const cleanup = observeChatMessage(element, handlers);
  cleanups.push(cleanup);
  return cleanup;
};

describe("chat viewport observer lifecycle", () => {
  it("keeps observer resources bounded for 1000 messages and independent chats", () => {
    const root = {} as Element;
    for (let i = 0; i < 1000; i++) observe(row(root));
    expect(intersections).toHaveLength(1);
    expect(sizes).toHaveLength(1);
    observe(row({} as Element));
    expect(intersections).toHaveLength(2);
    expect(sizes).toHaveLength(2);
  });

  it("routes batched notifications and ignores detached rows and invalid heights", () => {
    const root = {} as Element;
    const first = row(root);
    const second = row(root);
    const a = callbacks();
    const b = callbacks();
    const removeA = observe(first, a);
    observe(second, b);
    removeA();
    intersections[0]([
      { target: first, isIntersecting: true },
      { target: second, isIntersecting: true },
    ] as IntersectionObserverEntry[], {} as IntersectionObserver);
    sizes[0]([
      { target: first, borderBoxSize: [{ blockSize: 100 }] },
      { target: second, borderBoxSize: [{ blockSize: 0 }] },
      { target: second, borderBoxSize: [{ blockSize: NaN }] },
      { target: second, borderBoxSize: [], contentRect: { height: 96 } },
    ] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    expect(a.visibility).not.toHaveBeenCalled();
    expect(a.height).not.toHaveBeenCalled();
    expect(b.visibility).toHaveBeenCalledWith(true);
    expect(b.height.mock.calls).toEqual([[96]]);
  });

  it("disconnects only after the last row and supports Strict Mode reattachment", () => {
    const root = {} as Element;
    const a = observe(row(root));
    const b = observe(row(root));
    a();
    expect(observers[0].disconnect).not.toHaveBeenCalled();
    b();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(observers[1].disconnect).toHaveBeenCalledTimes(1);
    b();
    observe(row(root));
    expect(intersections).toHaveLength(2);
    expect(sizes).toHaveLength(2);
  });

  it("loads media normally when observer APIs are unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("ResizeObserver", undefined);
    const handlers = callbacks();
    observe(row(null), handlers);
    expect(handlers.visibility).toHaveBeenCalledWith(true);
    expect(handlers.height).not.toHaveBeenCalled();
  });
});
