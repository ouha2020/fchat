const PRECACHE = "family-chat-precache-v8";
const RUNTIME = "family-chat-runtime-v8";

const PUSH_RECEIVED = "family-chat:push-received";

const PRECACHE_URLS = [
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

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const newSubscription = await self.registration.pushManager.subscribe(
          event.oldSubscription.options,
        );
        const clients = await self.clients.matchAll({ type: "window" });
        clients.forEach((client) => {
          client.postMessage({
            type: "family-chat:subscription-changed",
            oldEndpoint: event.oldSubscription?.endpoint ?? null,
            newEndpoint: newSubscription.endpoint,
          });
        });
      } catch {
        self.clients.matchAll({ type: "window" }).then((windowClients) => {
          windowClients.forEach((client) => {
            client.postMessage({
              type: "family-chat:subscription-expired",
              endpoint: event.oldSubscription?.endpoint ?? null,
            });
          });
        });
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  const data = readPushData(event);
  const title = data.title || "\u5bb6\u5ead\u804a\u5929";
  const options = {
    body: data.body || "\u6709\u65b0\u6d88\u606f",
    icon: "/icon.png",
    badge: "/icon.png",
    tag: data.tag || "family-chat",
    renotify: false,
    data: {
      url: data.url || "/chat",
      familyId: data.familyId || null,
      messageId: data.messageId || null,
    },
  };

  event.waitUntil(deliverForegroundOrNotify(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const baseUrl = data.url || "/chat";
  const messageId = data.messageId || null;
  const familyId = data.familyId || null;
  const targetUrl = messageId
    ? `${baseUrl}?mid=${encodeURIComponent(messageId)}`
    : baseUrl;
  const absoluteUrl = new URL(targetUrl, self.location.origin).href;
  const targetPath = new URL(targetUrl, self.location.origin).pathname;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          try {
            const clientUrl = new URL(client.url);
            if (
              clientUrl.origin === self.location.origin &&
              clientUrl.pathname === targetPath &&
              "focus" in client
            ) {
              let targetClient = client;
              if ("navigate" in client && client.url !== absoluteUrl) {
                targetClient =
                  (await client.navigate(absoluteUrl).catch(() => client)) ||
                  client;
              }
              const focusedClient = await targetClient.focus();
              focusedClient.postMessage({
                type: PUSH_RECEIVED,
                familyId,
                messageId,
              });
              return focusedClient;
            }
          } catch {
            // ignore
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(absoluteUrl);
        }
        return undefined;
      }),
  );
});

function readPushData(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return {};
  }
}

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
    return await fetch(request);
  } catch {
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

async function deliverForegroundOrNotify(title, options) {
  const visibleChatClients = await getVisibleChatWindowClients(
    options.data.url || "/chat",
  );
  if (visibleChatClients.length > 0) {
    visibleChatClients.forEach((client) => {
      client.postMessage({
        type: PUSH_RECEIVED,
        familyId: options.data.familyId,
        messageId: options.data.messageId,
      });
    });
    return;
  }

  return self.registration.showNotification(title, options);
}

async function getVisibleChatWindowClients(targetUrl) {
  const targetPath = new URL(targetUrl || "/chat", self.location.origin).pathname;
  const clientList = await clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  return clientList.filter((client) => {
    if (client.visibilityState !== "visible") return false;
    try {
      const clientUrl = new URL(client.url);
      return (
        clientUrl.origin === self.location.origin &&
        clientUrl.pathname === targetPath
      );
    } catch {
      return false;
    }
  });
}
