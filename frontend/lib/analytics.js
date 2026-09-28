/**
 * Centralized Google Analytics 4 (GA4) helper.
 *
 * Design goals (see docs/PRIVACY.md-equivalent notes in README.md):
 *  - Fully disabled whenever NEXT_PUBLIC_GA_MEASUREMENT_ID is unset — no
 *    script is injected, no network calls happen, nothing else changes.
 *  - Never throws. A blocked/failed/missing gtag must never break the app
 *    (search, AI agent, auth, Razorpay, hotels, weather, Sentry, rendering).
 *  - Single choke point for outbound event parameters, so the "never send
 *    PII/secrets" rule only has to be enforced in one place instead of at
 *    every call site. Mirrors the same intent as
 *    backend/src/sentry/scrubEvent.js, just for the frontend/GA side.
 */

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '';

export const isAnalyticsEnabled = Boolean(GA_MEASUREMENT_ID);

// Key names that must never leave the browser as an event/user property,
// even if a call site accidentally includes them. Defense-in-depth, not a
// replacement for being careful about what gets passed in.
const BLOCKED_KEY_PATTERN =
  /pass|secret|token|auth|apikey|api[_-]?key|cookie|jwt|card|cvv|razorpay|signature|email|phone|ssn|dob|address/i;

// Only plain strings, numbers, and booleans are allowed through as event
// parameter values — objects/arrays could accidentally carry nested PII
// (e.g. a full API response) and gtag doesn't need them anyway.
function sanitizeParams(params) {
  if (!params || typeof params !== 'object') return undefined;

  const clean = {};
  for (const [key, value] of Object.entries(params)) {
    if (BLOCKED_KEY_PATTERN.test(key)) continue;
    if (value === undefined || value === null) continue;

    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') {
      // Cap string length defensively — event params are meant to be short
      // labels/ids, not free text (and free text is where PII tends to hide).
      clean[key] = type === 'string' && value.length > 100 ? value.slice(0, 100) : value;
    }
  }
  return clean;
}

function callGtag(...args) {
  if (!isAnalyticsEnabled) return;
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;

  try {
    window.gtag(...args);
  } catch {
    // Analytics must never break the app — swallow and move on.
  }
}

/**
 * Records a page_view for a client-side route change. The initial page load
 * is handled by the gtag config call itself (with send_page_view: false, so
 * it isn't double-counted) — see components/analytics/GoogleAnalytics.jsx.
 */
export function trackPageView(url) {
  if (!url) return;
  callGtag('event', 'page_view', {
    page_path: url,
  });
}

/**
 * Generic event helper. Prefer one of the named helpers below for anything
 * that recurs across the app — they document which parameters are
 * considered safe for that event so call sites don't have to re-derive it.
 */
export function trackEvent(eventName, params) {
  if (!eventName || typeof eventName !== 'string') return;
  callGtag('event', eventName, sanitizeParams(params));
}

// ---------------------------------------------------------------------------
// Named helpers for the app's actual user actions. Keeping these here (vs.
// scattering raw trackEvent calls with inline param objects) makes it a lot
// easier to see, in one file, exactly what data ever goes to GA.
// ---------------------------------------------------------------------------

export function trackFlightSearch({ origin, destinations, tripType, travelers, preference, dateFlexible, nearbyAirportsEnabled }) {
  trackEvent('flight_search', {
    origin,
    destination: Array.isArray(destinations) ? destinations.join(',') : destinations,
    trip_type: tripType,
    passengers: travelers,
    cabin_class: 'economy', // this app doesn't collect cabin class; all fares are economy
    preference,
    date_flexible: Boolean(dateFlexible),
    nearby_airports_enabled: Boolean(nearbyAirportsEnabled),
  });
}

// There's no live flight booking in this app (dummy/mock only). "Selecting"
// a flight means expanding a recommendation to inspect its flight legs —
// the closest real analog to picking an option out of the list.
export function trackSelectFlight({ rank, isTopPick, usesNearbyAirport }) {
  trackEvent('select_flight', {
    rank,
    is_top_pick: Boolean(isTopPick),
    uses_nearby_airport: Boolean(usesNearbyAirport),
  });
}

export function trackAIAgentMessage({ action, success, page = 'ai-agent' }) {
  // Never pass the actual chat message/content here.
  trackEvent('ai_agent_message', {
    action,
    success: Boolean(success),
    page,
  });
}

export function trackLogin({ method }) {
  trackEvent('login', { method });
}

export function trackSignUp({ method }) {
  trackEvent('sign_up', { method });
}

export function trackBeginCheckout({ plan, valueInr }) {
  trackEvent('begin_checkout', {
    plan,
    currency: 'INR',
    value: valueInr,
  });
}

export function trackPurchase({ plan, valueInr, orderId }) {
  trackEvent('purchase', {
    plan,
    currency: 'INR',
    value: valueInr,
    transaction_id: orderId, // Razorpay order id — not sensitive on its own
  });
}

export function trackHotelSearch({ iataCode, resultCount }) {
  trackEvent('hotel_search', { iata_code: iataCode, result_count: resultCount });
}

export function trackSelectHotel({ iataCode, hasRating }) {
  trackEvent('select_hotel', { iata_code: iataCode, has_rating: Boolean(hasRating) });
}

export function trackRestaurantSearch({ iataCode, resultCount }) {
  trackEvent('restaurant_search', { iata_code: iataCode, result_count: resultCount });
}

export function trackSelectRestaurant({ iataCode, hasRating }) {
  trackEvent('select_restaurant', { iata_code: iataCode, has_rating: Boolean(hasRating) });
}

export function trackAttractionSearch({ iataCode, resultCount }) {
  trackEvent('attraction_search', { iata_code: iataCode, result_count: resultCount });
}

export function trackSelectAttraction({ iataCode, hasRating }) {
  trackEvent('select_attraction', { iata_code: iataCode, has_rating: Boolean(hasRating) });
}
