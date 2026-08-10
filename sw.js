/* Lifecycle OS — minimal service worker.
 *
 * Purpose: satisfies Chrome's installability criteria (gets the install icon
 * into the address bar) and gives the installed app a working offline shell.
 *
 * Strategy:
 *  - Navigation requests: network-first with a cached fallback to /index.html.
 *  - Same-origin GETs:    stale-while-revalidate (instant load, fresh in bg).
 *  - Cross-origin / non-GET: pass through to the network.
 *  - On activate: drop old caches + claim clients so updates ship immediately.
 */
const VERSION = 'lifecycle-os-v19';
const SHELL = [
  '/', '/index.html', '/dashboard.html', '/calendar.html', '/cohort-definitions.html',
  '/auth.js', '/theme.css', '/table-sort.js', '/chart-enhance.js',
  '/manifest.webmanifest', '/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Helper: safely put a response in cache.
// Critical: clone() must happen SYNCHRONOUSLY before any await/then — the
// response body is a stream that can be read exactly once. The previous bug
// ("Failed to execute 'clone' on 'Response': Response body is already used")
// was caused by calling r.clone() inside a deferred caches.open().then(),
// by which time the page consumer had already drained the body.
function safePut(req, resp) {
  if (!resp || !resp.ok) return;                       // never cache 4xx/5xx
  if (resp.type === 'opaque' || resp.type === 'opaqueredirect') return;
  let clone;
  try { clone = resp.clone(); } catch { return; }     // clone NOW, while body is intact
  caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => {});
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                     // never intercept POST etc.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // pass-through CDN / Supabase

  // API endpoints are dynamic — never cache. A cached 500 stays bad until the
  // SW evicts; a cached list of competitor emails goes stale instantly.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation: network first, fall back to a cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => { safePut(req, r); return r; })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // App shell (HTML, JS, CSS, manifest) = network-first, so a deploy's code and
  // style changes reach the client on the NEXT load and are never served from a
  // stale cache. (auth.js / theme.css are shared by every page — serving them
  // stale made shipped fixes look "not applied" until a second visit.)
  if (/\.(html|css|js|mjs|webmanifest)$/i.test(url.pathname)) {
    e.respondWith(
      fetch(req).then((r) => { safePut(req, r); return r; }).catch(() => caches.match(req))
    );
    return;
  }

  // Other static assets (images, fonts, video, json) = stale-while-revalidate
  // (instant load, refreshed in the background) — they change rarely.
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req).then((r) => { safePut(req, r); return r; }).catch(() => cached);
      return cached || fresh;
    })
  );
});

// Let the page request an immediate update (e.g. after deploy).
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
