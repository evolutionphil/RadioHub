// Radio Station Push Notification Service Worker

const CACHE_NAME = 'radio-station-notifications-v1';

// Install event
self.addEventListener('install', (event) => {
  console.log('[SW] Service Worker installing...');
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker activating...');
  event.waitUntil(self.clients.claim());
});

// Push event - when we receive a push notification
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received:', event);
  
  if (!event.data) {
    console.log('[SW] Push event but no data');
    return;
  }

  let data;
  try {
    data = event.data.json();
  } catch (error) {
    console.error('[SW] Error parsing push data:', error);
    data = {
      title: 'Radio Station Update',
      body: event.data.text() || 'You have a new notification',
      icon: '/favicon.ico',
      badge: '/favicon.ico'
    };
  }

  const options = {
    body: data.body || 'New radio station update',
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    image: data.image || null,
    data: data.data || {},
    actions: data.actions || [
      {
        action: 'open',
        title: 'Open App'
      }
    ],
    requireInteraction: true,
    silent: false,
    tag: data.tag || 'radio-notification',
    renotify: true
  };

  const title = data.title || 'Radio Station Update';

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);
  
  event.notification.close();
  
  const action = event.action;
  const data = event.notification.data || {};
  
  // Handle different actions
  if (action === 'play' && data.stationId) {
    // Send message to client to play station
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'notification-play',
            stationId: data.stationId
          });
        });
      })
    );
  } else if (action === 'favorite' && data.stationId) {
    // Send message to client to favorite station
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'notification-favorite',
            stationId: data.stationId
          });
        });
      })
    );
  } else {
    // Default action - open the app
    const urlToOpen = data.url || '/';
    
    event.waitUntil(
      self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      }).then(windowClients => {
        // Check if there's already a window/tab open with the target URL
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        
        // If not, open a new window/tab
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
    );
  }
});

// Background sync (for offline functionality - optional)
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Perform background sync tasks
      console.log('[SW] Performing background sync...')
    );
  }
});

// 🚀 Fetch event: Cache external resources for better performance on repeat visits
const EXTERNAL_CACHE = 'mega-radio-external-v1';
const EXTERNAL_DOMAINS = [
  'somafm.com', 'dancewave.online', 'wikimedia.org', 'upload.wikimedia.org',
  'mixcloud.com', 'thumbnailer.mixcloud.com', 'ahrefs.com', 'analytics.ahrefs.com',
  'static-assets.npr.org', 's3.amazonaws.com', 's3-eu-west-1.amazonaws.com'
];

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only cache GET requests
  if (request.method !== 'GET') return;

  // Check if URL is from external domain
  const isExternal = EXTERNAL_DOMAINS.some(domain => url.hostname.includes(domain));

  if (isExternal && (request.destination === 'image' || request.destination === 'script' || request.destination === '')) {
    // Cache-first strategy for external resources (improves repeat visit performance)
    event.respondWith(
      caches.open(EXTERNAL_CACHE).then((cache) => {
        return cache.match(request).then((response) => {
          if (response) {
            console.log(`[SW] Cached: ${url.hostname}${url.pathname}`);
            return response;
          }

          return fetch(request).then((response) => {
            if (response && response.status === 200) {
              cache.put(request, response.clone()).catch(() => {
                // Cache write failed (quota exceeded), continue anyway
              });
            }
            return response;
          }).catch(() => {
            // Offline: return cached response if available
            return cache.match(request).catch(() => {
              return new Response('Offline - resource not cached', { status: 503 });
            });
          });
        });
      })
    );
  }
});

// Message handling from main thread
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  const { type, payload } = event.data;
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'GET_VERSION':
      event.ports[0].postMessage({ version: CACHE_NAME });
      break;
    case 'KEEP_ALIVE':
      console.log('[SW] Keep-alive received - maintaining background audio');
      break;
    default:
      console.log('[SW] Unknown message type:', type);
  }
});