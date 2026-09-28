const CACHE_NAME = 'ciclofit-static-v37';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './css/premium-visual.css',
  './css/atelier-visual.css',
  './js/cloud-config.js',
  './js/cloud-sync.js',
  './js/app.js',
  './assets/ciclofit-logo3.png',
  './assets/restx-alert.wav',
  './assets/restx-keepalive.wav',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
let restTimerId=0;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  const live = /\.(js|css|html)$/.test(url.pathname) || url.pathname.endsWith('/');
  event.respondWith(
    live
      ? fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        }).catch(() => caches.match(request))
      : caches.match(request).then(cached => {
          const network = fetch(request).then(response => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
            }
            return response;
          }).catch(() => cached);
          return cached || network;
        })
  );
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'CANCEL_REST') {
    if (restTimerId) clearTimeout(restTimerId);
    restTimerId = 0;
    self.registration.getNotifications().then(list => {
      list.forEach(note => {
        if (note.tag === 'ciclofit-rest-scheduled') note.close();
      });
    }).catch(() => {});
    return;
  }
  if (data.type === 'ARM_REST') {
    if (restTimerId) clearTimeout(restTimerId);
    const endAt = Number(data.endAt);
    const delay = Math.max(0, endAt - Date.now() + 80);
    restTimerId = setTimeout(() => {
      restTimerId = 0;
      showRestNotification(
        data.title || 'CicloFit — descanso finalizado',
        data.body || 'Seu descanso terminou. Próxima série.'
      );
    }, Math.min(delay, 2147483647));
    scheduleRestNotification(
      endAt,
      data.title || 'CicloFit — descanso finalizado',
      data.body || 'Seu descanso terminou. Próxima série.'
    );
  }
  if (data.type === 'SHOW_REST_NOTIFICATION') {
    showRestNotification(
      data.title || 'CicloFit — descanso finalizado',
      data.body || data.options?.body || 'Seu descanso terminou. Próxima série.'
    );
  }
});

async function scheduleRestNotification(endAt, title, body) {
  if (typeof TimestampTrigger === 'undefined') return;
  try {
    const old = await self.registration.getNotifications({ tag: 'ciclofit-rest-scheduled' });
    old.forEach(note => note.close());
    if (endAt <= Date.now()) return;
    await self.registration.showNotification(title, {
      body,
      tag: 'ciclofit-rest-scheduled',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      vibrate: [400, 100, 400, 100, 700],
      silent: false,
      data: { url: './' },
      showTrigger: new TimestampTrigger(endAt)
    });
  } catch (e) {}
}

async function showRestNotification(title, body) {
  try {
    await self.registration.showNotification(title, {
      body,
      tag: 'ciclofit-rest-finished',
      renotify: true,
      requireInteraction: true,
      silent: false,
      sound: './assets/restx-alert.wav',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      vibrate: [400, 100, 400, 100, 700],
      data: { url: './' }
    });
  } catch (e) {}
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
