const axios = require('axios');
const config = require('../../config/env');
const logger = require('../../logger/logger');
const AppError = require('../../utils/AppError');

/**
 * IGNAV FLIGHT PROVIDER
 * =====================
 * Real, live flight-offer data from https://ignav.com (POST /api/fares/*).
 * Auth is a single static X-Api-Key header — no OAuth token to acquire or
 * cache (unlike amadeusProvider.js), so this file is a little simpler than
 * that one, but keeps the same concurrency cap + retry/backoff shape so
 * behavior under load is consistent across providers.
 *
 * Every price returned by search() is the exact `amount`/`currency` Ignav
 * returned for that itinerary — nothing here invents, multiplies, or
 * "estimates" a price. If Ignav can't be reached or rejects the request,
 * this throws (see ignavPost) instead of returning anything price-shaped;
 * it is the caller's job to decide whether that's fatal or (for the
 * optimizer's per-candidate fetches) just drops that one candidate — this
 * module never substitutes mock data itself.
 */

const MAX_RETRIES = 3;
const MAX_CONCURRENT_REQUESTS = 5; // simple concurrency cap, mirrors amadeusProvider.js

let activeRequests = 0;
const queue = [];

function acquireSlot() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (activeRequests < MAX_CONCURRENT_REQUESTS) {
        activeRequests++;
        resolve();
      } else {
        queue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

function releaseSlot() {
  activeRequests--;
  const next = queue.shift();
  if (next) next();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Performs a POST request against Ignav with retry + error mapping.
 * - 401: invalid/missing API key — not retried, clear (non-leaking) error.
 * - 403: email not verified — not retried.
 * - 402: billing required/blocked — not retried; this is the "credentials
 *   are fine but the account can't be billed" case called out in the spec
 *   (must surface as a clear config/billing error, never silently fall
 *   back to fake prices).
 * - 429 (rate/spend limited) and 424/5xx (upstream trouble): retried with
 *   backoff up to MAX_RETRIES.
 * - other 4xx (invalid_request-shaped): our request was malformed for this
 *   search — surfaced as a 400 with Ignav's own field-level message (safe;
 *   never contains secrets).
 */
async function ignavPost(path, body, attempt = 1) {
  if (!config.ignav.apiKey) {
    throw new AppError(
      'Ignav credentials are not configured. Set IGNAV_API_KEY in .env, or use FLIGHT_PROVIDER=mock.',
      500,
      'IGNAV_NOT_CONFIGURED'
    );
  }

  await acquireSlot();
  try {
    const response = await axios.post(`${config.ignav.baseUrl}${path}`, body, {
      headers: {
        'X-Api-Key': config.ignav.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
    return response.data;
  } catch (err) {
    const status = err.response?.status;
    const errorBody = err.response?.data?.error;
    const code = errorBody?.code;

    if (status === 401) {
      logger.error('Ignav rejected the configured API key', { code });
      throw new AppError('Flight search provider rejected the configured API key.', 502, 'IGNAV_AUTH_ERROR');
    }

    if (status === 403) {
      logger.error('Ignav account is not ready', { code });
      throw new AppError(
        'Flight search provider account is not ready (email verification pending).',
        502,
        'IGNAV_ACCOUNT_ERROR'
      );
    }

    if (status === 402) {
      logger.error('Ignav billing issue', { code });
      throw new AppError(
        'Flight search provider billing is not set up, or payment failed. Real flight data is unavailable until this is resolved.',
        502,
        'IGNAV_BILLING_ERROR'
      );
    }

    if (status === 429 && attempt <= MAX_RETRIES) {
      const backoffMs = 500 * 2 ** attempt;
      logger.warn('Ignav spend/rate limited, backing off', { code, backoffMs, attempt });
      await sleep(backoffMs);
      return ignavPost(path, body, attempt + 1);
    }

    if ((status === 424 || status >= 500) && attempt <= MAX_RETRIES) {
      const backoffMs = 500 * 2 ** attempt;
      logger.warn('Ignav upstream error, retrying', { status, code, backoffMs, attempt });
      await sleep(backoffMs);
      return ignavPost(path, body, attempt + 1);
    }

    if (status >= 400 && status < 500) {
      logger.warn('Ignav rejected the search request', { status, code, field: errorBody?.field });
      throw new AppError(
        errorBody?.message || 'Flight search provider rejected the search parameters.',
        400,
        code || 'IGNAV_INVALID_REQUEST'
      );
    }

    logger.error('Ignav request failed', { path, status, code, message: err.message });
    throw new AppError(
      'Flight search provider is temporarily unavailable. Please try again shortly.',
      502,
      'IGNAV_PROVIDER_ERROR'
    );
  } finally {
    releaseSlot();
  }
}

/** Prefer the unambiguous UTC timestamp; fall back to local wall-clock time
 * only if Ignav omitted timezone/UTC data for that airport. */
function pickTimestamp(segment, which) {
  return segment[`${which}_time_utc`] || segment[`${which}_time_local`];
}

function normalizeSegment(segment) {
  return {
    airline: segment.marketing_carrier_code,
    flightNumber:
      segment.marketing_carrier_code && segment.flight_number
        ? `${segment.marketing_carrier_code}${segment.flight_number}`
        : segment.flight_number || '',
    fromIata: segment.departure_airport,
    toIata: segment.arrival_airport,
    departureTime: pickTimestamp(segment, 'departure'),
    arrivalTime: pickTimestamp(segment, 'arrival'),
    durationMinutes: segment.duration_minutes,
  };
}

function normalizeLeg(leg) {
  if (!leg) return null;
  return (leg.segments || []).map(normalizeSegment);
}

/**
 * True when `currency` denotes INR, tolerating the harmless formatting
 * variance a live API can return (case, e.g. "inr"/"Inr", and incidental
 * whitespace) without touching the actual amount. This is NOT a currency
 * *conversion* — a differently-cased/spaced label for the same currency is
 * still the exact amount Ignav quoted; rejecting it on formatting alone
 * would discard a perfectly valid real offer for no reason (see the docs
 * on this file's behavior around not needlessly dropping valid offers).
 */
function isInr(currency) {
  return typeof currency === 'string' && currency.trim().toUpperCase() === 'INR';
}

/**
 * Normalizes one Ignav itinerary into the FlightProviderContract shape.
 * Returns null (rather than a mislabeled or fabricated offer) when:
 *   - the price is missing, or its currency isn't INR once formatting
 *     variance (case/whitespace) is accounted for — we always request
 *     market=IN specifically so this shouldn't happen, but if it ever
 *     does, dropping the offer is the only option that doesn't risk
 *     displaying a foreign-currency amount as if it were INR. We never
 *     convert a non-INR amount ourselves — that would be exactly the kind
 *     of invented/estimated price this integration must not produce.
 *   - the price amount isn't actually a usable number (e.g. a provider
 *     glitch returning null/NaN/non-numeric) — again, dropping the offer
 *     rather than guessing a value.
 * A dropped itinerary is logged with the specific reason so a currency-
 * shape regression is distinguishable from a numeric-shape one.
 */
function normalizeItinerary(itinerary) {
  const { price } = itinerary;

  if (!price || !isInr(price.currency)) {
    logger.warn('Dropping Ignav itinerary with unexpected/missing currency', {
      currency: price?.currency,
      ignavId: itinerary.ignav_id,
    });
    return null;
  }

  const priceInr = typeof price.amount === 'number' ? price.amount : parseFloat(price.amount);
  if (!Number.isFinite(priceInr)) {
    logger.warn('Dropping Ignav itinerary with a non-numeric price amount', {
      amount: price.amount,
      ignavId: itinerary.ignav_id,
    });
    return null;
  }

  const outboundSegments = normalizeLeg(itinerary.outbound);
  const inboundSegments = normalizeLeg(itinerary.inbound);

  if (!outboundSegments || outboundSegments.length === 0) {
    return null;
  }

  const stops = outboundSegments.length - 1 + (inboundSegments ? inboundSegments.length - 1 : 0);

  return {
    id: itinerary.ignav_id,
    provider: 'ignav',
    priceInr,
    currency: 'INR',
    totalDurationMinutes:
      (itinerary.outbound?.duration_minutes || 0) + (itinerary.inbound?.duration_minutes || 0),
    stops,
    outbound: outboundSegments,
    inbound: inboundSegments,
    bookableUntil: null, // Ignav's fare search doesn't return a ticketing deadline
  };
}

async function search({
  originIata,
  destinationIata,
  departureDate,
  returnDate,
  adults = 1,
  cabinClass = 'economy',
}) {
  const body = {
    origin: originIata,
    destination: destinationIata,
    departure_date: departureDate,
    adults,
    cabin_class: cabinClass,
    market: config.ignav.market,
  };

  const path = returnDate ? '/fares/round-trip' : '/fares/one-way';
  if (returnDate) body.return_date = returnDate;

  const data = await ignavPost(path, body);
  const itineraries = data.itineraries || [];

  return itineraries
    .map(normalizeItinerary)
    .filter(Boolean)
    .sort((a, b) => a.priceInr - b.priceInr);
}

module.exports = { search };
