const CACHE_NAME = "cardrush-v1";
const ASSETS = ["./index.html", "./manifest.json", "./icons/icon192.png", "./icons/icon512.png"];

// ── Install & Cache ──────────────────────────────────────────────────────────
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(clients.claim());
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// ── Periodic Background Sync ──────────────────────────────────────────────────
self.addEventListener("periodicsync", e => {
  if (e.tag === "cardrush-check") {
    e.waitUntil(runCheck());
  }
});

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener("push", e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || "CardRush", {
      body: data.body || "",
      icon: "./icons/icon192.png",
      badge: "./icons/icon48.png",
      data: data
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || "https://www.cardrush-op.jp/";
  e.waitUntil(clients.openWindow(url));
});

// ── Message from main thread: run check ──────────────────────────────────────
self.addEventListener("message", e => {
  if (e.data?.action === "check") {
    runCheck().then(() => e.source?.postMessage({ action: "checkDone" }));
  }
});

// ── Core check logic ──────────────────────────────────────────────────────────
async function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("cardrush", 2);
    req.onupgradeneeded = ev => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
    };
    req.onsuccess = ev => resolve(ev.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(db, key) {
  return new Promise((resolve) => {
    const tx = db.transaction("state", "readonly");
    const req = tx.objectStore("state").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function dbSet(db, key, value) {
  return new Promise((resolve) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put(value, key);
    tx.oncomplete = resolve;
  });
}

function parseProductPage(html, url) {
  const priceMatch = html.match(/product:price:amount[^>]+content="(\d+)"/);
  const price = priceMatch ? parseInt(priceMatch[1]) : null;
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const name = titleMatch ? titleMatch[1].replace(/ - カードラッシュ ワンピース/, "").trim() : url;
  const soldOut =
    /売り切れ|在庫なし|soldout|sold.out|入荷待ち/i.test(html) ||
    price === null || price === 0;
  return { name, price, inStock: !soldOut };
}

async function checkWatchedProduct(item) {
  try {
    const res = await fetch(item.url, { cache: "no-store" });
    const html = await res.text();
    const { name, price, inStock } = parseProductPage(html, item.url);
    return { ...item, name, price, inStock };
  } catch {
    return item;
  }
}

async function runCheck() {
  const db = await getDB();
  const watchlist = (await dbGet(db, "watchlist")) || [];
  if (watchlist.length === 0) return;

  const now = Date.now();
  const updated = await Promise.all(watchlist.map(checkWatchedProduct));
  const newRestocks = [];
  const newPriceChanges = [];

  updated.forEach((item, i) => {
    const prev = watchlist[i];

    // Restock
    if (!prev.inStock && item.inStock) {
      newRestocks.push(item);
      self.registration.showNotification("✅ CardRush – Wieder verfügbar!", {
        body: item.name + (item.price ? ` · ¥${item.price}` : ""),
        icon: "./icons/icon192.png",
        data: { url: item.url }
      });
    }

    // Price change
    if (prev.price && item.price && prev.price !== item.price) {
      const cheaper = item.price < prev.price;
      const pct = Math.round(Math.abs(item.price - prev.price) / prev.price * 100);
      newPriceChanges.push({ ...item, oldPrice: prev.price, priceChangedAt: now });
      self.registration.showNotification(
        cheaper ? "💚 CardRush – Preis gesunken ↓" : "🔴 CardRush – Preis gestiegen ↑",
        {
          body: `${item.name}\n¥${prev.price} → ¥${item.price} (${cheaper ? "-" : "+"}${pct}%)`,
          icon: "./icons/icon192.png",
          data: { url: item.url }
        }
      );
    }
  });

  await dbSet(db, "watchlist", updated);

  if (newRestocks.length > 0) {
    const prev = (await dbGet(db, "restockAlerts")) || [];
    await dbSet(db, "restockAlerts", [...newRestocks, ...prev].slice(0, 20));
  }
  if (newPriceChanges.length > 0) {
    const prev = (await dbGet(db, "priceAlerts")) || [];
    await dbSet(db, "priceAlerts", [...newPriceChanges, ...prev].slice(0, 20));
  }
  await dbSet(db, "lastCheck", now);
}
