# Architecture

## System overview

```
┌─────────────────┐         ┌──────────────────┐         ┌──────────────┐
│  Next.js         │  HTTPS  │  Express API      │   SQL   │  PostgreSQL  │
│  (Vercel)        │◄───────►│  (Render)         │◄───────►│  (Neon)      │
│  App Router, RSC │  JWT +  │  raw SQL, no ORM  │         │              │
└─────────────────┘  cookie └──────────────────┘         └──────────────┘
                                      │
                                      ▼
                          ┌───────────────────────┐
                          │ Flight Provider Layer  │
                          │ (mock | Amadeus | Ignav)│
                          └───────────────────────┘
```

The frontend never talks to the flight provider or database directly — everything goes through the Express API. The optimizer engine (below) is the only thing that calls the provider layer, and it does so through a factory, not a direct import, so swapping providers never touches optimizer code.

## Auth flow

- Access token: short-lived (15 min) JWT, returned in the response body, sent as `Authorization: Bearer <token>`. Never persisted client-side beyond memory (a page refresh triggers a silent `/api/auth/refresh` call).
- Refresh token: longer-lived (30 days) JWT, stored in an **httpOnly** cookie scoped to `/api/auth` — JavaScript on the page can never read it.
- Refresh tokens **rotate** on every use: each refresh invalidates the old token and issues a new one. If an already-used (revoked) refresh token is presented again, that's treated as a signal of token theft — every session for that user is revoked, not just the one being used.
- Passwords are hashed with bcrypt (via `bcryptjs`, no native compile step). Failed logins are tracked per-account; 5 failures locks the account for 15 minutes.

## The optimizer pipeline

This is the core of the project. A single `POST /api/trips/optimize` call runs all of these stages synchronously:

```
1. Airport Expansion       origin (+ destinations) → nearby airport candidates
2. Date Generation         fixed date, or ±3 days if dateFlexible=true
3. Route Permutation       cartesian product of airports × dates (× country orderings, if multi-city)
4. Cap Enforcement         truncate to config.optimizer.maxPermutations (default 500)
5. Flight Fetch            call the provider for each candidate's legs
6. Pruning                 drop over-budget / too-many-stops / too-slow / duplicate candidates
7. Scoring                 weight price/duration/stops by the requested preference
8. Explainability          generate a plain-language reason for each of the top 5
```

### Why the combinatorics are capped where they are

Nearby-airport expansion, flexible dates, and multi-city ordering all multiply against each other. Left uncapped, a 4-country trip with nearby airports and flexible dates could generate tens of thousands of combinations before a single flight search even runs. Four independent caps keep this bounded:

| Cap | Default | Where enforced |
|---|---|---|
| Nearby airports per city | 3 | `airportService.getNearbyAirports()` |
| Date flex window | ±3 days | `dateGenerator.generateDatePairs()` |
| Stay-length range width | 7 days | `dateGenerator.generateDatePairs()` |
| Countries per trip | 4 | `permutationGenerator.permuteCountries()` (throws past this) |
| Total permutations before flight-fetch | 500 | `permutationGenerator.capPermutations()` |

All five are environment-configurable (see `backend/.env.example`) but the defaults reflect real load-testing during development — pushing them up trades response time for exhaustiveness.

### Multi-leg dates

A round trip is modeled as two separate one-way legs (outbound + return), each with its own date — not a single search with a return date. This was a real bug caught during testing: an earlier version priced round trips using only the outbound leg. Multi-country circuits similarly get one date per leg, spread across the trip window rather than all firing on the same day.

### Explainability is template-based, not LLM-generated

Every recommendation's explanation is built from a rule engine comparing it against the top pick on price/duration/stops (`optimizer/explainability/explainabilityEngine.js`) — not a per-result LLM call. This was a deliberate cost/latency decision: an LLM call per result would make every search slower and metered, for output that's fundamentally just "X costs ₹N more but saves M minutes," which a template does deterministically and for free.

## Database

Raw SQL throughout, no ORM — see `backend/src/database/schema.sql` for the full schema (12 tables: users, sessions, subscriptions, payment_transactions, airports, trips, saved_trips, search_history, flight_cache, price_alerts, user_preferences, ai_conversations/ai_messages).

Two things worth flagging:
- The `airports` table exists in the schema but the airport **service** (search/autocomplete/nearby) reads from an in-memory dataset (`providers/airport/airportData.js`), not the DB — a deliberate choice, since a 91-row dataset doesn't need a round trip per keystroke. `npm run seed` populates the DB copy for any future SQL-based use (admin dashboards, etc.) that isn't built yet.
- `search_history` is written only by a legacy single-leg search endpoint (`GET /api/search/flights`) that the frontend doesn't actually call — the main flow (`/api/trips/optimize`) writes to `trips` instead. This table is currently dead weight in the main product flow.

## Caching

- **Flight search results**: three-layer cache keyed by a hash of the exact search params, 20-minute TTL on every layer.
  - **L0 — in-process memory** (`cache/memoryCache.js`'s `flightMemoryCache`, used from `cache/flightCache.js`): fastest path, this instance only. A hit here skips Redis and Postgres entirely. Populated on every read/write, including as a backfill after a Redis or Postgres hit, so a repeat request for the same search on the same instance is effectively free — this matters most on a single-instance deployment with no Redis configured, where it still meaningfully cuts down on Postgres round trips.
  - **L1 — Redis** (`cache/redisCache.js`), when `REDIS_URL` is set: shared across every backend instance, so a cache hit on one instance is a hit on all of them.
  - **L2 — Postgres** (`flight_cache` table, `cache/flightCache.js`): the durable source of truth, unconditionally still written on every cache set. A Postgres hit backfills both Redis and memory.
  - If `REDIS_URL` is unset, or Redis is unreachable, or the connection drops mid-run, `redisClient.isAvailable()` reports `false` and every read/write silently skips straight to Postgres (after checking memory first) — this is exactly the pre-Redis behavior, so removing `REDIS_URL` at any time is a safe, reversible operation.
  - A cache-read failure on any layer never blocks a search — it just falls through to the next layer, and ultimately to calling the provider directly.
- **Static data** (airport search results) and the **Amadeus OAuth token**: in-process memory cache (`cache/memoryCache.js`, separate singleton instances from the flight cache's). Not shared across multiple server instances. These are smaller, cheaper-to-recompute datasets than flight search results, so they weren't moved to Redis — `cache/redisCache.js` is written as a generic namespaced get/set/del helper, so migrating them later is a small, isolated change rather than a redesign.

### Redis connection lifecycle (`cache/redisClient.js`)

- Connects once at boot (`server.js`, before `app.listen`), using node-redis v4's built-in `reconnectStrategy` with capped exponential backoff (200ms × attempt, capped at 3s, giving up after 10 attempts) for reconnecting an *established* connection that drops.
- A failed **initial** connection attempt (before the socket-level `reconnectStrategy` ever gets involved) is caught and logged, and does not permanently wedge the module: `connectPromise`/`client` are cleared on that failure, so the next call to `connectRedis()` (e.g. triggered by a later incoming request) builds a fresh client and genuinely retries, rather than replaying the same cached `null` forever.
- `isAvailable()` is the single check every cache read/write makes — it's `false` whenever Redis isn't configured, hasn't finished connecting yet, or has dropped, so callers never need their own try/catch around "is Redis up."
- On `SIGTERM`/`SIGINT`, `server.js` closes the HTTP server first (draining in-flight requests), then calls `disconnectRedis()` (graceful `QUIT`), then closes the Postgres pool — in that order, so nothing loses its connection mid-query.

## Provider abstraction

```
optimizer/  ──depends on──►  providers/flight/providerFactory.js
                                        │
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                  mockProvider.js  amadeusProvider.js  ignavProvider.js
```

The optimizer never imports a concrete provider. `providerFactory.getProvider()` picks based on `FLIGHT_PROVIDER` env var (`mock`, `amadeus`, or `ignav`).

`searchWithFallback()` does **not** fall back to the mock provider when the configured real provider (Amadeus or Ignav) throws — it used to, but that meant a misconfigured or down real provider could silently serve made-up mock prices as if they were real. Today an error from the configured provider (missing/invalid credentials, a billing problem, an upstream outage) propagates to the caller and becomes a clear error response instead. The mock provider only ever runs when `FLIGHT_PROVIDER=mock` is explicitly set (local dev and automated tests), never as an automatic substitute for a real provider. Per-candidate isolation in the optimizer's `flightFetchStage.js` is unchanged: one candidate's fetch failing (e.g. no offers for one leg) still only drops that candidate rather than failing the whole search.

## Error monitoring

Sentry is wired into both apps but fully optional and off by default — leave `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` unset and neither app makes any Sentry-related network calls.

- **Backend** (`src/instrument.js`): initialized before `express` is required (required first thing in `app.js`) so its instrumentation can patch `http`/`express` correctly. Wired via `Sentry.setupExpressErrorHandler(app)`, placed after routes/`notFoundHandler` but before the existing `middleware/errorHandler.js` — Sentry captures the error and calls `next(err)`, so the app's response shape/status codes are unchanged. Only 5xx `AppError`s and non-`AppError` exceptions are forwarded; expected 4xx errors (validation, bad credentials, 404s) are normal application flow, not incidents.
- **Frontend** (`sentry.client.config.js` / `sentry.server.config.js` / `sentry.edge.config.js` + `instrumentation.js`): standard `@sentry/nextjs` App Router setup. `app/error.js` (route-level) and `app/global-error.js` (root-layout-level) both call `Sentry.captureException`.
- **Scrubbing**: `backend/src/sentry/scrubEvent.js` strips anything that looks like a credential (passwords, JWTs, API keys, Razorpay fields, `Authorization`/`Cookie` headers) from every event's `request`, `extra`, and `contexts` before it's sent — see that file's tests (`backend/tests/unit/sentryScrub.test.js`) for the exact behavior.
- **Disabling**: three independent ways nothing gets sent — no DSN configured, `SENTRY_ENABLED=false` (backend) explicitly, or `NODE_ENV=test` (always off in tests, regardless of DSN).

## Analytics

Google Analytics 4 (`frontend/lib/analytics.js` + `frontend/components/analytics/GoogleAnalytics.jsx`) follows the same optional/off-by-default pattern as Sentry above, keyed on `NEXT_PUBLIC_GA_MEASUREMENT_ID` instead of a DSN.

- **Loading**: `next/script` (`afterInteractive`) injects `gtag.js` only when a Measurement ID is present; nothing is rendered or requested otherwise.
- **Page views**: one client-side listener (`usePathname`/`useSearchParams`) sends `page_view` on mount and on every subsequent route change. GA's own automatic pageview is disabled (`send_page_view: false`) so this is the single source of truth and the initial load is never double-counted — App Router client-side navigations don't produce a new document load for GA to see on its own.
- **Events**: named helpers only (`trackFlightSearch`, `trackSelectFlight`, `trackAIAgentMessage`, `trackLogin`/`trackSignUp`, `trackBeginCheckout`/`trackPurchase`, `trackHotelSearch`/`trackSelectHotel`, `trackRestaurantSearch`/`trackSelectRestaurant`) — no raw `gtag()` calls elsewhere in the app. See the README's Analytics section for the full event list and what each one sends.
- **Scrubbing**: `trackEvent()` allowlists parameter value types (string/number/boolean only) and drops any key matching a credential/PII pattern before anything reaches `gtag()` — the frontend analog of `backend/src/sentry/scrubEvent.js`.
- **Fail-silent**: every `gtag()` call is wrapped so a blocked, missing, or failed script can never throw — analytics can never break search, the AI agent, auth, Razorpay checkout, hotels/restaurants, weather, or rendering.

## Progressive Web App

`frontend/public/sw.js` + `frontend/app/manifest.js` + `frontend/components/pwa/PWAProvider.jsx`.

- **Custom service worker, not a library** (e.g. next-pwa): this app's `next.config.js` already wraps webpack once for `output: 'standalone'` and again for `@sentry/nextjs`; adding workbox-webpack-plugin on top for a precache-everything model this app doesn't want (see below) was judged a worse trade than ~150 lines of plain, auditable JS with zero new dependencies. Full reasoning is in the comment block at the top of `sw.js`.
- **Fetch handling is scoped by construction, not by a denylist**: the handler returns immediately (browser handles the request natively) for anything that isn't a same-origin `GET`. That one check is what keeps the service worker off every mutation (login, OAuth, Razorpay, AI Agent messages, trip saves — all non-GET) and everything cross-origin (the backend API, which is on a separate origin from the frontend in every environment this app ships in; GA; Sentry; OAuth providers; Razorpay checkout; Mapbox). Real navigations (`request.mode === 'navigate'`) get network-first-with-offline-fallback; `/_next/static/*` and the PWA's own icons/manifest get cache-first (both are either content-hashed or small stable brand assets); everything else same-origin (notably Next's RSC data fetches for authenticated pages like `/dashboard`) is left untouched rather than assumed safe to cache.
- **No page HTML is ever cached-then-served-stale.** The offline cache only exists as a fallback for when a navigation's network request itself fails; the app has no page that's safe to serve identically to everyone regardless of auth state, so there's no "serve cached page, revalidate in background" path here.
- **Update flow**: a newly installed worker sits in `waiting` (no `self.skipWaiting()` in `install`) until the page explicitly posts `{ type: 'SKIP_WAITING' }` to it — which only happens when the person clicks "Refresh" on `PWAProvider`'s update banner. This is deliberate: an automatic takeover mid-payment or mid-multistep-form would be worse than a slightly stale app shell for a few more minutes.
- **Dev vs. prod**: `PWAProvider` only calls `navigator.serviceWorker.register()` when `NODE_ENV === 'production'` — `next dev`'s unhashed, frequently-changing assets are a bad fit for the cache-first `/_next/static/*` rule.
- **`/offline`** (`app/offline/page.js`) is a plain server component (no `cookies()`/`headers()`/dynamic data), so Next prerenders it to static HTML at build time — that's what lets the service worker fetch-and-cache it once at install and safely serve the exact same bytes to anyone, online status aside.

See the root README's "Progressive Web App (PWA)" section for the install instructions, the full caching-strategy table, and the HTTPS/localhost exception.
