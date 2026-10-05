type RowCallbacks = {
  visibility: (visible: boolean) => void;
  height: (height: number) => void;
};

type ObserverPool = {
  rows: Map<Element, RowCallbacks>;
  intersection: IntersectionObserver | null;
  resize: ResizeObserver | null;
};

const pools = new Map<Element | null, ObserverPool>();

/** Share observers within a chat scroll container, releasing them with its last row. */
export function observeChatMessage(element: Element, callbacks: RowCallbacks): () => void {
  const root = element.closest("[data-chat-scroll]");
  let pool = pools.get(root);
  if (!pool) {
    const rows = new Map<Element, RowCallbacks>();
    pool = {
      rows,
      intersection: typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(
        (entries) => {
          for (const entry of entries) rows.get(entry.target)?.visibility(entry.isIntersecting);
        },
        { root, rootMargin: "600px 0px" },
      ),
      resize: typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
        for (const entry of entries) {
          const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
          if (Number.isFinite(height) && height > 0) rows.get(entry.target)?.height(height);
        }
      }),
    };
    pools.set(root, pool);
  }
  const activePool = pool;
  activePool.rows.set(element, callbacks);
  if (activePool.intersection) activePool.intersection.observe(element);
  else callbacks.visibility(true);
  activePool.resize?.observe(element);

  return () => {
    // A queued notification must not update a row after it was removed.
    if (activePool.rows.get(element) !== callbacks) return;
    activePool.rows.delete(element);
    activePool.intersection?.unobserve(element);
    activePool.resize?.unobserve(element);
    if (activePool.rows.size === 0) {
      activePool.intersection?.disconnect();
      activePool.resize?.disconnect();
      pools.delete(root);
    }
  };
}
