# API Reference

Base URL: `http://localhost:5000/api` (local) — all endpoints below are relative to this.

All responses use the envelope:
```json
{ "status": "success" | "error", "data": { ... } }
```
Errors additionally include `errorCode` (machine-readable) and `requestId` (for support/debugging):
```json
{ "status": "error", "errorCode": "AUTH_INVALID_CREDENTIALS", "message": "...", "requestId": "..." }
```

**Auth**: routes marked 🔒 require `Authorization: Bearer <accessToken>`. Routes marked 🔓 work without a token but behave differently if one is present (guest vs logged-in).

---

## Auth

### `POST /auth/register`
```json
{ "name": "Rao", "email": "rao@example.com", "password": "Password123" }
```
Password must be 8+ characters with at least one uppercase letter and one number. Returns the created user (sanitized — no password hash) and creates a default `free`-tier subscription row.

### `POST /auth/login`
```json
{ "email": "rao@example.com", "password": "Password123" }
```
Returns `{ user, accessToken }` and sets an httpOnly `refresh_token` cookie. 5 failed attempts locks the account for 15 minutes (`423 AUTH_ACCOUNT_LOCKED`).

### `POST /auth/refresh`
No body — reads the `refresh_token` cookie. Returns a new `accessToken` and rotates the refresh cookie. Reusing an already-rotated refresh token revokes **all** sessions for that user (`401 AUTH_REFRESH_REUSE_DETECTED`).

### `POST /auth/logout`
No body. Revokes the current session and clears the cookie. Safe to call with no active session.

### `GET /auth/me` 🔒
Returns the current user's full profile (name, email, auth_provider, email_verified, created_at, etc.).

### `GET /auth/google`
Redirects to Google's consent screen. Requires `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to be configured — see `backend/.env.example`.

### `GET /auth/google/callback`
Google redirects back here after consent. Validates the OAuth `state` param (CSRF protection), exchanges the auth code, finds-or-creates the user, issues a session the same way `/auth/login` does, then redirects to the frontend.

> GitHub OAuth has been permanently removed from this project. Only Google OAuth and email/password authentication are supported.

---

## Airports

### `GET /airports?q=<query>&limit=<n>`
Autocomplete search by IATA code, city, or airport name. `limit` defaults to 8, max 25.

### `GET /airports/regions`
List of all regions in the dataset (e.g. `"South Asia"`, `"Europe"`).

### `GET /airports/:iataCode`
Single airport detail. `404 AIRPORT_NOT_FOUND` if the code isn't in the dataset.

### `GET /airports/:iataCode/nearby?limit=<n>&maxDistanceKm=<n>`
Nearby airports ranked by distance + hub importance. `limit` default/max is the server's `MAX_NEARBY_AIRPORTS` config (default 3, cap 10 per-request). `maxDistanceKm` defaults to 300.

---

## Countries

### `GET /countries`
All countries represented in the airport dataset, with region.

### `GET /countries/:countryCode/airports`
Airports in a given 2-letter ISO country code, ranked by hub importance.

---

## Trip Optimizer

### `POST /trips/optimize` 🔓
The main endpoint. Runs the full optimizer pipeline (see `docs/ARCHITECTURE.md`).

```json
{
  "originIata": "DEL",
  "destinationCountries": ["GB"],
  "departureDate": "2026-08-15",
  "returnDate": "2026-08-22",
  "dateFlexible": false,
  "minStayDays": null,
  "maxStayDays": null,
  "travelers": 2,
  "budgetInr": 250000,
  "preference": "balanced",
  "nearbyAirportsEnabled": true,
  "cabinClass": "economy"
}
```

| Field | Required | Notes |
|---|---|---|
| `originIata` | yes | Must exist in the airport dataset |
| `destinationCountries` | yes | Array, 1–4 ISO country codes |
| `departureDate` | yes | `YYYY-MM-DD` |
| `returnDate` | no | Omit for one-way |
| `dateFlexible` | no | Searches ±3 days if true |
| `minStayDays` / `maxStayDays` | no | Only meaningful with `dateFlexible`; range width capped at 7 days server-side |
| `travelers` | no | 1–9, default 1 |
| `budgetInr` | no | Total trip budget across all travelers, ≥ ₹1,000 |
| `preference` | no | `cheapest` \| `fastest` \| `balanced`, default `balanced` |
| `nearbyAirportsEnabled` | no | default `true` |
| `cabinClass` | no | `economy` \| `premium_economy` \| `business` \| `first` |

If a valid access token is provided, the result is persisted and `data.tripId` is returned (guests get `tripId: null`).

Response shape:
```json
{
  "data": {
    "tripId": "uuid | null",
    "recommendations": [ /* top 5, each with legs, pricing, explanation, budgetInsight */ ],
    "budgetOptimizer": { /* see below */ },
    "categories": { "cheapest": {...}, "fastest": {...}, "balanced": {...} },
    "meta": { "permutations": {...}, "pruning": {...}, "resultCount": 5, "budgetSuggestion": {...} }
  }
}
```

#### Budget Optimizer fields

All populated only when `budgetInr` is included in the request — otherwise `budgetInsight` is `null` per recommendation, and `budgetOptimizer`/`meta.budgetSuggestion` are `null`. No new endpoint or paid API is involved; every field below combines real data the optimizer already computed (flight price, trip length, and — for `budgetOptimizer`'s over-budget case — the real cheapest candidate that got pruned) with the requested budget. Nothing here makes an extra flight-search call or invents a price, date, or destination.

Each `recommendations[i].budgetInsight`:
```json
{
  "flightCostInr": 101000,
  "budgetInr": 150000,
  "remainingAfterFlightInr": 49000,
  "nights": 5,
  "dailyLivingCostRangeInr": { "min": 3000, "max": 8000 },
  "estimatedTripLivingCostInr": { "min": 15000, "max": 40000 },
  "categoryBreakdown": { "accommodation": {...}, "food": {...}, "localTransport": {...} },
  "estimatedTotalTripCostInr": { "min": 116000, "max": 141000 },
  "suggestedDailyBudgetInr": 9800,
  "status": "comfortable",
  "fitSummary": "Flight cost plus the estimated stay, food, and local-travel range fits within your budget, leaving at least ₹9,000 of headroom.",
  "note": "Stay/food/local-travel figures are a general planning range, not real prices for this destination — no hotel, food, or local-transport pricing source is configured."
}
```
- `status` is one of `comfortable` | `tight` | `over` | `unknown` (`unknown` when there's no return date, so trip length — and therefore a living-cost estimate — can't be computed).
- The stay/food/local-travel range comes from `BUDGET_DAILY_MIN_INR` / `BUDGET_DAILY_MAX_INR` (see `backend/.env.example`), split into `categoryBreakdown` by `BUDGET_ACCOMMODATION_SHARE` / `BUDGET_FOOD_SHARE` / `BUDGET_LOCAL_TRANSPORT_SHARE` — a configurable, destination-agnostic heuristic, not a per-city price lookup.

**`budgetOptimizer`** — the single "here's the smart answer" object, built from `optimizer/budget/budgetEstimator.js#selectBudgetOptimizerPick`:

When one or more real candidates fit the budget (`status: "within_budget"`):
```json
{
  "status": "within_budget",
  "bestValueCandidate": { /* the real candidate object, same shape as a recommendation */ },
  "budgetInsight": { /* that candidate's own budgetInsight, as above */ },
  "reason": "Out of 6 options that fit your budget, this one has an estimated total trip cost of ₹1,16,000–₹1,41,000 and a 9h total trip time — the best real balance of cost and budget fit found in this search.",
  "cheapestRealCandidate": null,
  "requiredBudgetIncreaseInr": null,
  "suggestion": null
}
```
`bestValueCandidate` is chosen from the same real, already budget-filtered candidate set as `recommendations`/`categories` — ranked by estimated total trip cost (flight + stay/food/local-travel midpoint), with trip duration as a tie-breaker only. It is never a fresh lookup or an invented price.

When nothing fits (`status: "over_budget"`):
```json
{
  "status": "over_budget",
  "bestValueCandidate": null,
  "budgetInsight": null,
  "reason": null,
  "cheapestRealCandidate": { /* the real cheapest candidate that was pruned for being over budget, or null if none exists */ },
  "requiredBudgetIncreaseInr": 15000,
  "suggestion": { "suggestedBudgetInr": 92000, "alternateDate": "2026-08-18", "alternateDestinationCity": "Bangkok", "message": "..." }
}
```
`suggestion` mirrors `meta.budgetSuggestion` below. `alternateDate`/`alternateDestinationCity` are only populated when the real cheapest over-budget candidate actually differs from the requested date/destination — never fabricated. `requiredBudgetIncreaseInr` is `cheapestRealCandidate`'s price minus the requested budget, or `null` when no over-budget candidate exists at all (e.g. the search itself returned nothing).

`meta.budgetSuggestion` (present only when the budget filtered out the cheapest available option(s)) — kept for backward compatibility, identical in content to `budgetOptimizer.suggestion`:
```json
{ "suggestedBudgetInr": 92000, "alternateDate": null, "alternateDestinationCity": null, "message": "Your budget wasn't quite enough for any trip we found — raising it to about ₹92,000 would unlock at least one option." }
```
`suggestedBudgetInr` is always a real price observed during that same search (the cheapest candidate that was pruned for being over budget) — never an invented figure.

### `GET /trips` 🔒
Your recent trips (max 50), most recent first.

### `GET /trips/saved` 🔒
Your saved trips, joined with full trip data.

### `GET /trips/:tripId` 🔒
Full detail for one of your trips (`404 TRIP_NOT_FOUND` if it doesn't belong to you).

### `POST /trips/:tripId/save` 🔒
Save a trip you own. Body: `{ "notes": "optional string" }`.

### `DELETE /trips/:tripId/save` 🔒
Remove a trip from your saved list.

---

## Places

Backed by Google Places API (New) — requires `GOOGLE_PLACES_API_KEY` (see `backend/.env.example`). Returns `502 PLACES_PROVIDER_ERROR` if the provider call fails, or `500 PLACES_NOT_CONFIGURED` if no key is set.

### `GET /places/:iataCode/attractions` 🔓
Tourist attractions/places of interest near the airport's city (10km radius), for the destination's "things to do" section. Distinct from `/places/:iataCode/hotels` and `/places/:iataCode/restaurants`. Response:
```json
{
  "status": "success",
  "data": {
    "city": "Paris",
    "attractions": [
      {
        "id": "...",
        "name": "Eiffel Tower",
        "description": "Iconic 19th-century iron tower...",
        "category": "Tourist attraction",
        "address": "Champ de Mars, 5 Av. Anatole France, 75007 Paris",
        "rating": 4.6,
        "ratingCount": 340000,
        "mapsUri": "https://maps.google.com/?cid=...",
        "location": { "lat": 48.8584, "lon": 2.2945 },
        "photoName": "places/.../photos/..."
      }
    ]
  }
}
```
`description` and `category` are only populated when Google Places provides them for that place (`editorialSummary` / `primaryTypeDisplayName`) — no data is invented when absent. Use `photoName` with `GET /places/photo?name=...` (existing endpoint) to render a photo.

---

## Legacy single-leg search

### `GET /search/flights?origin=DEL&destination=LHR&departureDate=2026-08-15&adults=1` 🔓
Direct one-leg flight search, bypassing the optimizer entirely. Used internally by the optimizer's flight-fetch stage; also usable standalone. Note: unlike `/trips/optimize`, this endpoint writes to the `search_history` table when authenticated — the frontend does not currently call this endpoint or surface that history anywhere.

---

## Health

### `GET /health`
No auth. Returns `{ status: "success", message: "OK", timestamp }`. Used by Docker healthchecks and CI smoke tests.
