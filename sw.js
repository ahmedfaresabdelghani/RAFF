// sw.js — offline app shell. Stale-while-revalidate for same-origin GET requests only;
// nothing from other origins is ever cached or fetched (CSP also forbids it).
const CACHE = 'raff-shell-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'vendor/html5-qrcode.min.js',
  'js/app.js', 'js/actions.js', 'js/backup.js', 'js/csv.js', 'js/db.js', 'js/demo.js', 'js/domain.js',
  'js/files.js', 'js/services.js', 'js/settings.js', 'js/store.js',
  'js/ui/dom.js', 'js/ui/feedback.js', 'js/ui/icons.js', 'js/ui/scanner.js', 'js/ui/sheets.js',
  'js/ui/screens/expiry.js', 'js/ui/screens/history.js', 'js/ui/screens/more.js', 'js/ui/screens/scan.js',
  'js/ui/screens/stock.js', 'js/ui/screens/stocktake.js',
  'fonts/cairo-arabic-400-normal.woff2', 'fonts/cairo-arabic-700-normal.woff2', 'fonts/cairo-arabic-800-normal.woff2',
  'fonts/cairo-latin-400-normal.woff2', 'fonts/cairo-latin-700-normal.woff2', 'fonts/cairo-latin-800-normal.woff2',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    const res = await network;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  })());
});
