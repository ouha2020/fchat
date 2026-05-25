const PRECACHE = "family-chat-precache-v10";
const RUNTIME = "family-chat-runtime-v10";

const PUSH_RECEIVED = "family-chat:push-received";
const SCHEDULE_REMINDER_RECEIVED = "family-chat:schedule-reminder";
const CLOSE_NOTIFICATIONS = "family-chat:close-notifications";

const PRECACHE_URLS = [
  "/offline",
  "/icon.png",
  "/apple-icon.png",
  "/ui-icons/image.png",
  "/ui-icons/location.png",
  "/ui-icons/me.png",
  "/ui-icons/members.png",
  "/ui-icons/notify-off.png",
  "/ui-icons/notify-on.png",
  "/ui-icons/plus.png",
  "/ui-icons/schedule.png",
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
      type: data.type || "message",
      url: data.url || "/chat",
      familyId: data.familyId || null,
      messageId: data.messageId || null,
      scheduleItemId: data.scheduleItemId || null,
    },
  };

  event.waitUntil(deliverForegroundOrNotify(title, options));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== CLOSE_NOTIFICATIONS) return;
  event.waitUntil(closeNotifications(data));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const baseUrl = data.url || "/chat";
  const messageId = data.messageId || null;
  const scheduleItemId = data.scheduleItemId || null;
  const familyId = data.familyId || null;
  const isScheduleReminder =
    data.type === "schedule-reminder" || Boolean(scheduleItemId);
  const targetUrl = isScheduleReminder
    ? scheduleItemId
      ? `/schedule?item=${encodeURIComponent(scheduleItemId)}`
      : baseUrl || "/schedule"
    : messageId
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
              focusedClient.postMessage(
                buildClientPushMessage({
                  isScheduleReminder,
                  familyId,
                  messageId,
                  scheduleItemId,
                }),
              );
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
  const visibleAppClients = await getVisibleAppWindowClients();
  if (visibleAppClients.length > 0) {
    visibleAppClients.forEach((client) => {
      client.postMessage(
        buildClientPushMessage({
          isScheduleReminder: options.data.type === "schedule-reminder",
          familyId: options.data.familyId,
          messageId: options.data.messageId,
          scheduleItemId: options.data.scheduleItemId,
        }),
      );
    });
    return;
  }

  return self.registration.showNotification(title, options);
}

async function closeNotifications(data) {
  if (typeof self.registration.getNotifications !== "function") return;

  const familyId = data.familyId ? String(data.familyId) : null;
  const messageIds = Array.isArray(data.messageIds)
    ? data.messageIds.filter(Boolean).map(String)
    : [];
  const messageIdSet = new Set(messageIds);
  const closeAllForFamily = data.closeAllForFamily === true;

  if (!familyId && messageIdSet.size === 0) return;
  if (!closeAllForFamily && messageIdSet.size === 0) return;

  try {
    const notifications = await self.registration.getNotifications();
    notifications.forEach((notification) => {
      if (
        shouldCloseChatNotification(notification, {
          familyId,
          messageIdSet,
          closeAllForFamily,
        })
      ) {
        notification.close();
      }
    });
  } catch {
    // Notification cleanup is best-effort; never break the app flow.
  }
}

function shouldCloseChatNotification(
  notification,
  { familyId, messageIdSet, closeAllForFamily },
) {
  const data = notification.data || {};
  const notificationFamilyId = data.familyId ? String(data.familyId) : null;
  const isScheduleReminder =
    data.type === "schedule-reminder" || Boolean(data.scheduleItemId);

  if (isScheduleReminder) return false;
  if (familyId && notificationFamilyId !== familyId) return false;

  if (closeAllForFamily) return true;

  const notificationMessageId = data.messageId ? String(data.messageId) : null;
  if (notificationMessageId && messageIdSet.has(notificationMessageId)) {
    return true;
  }

  const tag = notification.tag || "";
  for (const messageId of messageIdSet) {
    if (tag.includes(messageId)) return true;
  }

  return false;
}

function buildClientPushMessage({
  isScheduleReminder,
  familyId,
  messageId,
  scheduleItemId,
}) {
  if (isScheduleReminder) {
    return {
      type: SCHEDULE_REMINDER_RECEIVED,
      familyId,
      scheduleItemId,
    };
  }
  return {
    type: PUSH_RECEIVED,
    familyId,
    messageId,
  };
}

async function getVisibleAppWindowClients() {
  const clientList = await clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  return clientList.filter((client) => {
    if (client.visibilityState !== "visible") return false;
    try {
      const clientUrl = new URL(client.url);
      return clientUrl.origin === self.location.origin;
    } catch {
      return false;
    }
  });
}
