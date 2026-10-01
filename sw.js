const CACHE_NAME = 'ciclofit-static-v46';
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
let restToken = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function restDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ciclofit-rest', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('rest')) req.result.createObjectStore('rest');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readRest() {
  return restDb().then(db => new Promise(resolve => {
    const tx = db.transaction('rest', 'readonly');
    const rq = tx.objectStore('rest').get('active');
    rq.onsuccess = () => { resolve(rq.result || null); db.close(); };
    rq.onerror = () => { resolve(null); db.close(); };
  })).catch(() => null);
}

function writeRest(value) {
  return restDb().then(db => new Promise(resolve => {
    const tx = db.transaction('rest', 'readwrite');
    tx.objectStore('rest').put(value, 'active');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  })).catch(() => {});
}

function clearRest() {
  return restDb().then(db => new Promise(resolve => {
    const tx = db.transaction('rest', 'readwrite');
    tx.objectStore('rest').delete('active');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  })).catch(() => {});
}

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
    ).then(() => self.clients.claim()).then(() => resumeStoredRest())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.endsWith('/rest-arm')) {
    event.respondWith(new Response('ok', { status: 200 }));
    event.waitUntil(request.json().then(data => armRest(data || {})).catch(() => {}));
    return;
  }
  if (request.method !== 'GET') return;

  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  const live = /\.(js|css|html|json)$/.test(url.pathname) || url.pathname.endsWith('/');
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
    event.waitUntil(cancelRest());
    return;
  }
  if (data.type === 'REST_SETTLED') {
    event.waitUntil(settleRest());
    return;
  }
  if (data.type === 'ARM_REST') {
    event.waitUntil(armRest(data));
    return;
  }
  if (data.type === 'SHOW_REST_NOTIFICATION') {
    event.waitUntil(showRestNotification(
      data.title || 'CicloFit — descanso finalizado',
      data.body || data.options?.body || 'Seu descanso terminou. Próxima série.'
    ));
  }
});

async function cancelRest() {
  restToken = 0;
  await clearRest();
  try {
    const list = await self.registration.getNotifications({ includeTriggered: true });
    list.forEach(note => {
      if (note.tag === 'ciclofit-rest-scheduled' || note.tag === 'ciclofit-rest-finished') note.close();
    });
  } catch (e) {}
}

async function settleRest() {
  const cur = await readRest();
  if (!cur || cur.token !== restToken) return;
  cur.fired = true;
  await writeRest(cur);
  restToken = 0;
  try {
    const list = await self.registration.getNotifications({ tag: 'ciclofit-rest-scheduled', includeTriggered: true });
    list.forEach(note => note.close());
  } catch (e) {}
}

async function armRest(data) {
  const endAt = Number(data.endAt);
  if (!Number.isFinite(endAt) || endAt <= 0) return;
  const token = Date.now() + Math.random();
  restToken = token;
  const record = {
    token,
    endAt,
    title: data.title || 'CicloFit — descanso finalizado',
    body: data.body || 'Seu descanso terminou. Próxima série.',
    fired: false
  };
  await writeRest(record);
  const triggered = await scheduleRestNotification(record.endAt, record.title, record.body);
  await holdRestUntil(record, triggered);
}

async function resumeStoredRest() {
  const cur = await readRest();
  if (!cur || cur.fired || !cur.endAt) return;
  if (cur.endAt > Date.now()) {
    await armRest(cur);
    return;
  }
  if (Date.now() - cur.endAt > 120000) {
    await clearRest();
    return;
  }
  const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  cur.fired = true;
  await writeRest(cur);
  if (!open.length) await showRestNotification(cur.title, cur.body);
}

async function scheduleRestNotification(endAt, title, body) {
  if (typeof TimestampTrigger !== 'function' || !('showTrigger' in Notification.prototype)) return false;
  try {
    const old = await self.registration.getNotifications({ tag: 'ciclofit-rest-scheduled', includeTriggered: true });
    old.forEach(note => note.close());
    if (endAt <= Date.now()) return false;
    await self.registration.showNotification(title, {
      body,
      tag: 'ciclofit-rest-scheduled',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      vibrate: [400, 100, 400, 100, 700],
      silent: false,
      renotify: true,
      requireInteraction: true,
      sound: './assets/restx-alert.wav',
      data: { url: './' },
      showTrigger: new TimestampTrigger(endAt)
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function holdRestUntil(record, triggered) {
  while (Date.now() + 40 < record.endAt) {
    if (restToken !== record.token) return;
    await sleep(Math.min(Math.max(record.endAt - Date.now(), 0), 15000));
  }
  if (restToken !== record.token) return;
  let cur = await readRest();
  if (!cur || cur.fired || cur.token !== record.token) return;
  const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (open.length) {
    open.forEach(client => client.postMessage({ type: 'REST_ELAPSED' }));
    await sleep(900);
    if (restToken !== record.token) return;
    cur = await readRest();
    if (!cur || cur.fired || cur.token !== record.token) return;
  }
  if (triggered) {
    await sleep(400);
    try {
      const visible = await self.registration.getNotifications({ tag: 'ciclofit-rest-scheduled' });
      if (visible.length) {
        cur.fired = true;
        await writeRest(cur);
        restToken = 0;
        return;
      }
    } catch (e) {}
  }
  if (restToken !== record.token) return;
  cur.fired = true;
  restToken = 0;
  await writeRest(cur);
  await showRestNotification(record.title, record.body);
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
