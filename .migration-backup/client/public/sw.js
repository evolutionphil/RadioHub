// Service Worker for Push Notifications
const CACHE_NAME = 'megaradio-v1';

// Install event
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installed');
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker activated');
  event.waitUntil(self.clients.claim());
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