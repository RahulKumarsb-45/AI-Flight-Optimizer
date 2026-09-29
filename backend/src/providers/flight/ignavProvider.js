const axios = require('axios');
const config = require('../../config/env');
const logger = require('../../logger/logger');
const AppError = require('../../utils/AppError');

/**
 * IGNAV FLIGHT PROVIDER
 * =====================
 * Real live flight-offer data from IGNAV.
 *
 * Important:
 * - Never fabricates flight prices.
 * - Never falls back to mock data.
 * - Uses X-Api-Key authentication.
 * - Uses the official round-trip endpoint when returnDate is present.
 */

const MAX_RETRIES = 3;
const MAX_CONCURRENT_REQUESTS = 3;
const REQUEST_TIMEOUT_MS = 15000;

let activeRequests = 0;
const queue = [];

function acquireSlot() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (activeRequests < MAX_CONCURRENT_REQUESTS) {
        activeRequests += 1;
        resolve();
      } else {
        queue.push(tryAcquire);
      }
    };

    tryAcquire();
  });
}

function releaseSlot() {
  activeRequests = Math.max(0, activeRequests - 1);

  const next = queue.shift();
  if (next) {
    next();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST request to IGNAV with retry and error mapping.
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
    logger.info('Calling IGNAV flight API', {
      path,
      origin: body.origin,
      destination: body.destination,
      departureDate: body.departure_date,
      returnDate: body.return_date || null,
      attempt,
    });

    const response = await axios.post(
      `${config.ignav.baseUrl}${path}`,
      body,
      {
        headers: {
          'X-Api-Key': config.ignav.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      }
    );

    const status = response.status;
    const data = response.data;
    const errorBody = data?.error;
    const code = errorBody?.code;

    /*
     * Success
     */
    if (status >= 200 && status < 300) {
      logger.info('IGNAV flight API success', {
        path,
        status,
        itineraryCount: Array.isArray(data?.itineraries)
          ? data.itineraries.length
          : 0,
      });

      return data;
    }

    /*
     * Authentication
     */
    if (status === 401) {
      logger.error('IGNAV rejected API key', {
        status,
        code,
      });

      throw new AppError(
        'Flight search provider rejected the configured API key.',
        502,
        'IGNAV_AUTH_ERROR'
      );
    }

    /*
     * Account not ready / verification
     */
    if (status === 403) {
      logger.error('IGNAV account is not ready', {
        status,
        code,
      });

      throw new AppError(
        'Flight search provider account is not ready (email verification pending).',
        502,
        'IGNAV_ACCOUNT_ERROR'
      );
    }

    /*
     * Billing / credits
     */
    if (status === 402) {
      logger.error('IGNAV billing issue', {
        status,
        code,
      });

      throw new AppError(
        'Flight search provider billing is not set up, or payment failed. Real flight data is unavailable until this is resolved.',
        502,
        'IGNAV_BILLING_ERROR'
      );
    }

    /*
     * Rate limit / spend limit
     */
    if (status === 429 && attempt <= MAX_RETRIES) {
      const backoffMs = 1000 * 2 ** (attempt - 1);

      logger.warn('IGNAV rate limited, retrying', {
        status,
        code,
        attempt,
        backoffMs,
      });

      await sleep(backoffMs);

      return ignavPost(path, body, attempt + 1);
    }

    /*
     * Upstream errors
     */
    if ((status === 424 || status >= 500) && attempt <= MAX_RETRIES) {
      const backoffMs = 1000 * 2 ** (attempt - 1);

      logger.warn('IGNAV upstream error, retrying', {
        status,
        code,
        attempt,
        backoffMs,
      });

      await sleep(backoffMs);

      return ignavPost(path, body, attempt + 1);
    }

    /*
     * Invalid request
     */
    if (status >= 400 && status < 500) {
      logger.warn('IGNAV rejected flight search request', {
        status,
        code,
        field: errorBody?.field,
        message: errorBody?.message,
      });

      throw new AppError(
        errorBody?.message ||
          'Flight search provider rejected the search parameters.',
        400,
        code || 'IGNAV_INVALID_REQUEST'
      );
    }

    /*
     * Unknown upstream failure
     */
    logger.error('IGNAV flight request failed', {
      path,
      status,
      code,
      response: data,
    });

    throw new AppError(
      'Flight search provider is temporarily unavailable. Please try again shortly.',
      502,
      'IGNAV_PROVIDER_ERROR'
    );
  } catch (err) {
    /*
     * Axios timeout/network failure.
     *
     * These errors have no HTTP response.
     */
    if (
      err.code === 'ECONNABORTED' ||
      err.code === 'ETIMEDOUT' ||
      err.message?.toLowerCase().includes('timeout')
    ) {
      logger.error('IGNAV flight API timeout', {
        path,
        timeoutMs: REQUEST_TIMEOUT_MS,
        attempt,
        origin: body.origin,
        destination: body.destination,
        departureDate: body.departure_date,
        returnDate: body.return_date || null,
      });

      if (attempt <= MAX_RETRIES) {
        const backoffMs = 1000 * 2 ** (attempt - 1);

        logger.warn('Retrying IGNAV request after timeout', {
          attempt,
          nextAttempt: attempt + 1,
          backoffMs,
        });

        await sleep(backoffMs);

        return ignavPost(path, body, attempt + 1);
      }

      throw new AppError(
        'Ignav flight search timed out after multiple attempts. The flight provider did not respond in time.',
        502,
        'IGNAV_TIMEOUT'
      );
    }

    /*
     * Network / DNS / connection failure
     */
    if (!err.response) {
      logger.error('IGNAV network request failed', {
        path,
        code: err.code,
        message: err.message,
        attempt,
      });

      if (attempt <= MAX_RETRIES) {
        const backoffMs = 1000 * 2 ** (attempt - 1);

        await sleep(backoffMs);

        return ignavPost(path, body, attempt + 1);
      }

      throw new AppError(
        'Unable to connect to the flight search provider.',
        502,
        'IGNAV_NETWORK_ERROR'
      );
    }

    /*
     * AppError already created above.
     */
    if (err instanceof AppError) {
      throw err;
    }

    throw err;
  } finally {
    releaseSlot();
  }
}

/**
 * Prefer UTC timestamp.
 * Fall back to local timestamp when UTC is unavailable.
 */
function pickTimestamp(segment, which) {
  return (
    segment[`${which}_time_utc`] ||
    segment[`${which}_time_local`]
  );
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
  if (!leg) {
    return null;
  }

  return (leg.segments || []).map(normalizeSegment);
}

function isInr(currency) {
  return (
    typeof currency === 'string' &&
    currency.trim().toUpperCase() === 'INR'
  );
}

/**
 * Normalize one IGNAV itinerary.
 *
 * IMPORTANT:
 * Price is taken directly from IGNAV.
 * No conversion or estimation.
 */
function normalizeItinerary(itinerary) {
  const { price } = itinerary;

  if (!price || !isInr(price.currency)) {
    logger.warn(
      'Dropping IGNAV itinerary with unexpected/missing currency',
      {
        currency: price?.currency,
        ignavId: itinerary.ignav_id,
      }
    );

    return null;
  }

  const priceInr =
    typeof price.amount === 'number'
      ? price.amount
      : parseFloat(price.amount);

  if (!Number.isFinite(priceInr)) {
    logger.warn(
      'Dropping IGNAV itinerary with invalid price amount',
      {
        amount: price.amount,
        ignavId: itinerary.ignav_id,
      }
    );

    return null;
  }

  const outboundSegments = normalizeLeg(
    itinerary.outbound
  );

  const inboundSegments = normalizeLeg(
    itinerary.inbound
  );

  if (
    !outboundSegments ||
    outboundSegments.length === 0
  ) {
    return null;
  }

  const outboundStops =
    outboundSegments.length - 1;

  const inboundStops = inboundSegments
    ? inboundSegments.length - 1
    : 0;

  return {
    id: itinerary.ignav_id,

    provider: 'ignav',

    priceInr,

    currency: 'INR',

    totalDurationMinutes:
      (itinerary.outbound?.duration_minutes || 0) +
      (itinerary.inbound?.duration_minutes || 0),

    stops:
      outboundStops + inboundStops,

    outbound: outboundSegments,

    inbound: inboundSegments,

    bookableUntil: null,
  };
}

/**
 * Search IGNAV flights.
 *
 * returnDate present:
 *   POST /fares/round-trip
 *
 * returnDate absent:
 *   POST /fares/one-way
 */
async function search({
  originIata,
  destinationIata,
  departureDate,
  returnDate,
  adults = 1,
  cabinClass = 'economy',
}) {
  if (!originIata || !destinationIata) {
    throw new AppError(
      'Origin and destination airports are required.',
      400,
      'IGNAV_INVALID_ROUTE'
    );
  }

  if (!departureDate) {
    throw new AppError(
      'Departure date is required.',
      400,
      'IGNAV_INVALID_DEPARTURE_DATE'
    );
  }

  if (returnDate && returnDate < departureDate) {
    throw new AppError(
      'Return date cannot be earlier than departure date.',
      400,
      'IGNAV_INVALID_RETURN_DATE'
    );
  }

  const body = {
    origin: originIata,
    destination: destinationIata,
    departure_date: departureDate,
    adults,
    cabin_class: cabinClass,
    market: config.ignav.market,
  };

  const path = returnDate
    ? '/fares/round-trip'
    : '/fares/one-way';

  if (returnDate) {
    body.return_date = returnDate;
  }

  logger.info('Starting IGNAV flight search', {
    origin: originIata,
    destination: destinationIata,
    departureDate,
    returnDate: returnDate || null,
    adults,
    cabinClass,
    market: config.ignav.market,
    endpoint: path,
  });

  const data = await ignavPost(path, body);

  const itineraries = Array.isArray(data?.itineraries)
    ? data.itineraries
    : [];

  const normalized = itineraries
    .map(normalizeItinerary)
    .filter(Boolean)
    .sort(
      (a, b) => a.priceInr - b.priceInr
    );

  logger.info('IGNAV flight search completed', {
    origin: originIata,
    destination: destinationIata,
    returnDate: returnDate || null,
    rawItineraries: itineraries.length,
    validItineraries: normalized.length,
  });

  return normalized;
}

module.exports = {
  search,
};