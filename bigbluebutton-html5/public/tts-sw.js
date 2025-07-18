const CACHE_NAME = 'tts-assets-v1';
const ASSETS_TO_CACHE = [
  '/ort.min.js',
  '/piper_phonemize.js',
  '/piper_phonemize.wasm',
  '/piper_phonemize.data',
  '/ort-wasm.wasm',
  '/ort-wasm-simd.wasm'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Caching assets...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', event => {
  clients.claim();
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
});

self.addEventListener('fetch', event => {
//   console.log('Intercepting:', event.request.url);
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
