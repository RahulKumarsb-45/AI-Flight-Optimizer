# Deployment Guide

This targets three free/cheap-tier services: **Neon** (Postgres), **Render** (backend), **Vercel** (frontend). None of this has been run end-to-end by the project author on live infrastructure — the steps below are accurate against each platform's current docs and the app's actual configuration, but treat this as a solid starting checklist, not a guarantee-it-works-first-try script.

## 1. Database — Neon

1. Create a project at [neon.tech](https://neon.tech) (free tier is enough for this app's scale).
2. Copy the connection string it gives you — it looks like `postgresql://user:pass@ep-xxx.neon.tech/dbname?sslmode=require`.
3. Note: Neon requires SSL. Set `PG_SSL=true` in the backend's environment (see below) — the app's `database/pool.js` reads this flag and enables `ssl: { rejectUnauthorized: false }` accordingly.
4. You'll run the schema migration *after* the backend is deployed (step 2.5 below), since `npm run migrate` needs the same `DATABASE_URL`.

## 2. Backend — Render

1. Push this repo to GitHub if you haven't already.
2. In Render, **New → Web Service**, connect the repo, set:
   - **Root directory**: `backend`
   - **Runtime**: Docker (Render will pick up `backend/Dockerfile` automatically) — or Node, with build command `npm ci` and start command `node src/server.js`, if you'd rather skip Docker on Render specifically.
   - **Region**: pick one close to your Neon database region to minimize latency.
3. Environment variables (Render dashboard → Environment):

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | (from Neon) |
   | `PG_SSL` | `true` |
   | `JWT_ACCESS_SECRET` | generate one: `openssl rand -hex 32` |
   | `JWT_REFRESH_SECRET` | a **different** random value, same method |
   | `FRONTEND_URL` | your Vercel URL once you have it (step 3) — needed for CORS |
   | `FLIGHT_PROVIDER` | `mock`, `amadeus` if you have real Amadeus credentials, or `ignav` if you have a real Ignav API key |
   | `PORT` | Render sets this automatically; the app reads `process.env.PORT` |
   | `SENTRY_DSN` | optional — your Sentry project DSN; leave unset to run without error monitoring |
   | `SENTRY_ENVIRONMENT` | optional, e.g. `production` — defaults to `NODE_ENV` |

   The app **will not start** in production without both JWT secrets set — this is intentional (see `docs/ARCHITECTURE.md`'s auth section).

4. Deploy. Once it's live, run the migration once — either via Render's shell (`Shell` tab → `npm run migrate`), or locally with `DATABASE_URL` pointed at Neon:
   ```bash
   DATABASE_URL="postgresql://...neon..." PG_SSL=true npm run migrate
   ```
5. Confirm it's up: `curl https://your-backend.onrender.com/api/health`

**Cold starts**: Render's free tier spins down after inactivity. The first request after idle can take 30–60s. This is a platform limitation, not an app bug — worth mentioning if you're demoing this live.

## 3. Frontend — Vercel

1. In Vercel, **New Project**, import the same repo, set:
   - **Root directory**: `frontend`
   - **Framework preset**: Next.js (auto-detected)
2. Environment variables:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://your-backend.onrender.com/api` |
   | `NEXT_PUBLIC_MAPBOX_TOKEN` | optional, leave blank if unused |
   | `NEXT_PUBLIC_SENTRY_DSN` | optional — leave blank to run without error monitoring |

   **Important**: `NEXT_PUBLIC_*` variables are baked into the JS bundle at build time. If you change `NEXT_PUBLIC_API_URL` later, you need to trigger a new deploy — restarting the app isn't enough.
3. Deploy. Vercel gives you a URL like `https://flight-optimizer.vercel.app`.
4. Go back to Render and set `FRONTEND_URL` to this exact URL (needed for CORS to allow the frontend's requests).

## 4. Verify the full loop

```bash
curl https://your-backend.onrender.com/api/health
# then in a browser: visit your Vercel URL, register an account, run a search
```

If search fails with a CORS error in the browser console, double check `FRONTEND_URL` on the backend matches the Vercel URL exactly (including `https://`, no trailing slash).

## Local Docker alternative

If you'd rather not use three separate platforms, `docker-compose.yml` at the project root runs everything (Postgres + backend + frontend) on a single machine — see the root `README.md`. This is a reasonable choice for a local demo or a self-hosted VPS, but doesn't give you Vercel's CDN/edge network or Render's managed Postgres backups.

## What's NOT covered here

- **Custom domains / DNS** — both Render and Vercel support this in their dashboards; not app-specific.
- **Redis** — optional, supported via `REDIS_URL`. Sits in front of the existing Postgres `flight_cache` table as a fast, cross-instance layer, with an in-process memory layer in front of both (see Architecture doc for the full memory → Redis → Postgres chain). Leave `REDIS_URL` unset to run entirely on memory + Postgres caching — nothing else changes. Recommended once you're running more than one backend instance, since that's when a shared cache actually starts paying off over Postgres alone.
  - **Local/Docker**: `docker compose up` already includes a `redis` service; the backend container gets `REDIS_URL=redis://redis:6379` automatically. Redis being down or slow to start never blocks the backend container (see `docker-compose.yml`'s `depends_on` comment).
  - **Render**: add a Render Key Value instance (or any managed Redis, e.g. Upstash/Redis Cloud) and set `REDIS_URL` to its connection string in the backend service's environment variables. Use the `rediss://` (TLS) URL if the provider offers one.
- **Google Places** — optional, via `GOOGLE_PLACES_API_KEY`. Powers hotels/restaurants (`/api/places/:iataCode/hotels`, `/restaurants`) and tourist attractions. Leave unset to run without that data — everything else keeps working. **Docker**: make sure this (and `PLACES_CACHE_TTL_HOURS` if you override it) is set in the root `.env` — `docker-compose.yml` passes it through to the backend container.
- **Sentry error monitoring** — optional, supported via `SENTRY_DSN` (backend) and `NEXT_PUBLIC_SENTRY_DSN` (frontend). Leave both unset to run exactly as before, with no error monitoring and no extra network calls. See the root README's "Error monitoring (Sentry)" section for the full variable list. To also upload source maps during the Vercel build (readable stack traces instead of minified ones), set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` as build-time environment variables in Vercel — these are never sent to the browser.
- **Ignav** — optional, via `IGNAV_API_KEY` (get one at [ignav.com/signup](https://ignav.com/signup)). Set `FLIGHT_PROVIDER=ignav` to switch flight search to real, live fares; leave `FLIGHT_PROVIDER=mock` (the default) to keep using generated mock offers. `IGNAV_MARKET` (default `IN`) controls the currency Ignav prices fares in — leave it at `IN` so results stay in INR, matching this app's price display. Backend-only; never exposed to the frontend. Booking stays a dummy flow regardless of which flight provider is configured — Ignav's own booking-links endpoint is not wired up here.
- **Amadeus / Anthropic / Razorpay production keys** — none of these integrations are live-tested; see the root README's "Current status" section before enabling them for anything beyond experimentation.
- **PWA / service worker HTTPS requirement** — the installable PWA (see root README) needs a secure origin in production; Vercel provides HTTPS automatically for the frontend deployment above, so nothing extra is needed there. Self-hosting the frontend container elsewhere (the "Local Docker alternative" below) requires your own TLS termination in front of it — service workers simply won't register over plain HTTP on a non-localhost origin.
