const { AIRPORTS } = require('./airportData');
const ignavAirportProvider = require('./ignavAirportProvider');
const { haversineDistanceKm } = require('../../utils/distance');
const { staticCache } = require('../../cache/memoryCache');
const config = require('../../config/env');
const logger = require('../../logger/logger');
const AppError = require('../../utils/AppError');

const STATIC_TTL_MS = config.cache.staticTtlHours * 60 * 60 * 1000;

// Build lookup indexes once at module load (dataset is static/in-memory).
const byIata = new Map(AIRPORTS.map((a) => [a.iata, a]));
const byCountryCode = AIRPORTS.reduce((acc, a) => {
  (acc[a.countryCode] ||= []).push(a);
  return acc;
}, {});
const byRegion = AIRPORTS.reduce((acc, a) => {
  (acc[a.region] ||= []).push(a);
  return acc;
}, {});

/**
 * Airports learned from Ignav (the external, primary source) that aren't in
 * our curated local dataset. Populated as a side effect of search() and of
 * lookupExternalByCode(), keyed by uppercase IATA/airport code. This is what
 * lets requireByIata() (sync, used throughout the app) accept an airport
 * that only Ignav knows about, without requireByIata() itself needing to
 * become async and ripple a network call into every one of its callers
 * (several of which — the optimizer's airportExpansion.js, mockProvider.js —
 * are flight-search internals that are explicitly out of scope right now).
 *
 * Ignav's AirportModel never includes coordinates or a 2-letter country
 * code, so entries here normally have lat/lon/countryCode/region left
 * unset unless enrichWithLocal() found a matching local record to fill
 * them in. Nothing in this file invents those values.
 */
const externalAirportCache = new Map();

// ------------------------------------------------------------------
function getByIata(iataCode) {
  if (!iataCode) return null;
  return byIata.get(iataCode.toUpperCase()) || null;
}

/**
 * Resolves an IATA/airport code to an airport record, accepting airports
 * that are only known via Ignav (the external, primary source) as long as
 * they've previously turned up in a search() or lookupExternalByCode()
 * call and are sitting in externalAirportCache. Purely local + in-memory —
 * see the externalAirportCache doc comment above for why this doesn't make
 * a live network call itself. For a standalone lookup that's allowed to hit
 * Ignav live on a cache miss, use resolveByIata() instead.
 */
function requireByIata(iataCode) {
  if (!iataCode) {
    throw new AppError('Unknown airport code: (empty)', 400, 'AIRPORT_NOT_FOUND');
  }
  const code = iataCode.toUpperCase();
  const airport = byIata.get(code) || externalAirportCache.get(code);
  if (!airport) {
    throw new AppError(`Unknown airport code: ${iataCode}`, 400, 'AIRPORT_NOT_FOUND');
  }
  return airport;
}

/**
 * Normalizes one Ignav AirportModel ({ code, name, city, country }) into
 * this app's internal airport shape. Fields Ignav doesn't provide
 * (lat/lon/countryCode/region/rank/timezone) are left undefined here —
 * enrichWithLocal() fills them in only when a local record for the same
 * code actually exists.
 */
function normalizeIgnavAirport(raw) {
  return {
    iata: (raw.code || '').toUpperCase(),
    name: raw.name,
    city: raw.city,
    country: raw.country,
    source: 'ignav',
  };
}

/**
 * Enriches a normalized Ignav airport with local dataset fields (lat/lon,
 * countryCode, region, rank, timezone) when the code matches a known local
 * airport. Ignav's own name/city/country/code stay authoritative (it's the
 * primary source) — only the fields Ignav doesn't return are filled in.
 */
function enrichWithLocal(ignavAirport) {
  const local = byIata.get(ignavAirport.iata);
  if (!local) return ignavAirport;
  return {
    ...ignavAirport,
    countryCode: local.countryCode,
    region: local.region,
    lat: local.lat,
    lon: local.lon,
    timezone: local.timezone,
    rank: local.rank,
    source: 'ignav+local',
  };
}

/**
 * Live Ignav lookup for one exact code, used as a fallback when both the
 * local dataset and externalAirportCache miss (i.e. this exact code has
 * never turned up in a prior search()). Never throws — a failure here
 * (no key configured, Ignav down, no match) just means "couldn't resolve
 * it externally either", which the caller (resolveByIata) turns into the
 * normal AIRPORT_NOT_FOUND error rather than a 502.
 */
async function lookupExternalByCode(iataCode) {
  const code = iataCode.toUpperCase();
  try {
    const raw = await ignavAirportProvider.searchAirports(code, 10);
    const match = raw.find((a) => (a.code || '').toUpperCase() === code);
    if (!match) return null;
    const enriched = enrichWithLocal(normalizeIgnavAirport(match));
    externalAirportCache.set(code, enriched);
    return enriched;
  } catch (err) {
    logger.warn('Ignav live lookup-by-code failed', { code, message: err.message });
    return null;
  }
}

/**
 * Async counterpart to requireByIata(): local dataset -> externalAirportCache
 * -> a live Ignav lookup as a last resort. Use this for standalone
 * "resolve this one code" entry points (e.g. GET /api/airports/:iataCode)
 * that aren't on the synchronous flight-search call path.
 */
async function resolveByIata(iataCode) {
  if (!iataCode) {
    throw new AppError('Unknown airport code: (empty)', 400, 'AIRPORT_NOT_FOUND');
  }
  const code = iataCode.toUpperCase();
  const known = byIata.get(code) || externalAirportCache.get(code);
  if (known) return known;

  const viaLive = await lookupExternalByCode(code);
  if (viaLive) return viaLive;

  throw new AppError(`Unknown airport code: ${iataCode}`, 400, 'AIRPORT_NOT_FOUND');
}

/**
 * Scores the local dataset only (no network), sorted best-match-first but
 * NOT truncated — this was the entire body of search() before Ignav was
 * wired in. Callers slice to whatever count they actually need; leaving the
 * truncation to the caller matters because search() first has to drop
 * codes Ignav already returned, and truncating here first could otherwise
 * discard a good local match that would've made the cut after that filter.
 */
function scoreLocalAirports(q) {
  return AIRPORTS.map((a) => {
    const iata = a.iata.toLowerCase();
    const city = a.city.toLowerCase();
    const name = a.name.toLowerCase();

    let score = -1;
    if (iata === q) score = 100;
    else if (iata.startsWith(q)) score = 90;
    else if (city.startsWith(q)) score = 80;
    else if (name.startsWith(q)) score = 70;
    else if (city.includes(q)) score = 50;
    else if (name.includes(q)) score = 40;
    else if (a.country.toLowerCase().includes(q)) score = 20;

    return { airport: a, score };
  })
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score || y.airport.rank - x.airport.rank)
    .map((s) => s.airport);
}

/**
 * Autocomplete search: Ignav (https://ignav.com/api/airports) is now the
 * PRIMARY source — its own relevance ranking is trusted as-is and returned
 * first, enriched with local lat/lon/countryCode/region/rank where we have
 * a matching local record. The local 113-airport dataset never limits what
 * can be found: it only (a) enriches Ignav matches with fields Ignav
 * doesn't provide, and (b) fills out the rest of the list, up to `limit`,
 * with local-only matches Ignav didn't already return.
 *
 * If Ignav is unreachable, misconfigured, or errors, this logs a warning
 * and falls back to local-only results rather than failing the whole
 * autocomplete request — that's a real (if smaller) dataset, not fabricated
 * data, so it's a reasonable degrade path (unlike flight prices, which this
 * codebase deliberately never falls back on — see providerFactory.js).
 */
async function search(queryText, limit = 8) {
  if (!queryText || queryText.trim().length === 0) return [];

  const cacheKey = `airport_search:${queryText.toLowerCase()}:${limit}`;
  const cached = staticCache.get(cacheKey);
  if (cached) return cached;

  const q = queryText.trim().toLowerCase();

  let ignavMatches = [];
  try {
    const raw = await ignavAirportProvider.searchAirports(queryText.trim(), limit);
    ignavMatches = raw.map((a) => enrichWithLocal(normalizeIgnavAirport(a)));
    for (const a of ignavMatches) {
      if (a.iata) externalAirportCache.set(a.iata, a);
    }
  } catch (err) {
    logger.warn('Ignav airport search failed, falling back to local dataset only', { message: err.message });
  }

  const seenCodes = new Set(ignavMatches.map((a) => a.iata));
  const remaining = Math.max(0, limit - ignavMatches.length);
  const localFill = remaining > 0
    ? scoreLocalAirports(q).filter((a) => !seenCodes.has(a.iata)).slice(0, remaining)
    : [];

  const results = [...ignavMatches, ...localFill].slice(0, limit);

  staticCache.set(cacheKey, results, STATIC_TTL_MS);
  return results;
}

/**
 * Returns the N nearest airports to a given, already-resolved airport
 * object, ranked by a blend of distance and hub importance (so a
 * slightly-farther major hub can beat a tiny regional strip). Excludes the
 * airport itself.
 *
 * Extracted out of getNearbyAirports() so callers that resolve their origin
 * asynchronously (e.g. the airport-nearby endpoint, via resolveByIata) can
 * reuse the same distance logic without a second, redundant requireByIata()
 * call. The candidate pool is the local dataset plus any externally-cached
 * airports that actually have coordinates (enrichWithLocal() is the only
 * thing that ever sets those, so today this only ever adds airports Ignav
 * and our local dataset agree on — but the code doesn't assume that will
 * always be true).
 */
function getNearbyAirportsFor(origin, limit = config.optimizer.maxNearbyAirports, maxDistanceKm = 300) {
  if (origin.lat == null || origin.lon == null) {
    logger.warn('Cannot compute nearby airports: origin has no coordinates (external-only airport)', {
      iata: origin.iata,
    });
    return [];
  }

  const externalWithCoords = Array.from(externalAirportCache.values())
    .filter((a) => a.lat != null && a.lon != null && !byIata.has(a.iata));
  const pool = [...AIRPORTS, ...externalWithCoords];

  return pool
    .filter((a) => a.iata !== origin.iata)
    .map((a) => {
      const distanceKm = haversineDistanceKm(origin.lat, origin.lon, a.lat, a.lon);
      return { airport: a, distanceKm };
    })
    .filter((c) => c.distanceKm <= maxDistanceKm)
    // blended score: closer AND more important wins. Distance dominates within ~150km.
    .sort((x, y) => {
      const scoreX = x.distanceKm - (x.airport.rank || 0) * 1.5;
      const scoreY = y.distanceKm - (y.airport.rank || 0) * 1.5;
      return scoreX - scoreY;
    })
    .slice(0, limit)
    .map((c) => ({ ...c.airport, distanceKm: Math.round(c.distanceKm) }));
}

/**
 * Capped by config.optimizer.maxNearbyAirports — this is the single knob
 * that controls combinatorial explosion risk in the optimizer's airport
 * expansion stage (see optimizer/stages/airportExpansion.js in Part B4).
 *
 * Synchronous, local/cache-only resolution (via requireByIata) — this is
 * the flight-search/optimizer call path (airportExpansion.js) and is
 * intentionally left untouched in shape; see getNearbyAirportsFor() above
 * for the async-resolved-origin variant used by the standalone
 * GET /api/airports/:iataCode/nearby endpoint.
 */
function getNearbyAirports(iataCode, limit = config.optimizer.maxNearbyAirports, maxDistanceKm = 300) {
  const origin = requireByIata(iataCode);
  return getNearbyAirportsFor(origin, limit, maxDistanceKm);
}

/**
 * All airports in a given country, sorted by hub rank (most important first).
 */
function expandByCountry(countryCode, limit = 10) {
  const list = byCountryCode[countryCode.toUpperCase()] || [];
  return [...list].sort((a, b) => b.rank - a.rank).slice(0, limit);
}

/**
 * All airports in a given region (e.g. "Southeast Asia"), sorted by hub rank.
 * Used when a user says something broad like "I want Europe".
 */
function expandByRegion(region, limit = 15) {
  const list = byRegion[region] || [];
  return [...list].sort((a, b) => b.rank - a.rank).slice(0, limit);
}

function listRegions() {
  return Object.keys(byRegion).sort();
}

function listCountries() {
  const seen = new Map();
  for (const a of AIRPORTS) {
    if (!seen.has(a.countryCode)) {
      seen.set(a.countryCode, { countryCode: a.countryCode, country: a.country, region: a.region });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.country.localeCompare(b.country));
}

module.exports = {
  getByIata,
  requireByIata,
  resolveByIata,
  search,
  getNearbyAirports,
  getNearbyAirportsFor,
  expandByCountry,
  expandByRegion,
  listRegions,
  listCountries,
  totalAirportCount: AIRPORTS.length,
};
