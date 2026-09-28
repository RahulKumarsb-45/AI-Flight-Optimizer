/**
 * FlightOptimizer service worker (Q9 — PWA).
 *
 * Scope: this file lives at the origin root (/sw.js) so its default scope is
 * '/' — the whole app. Registered from components/pwa/PWAProvider.jsx,
 * production builds only (see that file for why).
 *
 * ---------------------------------------------------------------------------
 * WHY A HAND-ROLLED SERVICE WORKER INSTEAD OF A LIBRARY (e.g. next-pwa)
 * ---------------------------------------------------------------------------
 * next-pwa (and workbox-webpack-plugin under it) generates a service worker
 * by precaching a build-time manifest of every emitted asset. That's a good
 * fit for apps that want "cache everything, works fully offline". This app
 * doesn't want that:
 *   - Next.js 14 App Router + `output: 'standalone'` + the existing
 *     @sentry/nextjs webpack wrapping in next.config.js is already three
 *     layers of webpack config composition. Bolting workbox-webpack-plugin
 *     on top as a fourth is a real source of build breakage for a feature
 *     that, for this app, only needs a handful of runtime rules.
 *   - This app's actual caching needs are narrow and mostly about *what not
 *     to cache* (auth, payments, AI Agent responses, personalized pages) —
 *     a precache-everything tool works against that, not with it.
 *   - It's one more dependency to keep compatible across future Next.js
 *     upgrades, for a project note (#11) that explicitly says avoid
 *     unnecessary dependency changes.
 * A small, explicit fetch handler is easier to audit for exactly this app's
 * security requirements than a generated one, and has zero new dependencies.
 *
 * ---------------------------------------------------------------------------
 * CACHE VERSIONING / HOW TO SHIP AN UPDATE (see also README.md)
 * ---------------------------------------------------------------------------
 * Bump CACHE_VERSION any time you change this file's caching logic (not
 * strictly necessary for correctness — browsers byte-diff the SW script on
 * every check and treat any change as "new version" regardless of this
 * constant — but bumping it makes the intent explicit and guarantees old
 * cache entries are dropped in `activate` rather than merely becoming
 * unreachable dead weight in storage).
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `fo-static-${CACHE_VERSION}`;

const OFFLINE_URL = '/offline';

// Small, stable set of same-origin assets that are safe and useful to have
// available before the user ever visits a page: the offline fallback shell
// itself, and the PWA's own branding assets. Deliberately NOT a list of
// Next.js build output (those are content-hashed per build and handled by
// the cache-first runtime rule below instead — baking hashed filenames into
// this file would go stale the moment the app is rebuilt).
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // Intentionally not cache.addAll(): addAll rejects (and aborts the
      // whole install) if a single URL 404s. One missing/renamed asset
      // shouldn't be able to take down service worker installation.
      Promise.all(
        PRECACHE_URLS.map((url) =>
          fetch(url, { cache: 'no-cache' })
            .then((response) => (response.ok ? cache.put(url, response) : null))
            .catch(() => null)
        )
      )
    )
    // Deliberately no self.skipWaiting() here. If an older service worker is
    // already controlling this origin, we let this new one sit in "waiting"
    // until the person explicitly asks for the update (see PWAProvider.jsx's
    // "Update available" banner + the message listener below) so we never
    // swap app versions under someone mid-session. If there is NO existing
    // controller (first-ever install), there's nothing to disrupt and the
    // browser activates this worker on its own without ever entering
    // "waiting", so this doesn't delay anything for new visitors.
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Lets the page hand control to a waiting worker on demand (user clicked
// "Refresh" on the update banner) instead of it happening automatically.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/** Cache-first: for immutable, content-hashed, or small static brand assets. */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

/**
 * Full-page navigations only. Always goes to the network first — this app's
 * pages can embed personalized/authenticated UI (nav state, dashboard,
 * trips, results), so there is no page-level HTML that's safe to serve
 * stale-from-cache. The offline cache here exists purely as a fallback for
 * when the network request itself fails, not as a performance cache.
 */
async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const cache = await caches.open(STATIC_CACHE);
    const offlinePage = await cache.match(OFFLINE_URL);
    return (
      offlinePage ||
      new Response('You are offline and the offline page has not been cached yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      })
    );
  }
}

function isStaticBrandAsset(pathname) {
  return (
    pathname === '/favicon.ico' ||
    pathname === '/manifest.webmanifest' ||
    pathname.startsWith('/icons/') ||
    // Next.js App Router's generated routes for app/icon.png and
    // app/apple-icon.png (exact path can carry a build query string).
    pathname === '/icon.png' ||
    pathname === '/apple-icon.png' ||
    pathname.startsWith('/icon.png') ||
    pathname.startsWith('/apple-icon.png')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never touch non-GET requests. This alone excludes every mutation in the
  // app: login/register, OAuth token exchange, Razorpay order
  // creation/verification, AI Agent messages, trip saves, etc.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch cross-origin requests. The backend API runs on a separate
  // origin/port from the frontend in every environment this app ships in
  // (see docker-compose.yml / .env.example) — so this one check is also
  // what keeps hands off: the entire /api/* backend (flights, auth, AI
  // Agent, payments, weather, places), Google's gtag.js + analytics
  // collection endpoint, Sentry's ingest endpoint, the Google OAuth provider
  // redirect, Razorpay's checkout script/iframe, and Mapbox tiles.
  if (url.origin !== self.location.origin) return;

  // Real, top-level browser navigations (address bar, link clicks, back/
  // forward) — never fetch()/XHR calls. Next.js's own client-side
  // navigation payload requests (React Server Component data for
  // /dashboard, /profile, /trips/*, etc.) are same-origin GETs but are NOT
  // navigations, so they fall through untouched below rather than ever
  // being cached.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Next.js build output is content-hashed per build (the filename changes
  // whenever the content does), so caching it aggressively is safe.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isStaticBrandAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else — Next.js RSC data fetches, /_next/image, any other
  // same-origin GET — is left untouched (no event.respondWith call means
  // the browser just performs its normal fetch). This is deliberate: it's
  // the safest default for anything that might carry personalized or
  // otherwise non-public data, and this app currently has no same-origin
  // API route that's been reviewed and confirmed safe to cache.
});
