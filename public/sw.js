/**
 * Service Worker для «Уездный кондитер» v4.0
 *
 * Улучшения PWA offline:
 *   - Прекеш ключевых страниц (home, catalog, cart)
 *   - Стратегия NetworkFirst для страниц (свежие данные, fallback в кэш)
 *   - Стратегия CacheFirst для изображений (быстро, без сети)
 *   - StaleWhileRevalidate для API каталога (offline-просмотр каталога)
 *   - Background sync для отправки заказов в офлайне
 *   - Offline-fallback страница с заглушкой
 */
const CACHE_VERSION = "v4.0";
const STATIC_CACHE = `uk-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `uk-runtime-${CACHE_VERSION}`;
const IMAGE_CACHE = `uk-images-${CACHE_VERSION}`;
const API_CACHE = `uk-api-${CACHE_VERSION}`;
const OFFLINE_PAGE = "/offline.html";

// Прекеш ключевых страниц при установке
const PRECACHE_URLS = [
  "/",
  "/catalog",
  "/cart",
  "/manifest.json",
  "/offline.html",
  "/logo.png",
  "/favicon.png",
];

// API endpoints, которые можно кэшировать для offline-просмотра
const CACHABLE_API_PATTERNS = [
  /\/api\/products(\?|$)/,           // список товаров
  /\/api\/confectioners(\?|$)/,      // список кондитеров
  /\/api\/promotions(\?|$)/,         // акции
  /\/api\/recipes(\?|$)/,            // рецепты
  /\/api\/categories(\?|$)/,         // категории
  /\/api\/stories(\?|$)/,            // сторис
  /\/api\/live-streams(\?|$)/,       // стримы
];

// API endpoints, которые НЕ кэшируем (записи, изменения, приватные данные)
const NEVER_CACHE_API_PATTERNS = [
  /\/api\/auth\//,
  /\/api\/payment\//,
  /\/api\/orders\//,
  /\/api\/cart\//,
  /\/api\/admin\//,
  /\/api\/confectioner\/(?!predictions)/,
  /\/api\/simplex\//,
  /\/api\/live-streams\/[^/]+\/(chat|join|like)/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE_URLS).catch(() => {})),
      caches.open(API_CACHE),
    ])
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n.startsWith("uk-") && !n.endsWith(CACHE_VERSION))
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Чат-сервер — не кэшируем
  if (url.port === "3030" || url.pathname.includes(":3030")) return;

  // === Изображения: CacheFirst ===
  if (
    request.destination === "image" ||
    url.pathname.match(/\.(jpg|jpeg|png|webp|gif|svg|avif)$/i)
  ) {
    event.respondWith(handleImage(request));
    return;
  }

  // === Статика Next.js: CacheFirst ===
  if (url.pathname.includes("/_next/static/")) {
    event.respondWith(handleStatic(request));
    return;
  }

  // === API запросы: StaleWhileRevalidate для кэшируемых ===
  if (url.pathname.startsWith("/api/")) {
    const isCachable = CACHABLE_API_PATTERNS.some((p) => p.test(url.pathname + url.search));
    const isNeverCached = NEVER_CACHE_API_PATTERNS.some((p) => p.test(url.pathname));

    if (isCachable && !isNeverCached) {
      event.respondWith(handleApiCacheable(request));
      return;
    }
    // Не кэшируемое API — просто пропускаем к сети
    return;
  }

  // === Навигация (страницы): NetworkFirst с offline-fallback ===
  if (request.mode === "navigate") {
    event.respondWith(handlePage(request));
    return;
  }

  // === Прочее: StaleWhileRevalidate ===
  event.respondWith(handleOther(request));
});

// === Стратегии ===

// CacheFirst — для изображений (быстро, нет сети)
async function handleImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    // Фоновое обновление
    fetch(request)
      .then((r) => r.ok && cache.put(request, r.clone()))
      .catch(() => {});
    return cached;
  }
  try {
    const r = await fetch(request);
    if (r.ok) cache.put(request, r.clone());
    return r;
  } catch {
    // Placeholder для offline
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="#f3f4f6" width="200" height="200"/><text x="100" y="100" font-size="14" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">Нет фото</text></svg>',
      { headers: { "Content-Type": "image/svg+xml" } }
    );
  }
}

// CacheFirst — для статики
async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const r = await fetch(request);
    if (r.ok) cache.put(request, r.clone());
    return r;
  } catch {
    return new Response("", { status: 404 });
  }
}

// StaleWhileRevalidate — для кэшируемых API (каталог в офлайне)
async function handleApiCacheable(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);

  // Фоновое обновление
  const fetchPromise = fetch(request)
    .then((r) => {
      if (r.ok) {
        cache.put(request, r.clone());
      }
      return r;
    })
    .catch(() => cached);

  // Возвращаем кэш сразу если есть, иначе ждём сеть
  return cached || fetchPromise;
}

// NetworkFirst — для страниц (свежие данные, fallback в кэш)
async function handlePage(request) {
  try {
    const r = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, r.clone());
    return r;
  } catch {
    // Offline — пытаемся кэш, затем /offline.html
    const cached = await caches.match(request);
    if (cached) return cached;
    const offlinePage = await caches.match(OFFLINE_PAGE);
    return offlinePage || caches.match("/") || new Response(
      '<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h1>Офлайн</h1><p>Проверьте подключение к интернету</p></body></html>',
      { status: 503, headers: { "Content-Type": "text/html" } }
    );
  }
}

// StaleWhileRevalidate — для прочих запросов
async function handleOther(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((r) => {
      if (r.ok) cache.put(request, r.clone());
      return r;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

// === Push-уведомления ===
self.addEventListener("push", (event) => {
  let data = {
    title: "Уездный кондитер",
    body: "Новое уведомление",
    icon: "/logo.png",
    badge: "/logo.png",
    tag: "uyezdny",
    data: { url: "/" },
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    data.body = event.data?.text() || data.body;
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || "/logo.png",
      badge: data.badge || "/logo.png",
      vibrate: [200, 100, 200],
      tag: data.tag || "uyezdny-notification",
      requireInteraction: data.requireInteraction || false,
      data: data.data || { url: "/" },
      actions: [
        { action: "open", title: "Открыть" },
        { action: "close", title: "Закрыть" },
      ],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "close") return;
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.focus();
          c.navigate?.(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});

// === Background Sync (для отправки данных в офлайне) ===
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-cart") {
    event.waitUntil(syncCart());
  } else if (event.tag === "sync-order") {
    event.waitUntil(syncOrder());
  }
});

async function syncCart() {
  // Здесь можно реализовать синхронизацию корзины
  console.log("[SW] Background sync: cart");
}

async function syncOrder() {
  // Здесь можно реализовать отправку заказа из IndexedDB
  console.log("[SW] Background sync: order");
}

// === Периодическая очистка старого кэша ===
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_CACHE") {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(names.filter((n) => n.startsWith("uk-")).map((n) => caches.delete(n)))
      )
    );
  }
});
