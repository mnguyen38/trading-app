const CACHE = "trading-lab-v1";

// App shell routes to precache on install
const PRECACHE = ["/offline"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip cross-origin requests and API/SSE routes entirely — never cache these
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Network-first for page navigations; fall back to offline shell
    e.respondWith(
      fetch(request).catch(
        () => caches.match("/offline") ?? new Response("Offline", { status: 503 }),
      ),
    );
    return;
  }

// Push notifications
self.addEventListener("push", (e) => {
  if (!e.data) return;
  const { title, body, url } = e.data.json();
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? "/";
  e.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url.includes(url));
        if (existing) return existing.focus();
        return self.clients.openWindow(url);
      }),
  );
});

  // Cache-first for static assets (_next/static, images, fonts, public files)
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"))) {
          caches.open(CACHE).then((c) => c.put(request, res.clone()));
        }
        return res;
      });
    }),
  );
});
