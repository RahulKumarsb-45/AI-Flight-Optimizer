# AI Flight Optimizer

A full-stack flight search optimization engine: nearby-airport expansion, flexible-date search, and multi-city route scoring — built with Express, raw PostgreSQL SQL, and Next.js.

This is a portfolio project. It is **not a live booking platform** — see [Current Status](#current-status) below for exactly what's real and what's a documented next step.

---

## What it actually does

Give it an origin airport, 1–4 destination countries, and a date, and the optimizer:

1. Expands your origin (and destinations) to nearby airports — up to 3 alternates within ~300km, ranked by distance + hub importance
2. If flexible dates are enabled, checks departure dates ±3 days either side of what you picked
3. For multi-country trips, tries different route orderings (e.g. `DEL→LHR→CDG→DEL` vs `DEL→CDG→LHR→DEL`)
4. Searches flights for every resulting combination (capped at 500 permutations to keep response times reasonable)
5. Prunes candidates that are over budget, have too many stops, or take far longer than the fastest option
6. Scores what's left on price/duration/stops, weighted by whether you asked for cheapest, fastest, or balanced
7. Returns the top 5 recommendations, each with a plain-language explanation of why it ranked where it did

## Tech stack

| | |
|---|---|
| Backend | Node.js, Express, PostgreSQL (raw SQL, no ORM), Redis (optional accelerator), JWT auth |
| Frontend | Next.js 14 (App Router), Tailwind CSS, React Query, react-hook-form + Zod, installable PWA (service worker + offline fallback) |
| Testing | Backend: Jest + Supertest, 161 backend tests (unit + integration against a real test database). Frontend: Node's built-in test runner, 69 tests (utils, weather service, WeatherCard component) |
| Monitoring / Analytics | Sentry (backend + frontend), Google Analytics 4 — both opt-in via env vars, fully inert when unset |
| CI | GitHub Actions — lint, test, build on every push |
| Deployment | Docker (multi-stage builds), designed for Render (backend) + Vercel (frontend) + Neon (Postgres) |

## Current status

This section reflects the actual state of the source (through Q9 — Progressive Web App — plus the Budget Optimizer).

**Fully built and tested:**
- Email/password auth (JWT access token + httpOnly refresh cookie, rotation, reuse detection, account lockout)
- Google OAuth (`/api/auth/google` + callback) — a real provider flow, not a stub. GitHub OAuth has been permanently removed from this project's scope.
- Airport system (91 curated real airports, autocomplete, nearby-airport ranking)
- Flight provider abstraction (mock provider + Amadeus and Ignav integrations, provider-agnostic optimizer)
- Full optimizer pipeline (permutations, pruning, scoring, template-based explainability)
- Budget Optimizer (`backend/src/optimizer/budget/`) — per-recommendation cost breakdown (flight + estimated accommodation/food/local-travel categories, clearly labeled as a heuristic range, never invented pricing); a single `budgetOptimizer` result (`optimizer/budget/budgetEstimator.js#selectBudgetOptimizerPick`) that either picks the real in-budget candidate with the lowest estimated total trip cost (duration as a tie-breaker) and explains why, or — when nothing fits — surfaces the real cheapest over-budget candidate plus a real alternate date/destination when one exists in the same search's results, and the plain required budget increase otherwise; and the existing "cheapest"/"balanced" category picks. Nothing here makes an extra flight-search call or invents a price/date/destination. Optional attractions estimate on the frontend reuses already-fetched Google Places price-level data — no extra API calls.
- AI agent (`/api/ai/*`) — real chat endpoint against the configured provider (Gemini or Anthropic), rate-limited
- Weather / best-season endpoints (`/api/weather/*`) — real OpenWeatherMap integration (current, forecast, season)
- Hotels / restaurants / places + photos (`/api/places/*`) — real Google Places integration
- Flight cache with a full three-layer fallback chain (`backend/src/cache/`): in-process memory → Redis (optional, cross-instance) → Postgres (durable). Redis is a pure accelerator — unset `REDIS_URL` and the app runs unchanged on memory + Postgres; a Redis outage never crashes a request. A failed *initial* Redis connection no longer permanently blocks reconnection — a later request retries with a fresh client (see `cache/redisClient.js`).
- Sentry error monitoring (backend Express + frontend Next.js, both client- and server-side) — off by default, opt-in via `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`
- Google Analytics 4 (page views + a focused set of product events) — off by default, opt-in via `NEXT_PUBLIC_GA_MEASUREMENT_ID`
- Installable Progressive Web App (manifest, icons, service worker, offline fallback) — see **Progressive Web App (PWA)** below
- Docker, CI, 161 passing backend tests

**Real, but not production-live** (wired against the real third-party API, gated entirely by which credentials you supply):
- **Razorpay payments** — order creation, HMAC signature verification, and capture (`backend/src/services/paymentService.js`) all call Razorpay's real API. Whether this is sandbox or live money depends solely on whether `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are Razorpay **test** or **live** keys — this repo ships with neither, so it's inert until you provide your own.
- **Flight booking** — the flight search/optimizer pipeline is real; actually booking a returned itinerary is intentionally dummy/mock only (no PNR is issued anywhere).

**Documented but not implemented:**
- PDF export of trip results — not built.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit together, and **Known limitations** below for the current technical-debt items.

## Known limitations / technical debt

- **Resolved this pass:** the flight cache's in-memory layer (see above) was the last piece of the intended Redis → Postgres → in-memory chain; it's now implemented and tested (`tests/unit/flightCache.test.js`). A separate bug where a failed *initial* Redis connection permanently blocked all future reconnect attempts (`connectRedis()` cached the failed promise forever) is also fixed and tested (`tests/unit/redisClient.test.js`).
- **Redis is Docker-optional, not fully absent-tolerant at the compose level:** `docker-compose.yml`'s `redis` service uses `condition: service_started` (not `service_healthy`) for the `backend` service's `depends_on`, so a Redis health-check failure no longer blocks the backend container from starting — consistent with the app code, which already treats Redis as a pure accelerator. Redis itself hasn't been made optional as a *service* in the compose file (it still starts by default); unsetting `REDIS_URL` or commenting out the service remains the way to run without it entirely, per the existing comment in `docker-compose.yml`.
- **`docker-compose.yml` was missing `GOOGLE_PLACES_API_KEY` and the Google OAuth variables (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_CALLBACK_URL`) in the backend service's environment — fixed this pass.** Previously, a Docker deployment with these set in the root `.env` would still see hotels/restaurants/tourist-attraction lookups fail with `PLACES_NOT_CONFIGURED` and Google sign-in fail with `OAUTH_NOT_CONFIGURED`, because the values never reached the container. Outside Docker (running the backend directly with a normal `.env`) this was never affected. The root `.env.example` was also missing `GOOGLE_PLACES_API_KEY` and the Google OAuth variables entirely; both are added now.
- **GA4/Sentry require env configuration to do anything** — both are fully wired but inert without `NEXT_PUBLIC_GA_MEASUREMENT_ID` / `SENTRY_DSN` (and `NEXT_PUBLIC_SENTRY_DSN`) respectively. This is by design, not a gap, but is called out here since it's easy to assume otherwise from the README alone.
- **Frontend automated test suite** now exists, built on Node's own built-in test runner (`node --test`) — no Jest/Vitest added, since the built-in runner plus `jsdom`/`@testing-library/react`/`esbuild` (dev-only) was already enough. It covers pure utility functions (`frontend/utils/*.test.js`), the weather API service layer (`frontend/services/weatherService.test.js`), and the `WeatherCard` component's loading/error/success/caching behavior (`frontend/components/results/WeatherCard.test.jsx`), 69 tests total. Run it with `cd frontend && npm test` (see "Running tests" below) — see `frontend/tests/support/` for the small test-only loaders (path-alias resolution, a JSX transform, a jsdom environment, and a `next/image` stand-in) that make this possible outside Next's own build pipeline. GA4's helper (`frontend/lib/analytics.js`) is still not covered by automated tests — see the Q8 correction notes in `docs/ARCHITECTURE.md` for what a follow-up test setup should cover. The Q9 PWA additions (`components/pwa/PWAProvider.jsx`, `public/sw.js`) have the same gap for the same reason.
- **PWA install/offline behavior was verified by build output + manual HTTP checks against a locally-served production build, not by an automated browser test.** This sandbox had no network access to install Playwright/Puppeteer's Chromium binary (only npm/PyPI/GitHub registries are reachable, not browser CDNs) and no Docker daemon available to run the project's own containers. What *was* actually run and passed: `next build` (manifest/icons/offline page all generate correctly — see the PWA section below), `next lint`, the full backend Jest suite, and a locally-booted `standalone` server hit with `curl` to confirm `/manifest.webmanifest`, all four icon files, `/sw.js`, and `/offline` each return the right status code and content-type, and that the homepage's auto-generated `<head>` has exactly one manifest link and one set of icon links (no duplicates). **Not verified**: an actual browser installing the app, the service worker's install/activate/fetch lifecycle running for real, or a Lighthouse PWA audit. Recommended before shipping: run `npm run build && npm start` and check Chrome DevTools → Application → Manifest/Service Workers, plus a Lighthouse PWA audit, against a real HTTPS deployment.
- **Manifest has no `screenshots` field.** Chrome's richer desktop install prompt can use real app screenshots; none were added here rather than fabricate placeholder images that wouldn't reflect the actual UI. Worth adding once there are real, current screenshots to use.
- **This sandbox has no Docker daemon**, so `docker build`/`docker compose config` for this pass were verified by careful manual inspection (see the PWA section's Docker note below) rather than actually executed — everything else in this list up through Q8 was already true independent of that; flagging it here because Testing (§17 of the Q9 brief) explicitly asked for exact commands and results, and honesty about what couldn't be run is part of that.

See `docs/DEPLOYMENT.md` for the platforms this is designed against; deployment there also assumes you'll consciously choose test or live keys for Razorpay rather than the app deciding for you.

## Project structure

```
flight-optimizer/
├── backend/           Express API, optimizer engine, PostgreSQL schema
├── frontend/          Next.js app
├── docs/              Architecture, API reference, deployment guide
├── docker-compose.yml Local full-stack orchestration
└── .github/workflows/ CI pipeline
```

## Running locally

### Option A: Docker (fastest)

```bash
cp .env.example .env    # edit JWT secrets
docker compose run --rm migrate
docker compose up --build
```
Frontend at `http://localhost:3000`, API at `http://localhost:5000`.

### Option B: Manual

Requires Node 20+ and a local or hosted PostgreSQL instance.

```bash
# Backend
cd backend
cp .env.example .env    # set DATABASE_URL and JWT secrets
npm install
npm run migrate
npm run dev              # http://localhost:5000

# Frontend (separate terminal)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev              # http://localhost:3000
```

### Running tests

```bash
cd backend
cp .env.test.example .env.test   # point at a DEDICATED test database
npm test                          # creates + migrates the test DB automatically, then runs everything
```

`npm test` runs two suites, in this order (either can also be run alone):
- `npm run test:jest` — the main Jest + Supertest suite. Before any test file runs, `tests/globalSetup.js` connects to the Postgres server in `DATABASE_URL`, creates the target database if it doesn't exist yet, and applies the current `backend/src/database/schema.sql` to it — so the test database is always up to date with zero manual setup, and there's no separate `npm run migrate` step to remember (or forget).
- `npm run test:node` — `tests/unit/shareTrip.controller.test.js`, written against Node's built-in `node --test` runner rather than Jest (see that file's header comment for why); it needs no database at all.

`npm run migrate` still exists for applying schema.sql to your dev database (`.env`) by hand — it's just no longer part of the test workflow.

```bash
cd frontend
npm install
npm test                          # 69 tests (utils + weatherService + WeatherCard), ~4-5s
```

## Environment variables

See `backend/.env.example` and `frontend/.env.local.example` for the full list. The only ones required to get a working local setup:

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | backend | Postgres connection string |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | backend | Any random string locally; **the app refuses to start in production without these set** |
| `NEXT_PUBLIC_API_URL` | frontend | Points at the backend; baked in at build time |

Everything else (Amadeus, Ignav, Anthropic, OpenWeather, Razorpay keys) is optional — the app runs fine without them using the mock flight provider. Setting `FLIGHT_PROVIDER=ignav` with `IGNAV_API_KEY` set switches flight search to real, live fares from [Ignav](https://ignav.com) (booking stays a dummy flow either way — see the flight provider section below).

## Error monitoring (Sentry)

Sentry is fully optional and off by default. Leave `SENTRY_DSN` (backend) and `NEXT_PUBLIC_SENTRY_DSN` (frontend) unset and the app behaves exactly as if Sentry didn't exist — no events sent, no extra network calls.

To enable it:

| Variable | Where | Notes |
|---|---|---|
| `SENTRY_DSN` | backend | Your Sentry project DSN. Leave blank to disable. |
| `SENTRY_ENVIRONMENT` | backend | Defaults to `NODE_ENV`. |
| `SENTRY_RELEASE` | backend | Optional — tag events with a release/version. |
| `SENTRY_TRACES_SAMPLE_RATE` | backend | Defaults to `0.1`. |
| `SENTRY_ENABLED` | backend | Explicit kill switch; set to `false` to force-disable even with a DSN set. |
| `NEXT_PUBLIC_SENTRY_DSN` | frontend | Same DSN, or a separate frontend project's DSN. Baked in at build time. Sentry documents DSNs as safe to expose publicly. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | frontend | Defaults to `NODE_ENV`. |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` | frontend (build-time only) | Optional — lets the build upload source maps for readable stack traces. Never baked into the runtime image. |

Sensitive data (passwords, JWTs, API keys, Razorpay/OAuth secrets, cookies, `Authorization` headers) is scrubbed from every event before it's sent — see `backend/src/sentry/scrubEvent.js`.

## Analytics (Google Analytics 4)

GA4 is fully optional and off by default. Leave `NEXT_PUBLIC_GA_MEASUREMENT_ID` unset and the app behaves exactly as if GA didn't exist — no script is injected, no events fire, no extra network calls, and nothing else in the app changes or breaks (this is enforced centrally in `frontend/lib/analytics.js`, not just left to chance at each call site).

To enable it:

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | frontend | Your GA4 Measurement ID (starts with `G-`). Baked in at build time, same as `NEXT_PUBLIC_SENTRY_DSN`. Leave blank to disable. |

**Implementation** — `frontend/components/analytics/GoogleAnalytics.jsx`, mounted once in the root layout:
- Initializes `window.dataLayer`/`window.gtag` via `next/script` (`beforeInteractive`) so the queue exists before hydration — calls made before `gtag.js` itself has finished downloading are simply queued and flushed once it arrives, so the initial `page_view` is never silently dropped. The actual `gtag.js` file is then loaded separately via `next/script` (`afterInteractive`), since it doesn't need to block anything.
- A single client-side listener (`usePathname` + `useSearchParams`, Suspense-bounded as Next.js requires) sends exactly one `page_view` per navigation — including the first — so pageviews are never duplicated between GA's automatic tracking and route-change tracking. (GA's own automatic pageview is explicitly turned off via `send_page_view: false` for this reason.)
- Google Signals and ad-personalization signals are turned off (`allow_google_signals: false`, `allow_ad_personalization_signals: false`) — this is plain product analytics, not ad tracking.

**Tracked events** — all defined as named helpers in `frontend/lib/analytics.js` (avoid scattering raw `gtag()` calls through the app):

| Event | Fired from | Notes |
|---|---|---|
| `flight_search` | `SearchForm.jsx` | origin, destination(s), trip type, traveler count, preference — no traveler names/contact info |
| `select_flight` | `RecommendationCard.jsx` | Fires when a recommendation's flight details are expanded — the closest real "selection" action, since flight booking is dummy/mock only |
| `ai_agent_message` | `AIAgentContent.jsx` | action + success/failure only — the actual chat message/reply text is never sent |
| `login` / `sign_up` | `LoginForm.jsx`, `RegisterForm.jsx`, `auth/callback/page.js` | `method` only (`password` or `oauth`) — never email, password, or tokens |
| `begin_checkout` / `purchase` | `PricingPlans.jsx` | plan key + price + Razorpay order id — never card data or Razorpay secrets |
| `hotel_search` / `select_hotel`, `restaurant_search` / `select_restaurant` | `NearbyPlacesCard.jsx` | airport code + result count / whether the place had a rating |

**Privacy safeguards**:
- `trackEvent()` in `frontend/lib/analytics.js` drops any parameter whose key looks like it could carry a credential or PII (password/token/secret/email/phone/card/etc.) and only allows through plain strings/numbers/booleans, as defense-in-depth beyond each call site being careful about what it passes in — mirroring the intent of `backend/src/sentry/scrubEvent.js` on the backend.
- Every `gtag` call is wrapped so a blocked/missing/failed script can never throw or break the app.
- No consent-management UI existed in this app before Q8, and this change doesn't add one. For an actual production deployment (especially serving EU/UK users), you're expected to gate the `<GoogleAnalytics />` mount in `frontend/app/layout.js` behind your own cookie-consent decision — this project does **not** claim automatic GDPR/consent compliance.

## Progressive Web App (PWA)

FlightOptimizer is installable — desktop Chrome/Edge, Android Chrome, and iOS/iPadOS Safari (with platform differences noted below).

**Install instructions:**
| Platform | How |
|---|---|
| Desktop Chrome/Edge | Address-bar install icon, or menu → "Install FlightOptimizer…" |
| Android (Chrome) | Menu → "Add to Home screen" / "Install app" |
| iOS/iPadOS (Safari only — Chrome/Firefox on iOS can't install PWAs, that's an Apple platform restriction, not something this app controls) | Share icon → "Add to Home Screen" |

**What works offline:**
- The app shell keeps rendering (Navbar/Footer, static pages already visited)
- The `/offline` fallback page — shown automatically instead of the browser's default network-error page if a navigation fails with no connection
- Previously cached static assets (JS/CSS bundles, the app's own icons)

**Requires a network connection (by design, not a bug):** flight search, the AI Agent, sign-in/OAuth, weather, hotels/restaurants/places, and Razorpay payments. All of these hit the backend API, which the service worker deliberately never touches — see "What's never cached" below. Server-side (mock) booking also requires network for the same reason.

**Caching strategy** (`frontend/public/sw.js`):
| Request type | Strategy |
|---|---|
| Page navigations (address bar, links, back/forward) | Network-first; falls back to the cached `/offline` page only if the network request itself fails. Pages are never served stale, since several embed personalized/authenticated UI. |
| `/_next/static/*` (JS/CSS, content-hashed per build) | Cache-first — safe because the filename itself changes whenever the content does |
| PWA's own icons, manifest, favicon | Cache-first |
| Everything else (API calls, Next.js RSC data fetches, `/_next/image`, analytics, Sentry, OAuth, Razorpay) | Untouched — the service worker doesn't intercept it at all |

**What's never cached** — enforced structurally, not by a denylist that could miss something: the fetch handler only ever acts on same-origin `GET` requests. That single rule already excludes every `POST` (login, OAuth token exchange, Razorpay order create/verify, AI Agent messages, trip saves) and everything cross-origin (the backend API, which runs on a separate origin from the frontend in every environment this app ships in; Google Analytics; Sentry ingest; the OAuth providers; Razorpay's checkout). On top of that, Next.js's own client-side navigation data-fetches (RSC payloads for `/dashboard`, `/profile`, `/trips/*`, etc.) are same-origin GETs but are *not* real navigations, so they're deliberately left untouched too rather than risk caching personalized data.

**Updates**: when a new deploy ships a changed service worker, the browser installs it in the background and FlightOptimizer shows a small "A new version is ready" card (bottom-right) with a **Refresh** button — updating is never automatic or forced, specifically so it can't interrupt someone mid-payment or mid-form. Declining just means you keep using the current version until your next natural full reload.

**Development vs. production**: the service worker is only registered when `NODE_ENV === 'production'` (`components/pwa/PWAProvider.jsx`). In `next dev`, none of this runs — dev assets aren't content-hashed the way a production build's are, so caching them would risk serving a stale bundle after a restart. Test PWA behavior against `npm run build && npm start`, not `npm run dev`.

**HTTPS**: browsers only allow service worker registration on secure origins, with an explicit exception for `localhost`/`127.0.0.1` — so this all works during local development without any certificate setup. In production, HTTPS is a hard requirement, not optional. Vercel (this project's documented frontend deployment target — see `docs/DEPLOYMENT.md`) provides this automatically; a self-hosted Docker deployment needs its own TLS termination (reverse proxy, load balancer, etc.) in front of the frontend container.

**Redeploying a service worker change**: bump `CACHE_VERSION` at the top of `public/sw.js` (also documented in a comment there), then deploy normally. Browsers re-check the SW script's bytes on their own (roughly every 24h, and on most navigations) and treat any change as a new version — the version bump isn't strictly required for that detection to work, but makes the intent explicit and guarantees old cache entries get swept in `activate` rather than just becoming unreachable.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, optimizer pipeline, data flow
- [`docs/API.md`](docs/API.md) — full endpoint reference
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — deploying to Render + Vercel + Neon

## License

MIT — see [`LICENSE`](LICENSE).
