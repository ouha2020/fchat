// This page is precached by the service worker and served as the navigation
// fallback when a fetch fails. In that situation the page's own JS chunks may
// not be cached, so React hydration cannot be relied on — all interactivity
// lives in the inline script below, and links are plain anchors.
const AUTO_RELOAD_SCRIPT = `
(function () {
  var KEY = "family-chat:offline-auto-reload";
  var MAX_AUTO_RELOADS = 3;
  var WINDOW_MS = 60000;

  function allowAutoReload() {
    try {
      var now = Date.now();
      var state = JSON.parse(sessionStorage.getItem(KEY) || "null") || {
        count: 0,
        since: now,
      };
      if (now - state.since > WINDOW_MS) {
        state = { count: 0, since: now };
      }
      if (state.count >= MAX_AUTO_RELOADS) return false;
      state.count += 1;
      sessionStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return true;
    }
  }

  function reload() {
    location.reload();
  }

  function autoReload() {
    if (allowAutoReload()) reload();
  }

  // The service worker leaves non-navigation same-origin requests to "/"
  // untouched, so this HEAD request tests the real network, not the cache.
  function probeNetwork() {
    if (navigator.onLine === false) return;
    fetch("/", { method: "HEAD", cache: "no-store" })
      .then(function (res) {
        if (res && res.ok) autoReload();
      })
      .catch(function () {});
  }

  var button = document.getElementById("offline-reload");
  if (button) {
    button.addEventListener("click", reload);
  }
  window.addEventListener("online", autoReload);
  setTimeout(probeNetwork, 1500);
  setInterval(probeNetwork, 5000);
})();
`;

export default function OfflinePage() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-6 py-12 text-center">
      <div className="section-card w-full max-w-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl">
          !
        </div>
        <h1 className="text-xl font-bold text-slate-900">当前处于离线状态</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          网络恢复后会自动重新加载，聊天和日程会继续同步。你也可以点击下方按钮重试。
        </p>
        <button id="offline-reload" type="button" className="btn-primary mt-5 w-full">
          重新加载
        </button>
        <a
          href="/"
          className="mt-3 inline-block w-full text-sm font-medium text-brand-600"
        >
          返回首页
        </a>
      </div>
      <script dangerouslySetInnerHTML={{ __html: AUTO_RELOAD_SCRIPT }} />
    </main>
  );
}
