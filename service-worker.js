/* Sharda Setu — Service Worker (offline, cache, push, background sync) */
const CACHE_VERSION = "sharda-setu-v1";
const PRECACHE = "sharda-precache-v1";
const RUNTIME = "sharda-runtime-v1";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./pwa-offline.html",
  "./style.css",
  "./ui-enhancements.css",
  "./pwa.css",
  "./auth.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./assets/logo.svg",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg",
  "./login.html",
  "./offline.html",
  "./online-education.html",
  "./mock-tests.html",
  "./student-dashboard.html",
  "./profile.html",
  "./live-rooms.html",
  "./backend/data/education-fallback.js",
  "./backend/data/quiz-fallback.js"
];

function baseScope() {
  return self.registration.scope || "./";
}

function url(path) {
  return new URL(path, baseScope()).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS.map((p) => url(p))))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn("[SW] precache failed", err))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== PRECACHE && k !== RUNTIME && k.startsWith("sharda-"))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isApiRequest(req) {
  try {
    const u = new URL(req.url);
    return u.pathname.includes("/api/");
  } catch {
    return false;
  }
}

function isStaticAsset(req) {
  const p = new URL(req.url).pathname;
  return /\.(css|js|svg|png|jpg|webp|woff2?|html|webmanifest|json)$/i.test(p);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (isApiRequest(request)) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (isStaticAsset(request) || request.mode === "navigate") {
    event.respondWith(staleWhileRevalidateOrOffline(request));
    return;
  }
});

async function networkFirstApi(request) {
  try {
    const res = await fetch(request);
    return res;
  } catch {
    return new Response(
      JSON.stringify({ error: "Offline", offline: true }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function staleWhileRevalidateOrOffline(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((res) => {
      if (res && res.status === 200) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) {
    fetchPromise.catch(() => {});
    return cached;
  }

  const network = await fetchPromise;
  if (network) return network;

  if (request.mode === "navigate") {
    const offline = await caches.match(url("./pwa-offline.html"));
    if (offline) return offline;
  }

  return new Response("Offline", { status: 503, statusText: "Offline" });
}

/* Push notifications */
self.addEventListener("push", (event) => {
  let data = { title: "Sharda Setu", body: "New update", url: "./index.html" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    data.body = event.data?.text() || data.body;
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: url("./assets/icons/icon-192.svg"),
      badge: url("./assets/logo.svg"),
      data: { url: data.url || "./index.html" },
      tag: data.tag || "sharda-notification",
      renotify: true
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "./index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

/* Background sync — notify clients to flush queue */
self.addEventListener("sync", (event) => {
  if (event.tag === "sharda-background-sync") {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: "FLUSH_SYNC_QUEUE" }));
      })
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
