const PRECACHE = "family-chat-precache-v1";
const RUNTIME = "family-chat-runtime-v1";

const PRECACHE_URLS = [
  "/",
  "/offline",
  "/icon.png",
  "/apple-icon.png",
  "/ui-icons/image.png",
  "/ui-icons/location.png",
  "/ui-icons/members.png",
  "/ui-icons/notify-off.png",
  "/ui-icons/notify-on.png",
  "/ui-icons/plus.png",
  "/ui-icons/settings.png",
  "/ui-icons/voice.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            cache.add(new Request(url, { cache: "reload" })),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== PRECACHE && key !== RUNTIME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "家族チャット";
  const options = {
    body: data.body || "新しい通知があります",
    icon: "/icon.png",
    badge: "/icon.png",
    tag: data.tag || "family-chat",
    renotify: false,
    data: {
      url: data.url || "/chat",
    },
  };

  event.waitUntil(showNotificationUnlessAppVisible(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/chat";
  const absoluteUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === absoluteUrl && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(absoluteUrl);
        }
        return undefined;
      }),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/ui-icons/") ||
    url.pathname === "/icon.png" ||
    url.pathname === "/apple-icon.png" ||
    url.pathname === "/manifest.webmanifest"
  );
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return (
      (await caches.match("/offline")) ||
      new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(RUNTIME);
    cache.put(request, response.clone());
  }
  return response;
}

async function showNotificationUnlessAppVisible(title, options) {
  if (await hasVisibleWindowClient()) return;
  return self.registration.showNotification(title, options);
}

async function hasVisibleWindowClient() {
  const clientList = await clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  return clientList.some((client) => client.visibilityState === "visible");
}
