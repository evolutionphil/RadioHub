// Service Worker for Push Notifications + static asset caching.
//
// Cache strategy:
//  - /assets/*.js, /assets/*.css, /fonts/*  → cache-first, populated on miss.
//    These files are content-hashed by Vite so we never have to invalidate
//    them — the HTML simply points at a new filename when content changes.
//  - everything else → network (no caching). Critically: HTML, /api/*, /ws/*,
//    /sitemap*, /robots.txt, /station-images/*, /station-logos/* must NEVER
//    be cached here, otherwise updates / SSR responses go stale.
//
// Bump CACHE_NAME whenever the cacheable URL set changes so old caches are
// purged on activate.
const CACHE_NAME = 'megaradio-v2';
const ASSET_CACHE = 'megaradio-assets-v1';

const CACHEABLE_PATH_RE = /^\/(?:assets|fonts)\//;

// Install event
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installed');
  self.skipWaiting();
});

// Activate event — purge any old MEGARADIO caches not in our current set so
// users on the previous SW don't keep stale responses.
//
// 2026-05-12 hardening: previous version deleted EVERY CacheStorage entry
// not in our current set. Because CacheStorage is origin-wide, that was
// silently evicting caches owned by other workers (notably Partytown's
// `~partytown` cache when we add it, plus any future browser/extension
// caches). Now we only touch caches whose names start with our own
// `megaradio-` prefix.
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker activated');
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('megaradio-') && k !== CACHE_NAME && k !== ASSET_CACHE)
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

// Fetch handler — cache-first for static hashed assets, network for the rest.
// Wrapped in try/catch so any unexpected error falls through to the network
// instead of breaking the page.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!CACHEABLE_PATH_RE.test(url.pathname)) return;

  event.respondWith((async () => {
    try {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      // Only cache successful, basic (same-origin) responses.
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      // Network failed and nothing in cache — let the browser surface its
      // own offline error rather than synthesizing one here.
      return fetch(req);
    }
  })());
});

// Push notification event
self.addEventListener('push', (event) => {
  console.log('📨 Push notification received:', event);

  if (!event.data) {
    console.log('❌ No data in push notification');
    return;
  }

  let data;
  try {
    data = event.data.json();
  } catch (error) {
    console.error('❌ Failed to parse push notification data:', error);
    return;
  }

  const options = {
    body: data.body || 'New notification',
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    image: data.image,
    tag: data.tag || 'default',
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
    data: {
      url: data.url || '/',
      ...data.data
    },
    timestamp: data.timestamp || Date.now()
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Megaradio', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('🖱️ Notification clicked:', event);

  const notification = event.notification;
  const action = event.action;
  const data = notification.data;

  notification.close();

  if (action === 'play') {
    // Handle play action
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            client.postMessage({
              type: 'NOTIFICATION_ACTION',
              action: 'play',
              data: data
            });
            return client.focus();
          }
        }
        // If no window is open, open a new one
        return self.clients.openWindow(data.url || '/');
      })
    );
  } else if (action === 'favorite') {
    // Handle favorite action
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            client.postMessage({
              type: 'NOTIFICATION_ACTION',
              action: 'favorite',
              data: data
            });
            return client.focus();
          }
        }
      })
    );
  } else if (action === 'explore') {
    // Handle explore action
    event.waitUntil(
      self.clients.openWindow('/')
    );
  } else {
    // Default click behavior
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            return client.focus();
          }
        }
        // If no window is open, open a new one
        return self.clients.openWindow(data.url || '/');
      })
    );
  }
});

// Notification close event
self.addEventListener('notificationclose', (event) => {
  console.log('❌ Notification closed:', event.notification.tag);
});

// Background sync for offline notifications
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    console.log('🔄 Background sync triggered');
    event.waitUntil(doBackgroundSync());
  }
});

function doBackgroundSync() {
  // Sync any pending data when coming back online
  return fetch('/api/user/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      timestamp: Date.now()
    })
  }).catch(err => {
    console.log('Background sync failed:', err);
  });
}

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  // BACKGROUND AUDIO: Handle keep-alive messages for persistent background playback
  if (event.data && event.data.type === 'KEEP_ALIVE') {
    console.log('💓 Keep-alive received at:', new Date(event.data.timestamp).toLocaleTimeString());
    // Respond to acknowledge keep-alive (prevents service worker termination)
    event.ports[0]?.postMessage({
      type: 'KEEP_ALIVE_ACK',
      timestamp: Date.now()
    });
  }
});

console.log('🚀 Service Worker script loaded');
