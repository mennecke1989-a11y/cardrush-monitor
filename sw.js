const CACHE_NAME = "cardrush-v4";
const ASSETS = ["./index.html", "./manifest.json", "./icons/icon192.png", "./icons/icon512.png"];

// ── Install & Cache ──────────────────────────────────────────────────────────
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  // Delete all old caches automatically
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  clients.claim();
});

// ── Fetch: network-first for the app HTML, cache fallback ─────────────────────
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Never cache calls to the proxy or translation API
  if (url.hostname.includes("workers.dev") || url.hostname.includes("googleapis.com")) {
    return; // let the browser handle it normally
  }
  // For app assets: try cache first, then network
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// ── Notification click: open the product/shop ─────────────────────────────────
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = e.notification.data?.url || "https://www.cardrush-op.jp/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      // Focus existing window if open, else open new
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
