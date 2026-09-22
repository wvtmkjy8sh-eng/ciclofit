const CACHE_NAME = 'ciclofit-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',

  './css/style.css',
  './css/premium-visual.css',

  './js/app.js',
  './js/cloud-config.js',
  './js/cloud-sync.js',

  './assets/ciclofit-logo.png',
  './assets/ciclofit-logo3.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});


self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(cacheName => cacheName.startsWith('ciclofit-'))
            .filter(cacheName => cacheName !== CACHE_NAME)
            .map(cacheName => caches.delete(cacheName))
        );
      })
      .then(() => self.clients.claim())
  );
});


self.addEventListener('fetch', event => {
  const request = event.request;

  // Apenas requisições GET podem ser armazenadas.
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Não interceptar APIs externas, principalmente Supabase.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navegação de páginas:
  // tenta a versão online primeiro e usa o index salvo
  // caso a conexão esteja indisponível.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const responseClone = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put('./index.html', responseClone);
            });

          return response;
        })
        .catch(() => {
          return caches.match('./index.html');
        })
    );

    return;
  }

  // Arquivos estáticos:
  // entrega rapidamente do cache e atualiza o cache em segundo plano.
  event.respondWith(
    caches.match(request)
      .then(cachedResponse => {
        const networkFetch = fetch(request)
          .then(networkResponse => {

            if (
              networkResponse &&
              networkResponse.status === 200 &&
              networkResponse.type === 'basic'
            ) {
              const responseClone = networkResponse.clone();

              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(request, responseClone);
                });
            }

            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || networkFetch;
      })
  );
});