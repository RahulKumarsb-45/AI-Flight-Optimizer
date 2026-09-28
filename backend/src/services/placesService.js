const axios = require('axios');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const { placesCache } = require('../cache/memoryCache');
const redisCache = require('../cache/redisCache');
const logger = require('../logger/logger');

const REDIS_NAMESPACE = 'placescache';

function redisKeyFor(cacheKey) {
  return `${REDIS_NAMESPACE}:${cacheKey}`;
}

/**
 * Same two-layer read as cache/flightCache.js / weatherService.js: memory
 * first, then Redis (a no-op resolving to `undefined` immediately when
 * REDIS_URL isn't set/reachable — unchanged behavior for deployments
 * without Redis configured). A Redis hit backfills memory.
 *
 * Deliberately NOT used for getPhotoBytes() below: that caches a raw
 * Buffer, and Redis here always JSON.stringify/parses (see
 * cache/redisCache.js), which would silently turn the Buffer into a plain
 * `{ type: 'Buffer', data: [...] }` object on the way back out — a real
 * correctness bug, not just a missed optimization. Photo bytes stay on the
 * in-process cache only, same as before this change.
 */
async function getFromCache(cacheKey, ttlMs) {
  const memHit = placesCache.get(cacheKey);
  if (memHit) return memHit;

  const redisResult = await redisCache.get(redisKeyFor(cacheKey));
  if (redisResult) {
    placesCache.set(cacheKey, redisResult, ttlMs);
    return redisResult;
  }
  return null;
}

/** Write-through: memory (this instance) + Redis (shared). redisCache.set() never rejects. */
function writeToCache(cacheKey, value, ttlMs) {
  placesCache.set(cacheKey, value, ttlMs);
  redisCache.set(redisKeyFor(cacheKey), value, ttlMs);
}

const BASE_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const CACHE_TTL_MS = config.places.cacheTtlHours * 60 * 60 * 1000;

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.googleMapsUri',
  'places.currentOpeningHours.openNow',
  'places.photos',
].join(',');

// Superset of FIELD_MASK: attractions additionally surface a short
// description (editorialSummary) and a human-readable category
// (primaryTypeDisplayName) so the UI can show what kind of place it is.
const ATTRACTIONS_FIELD_MASK = [
  FIELD_MASK,
  'places.editorialSummary',
  'places.primaryTypeDisplayName',
].join(',');

const DEFAULT_RADIUS_METERS = 5000;
const ATTRACTIONS_RADIUS_METERS = 10000;

function requireApiKey() {
  if (!config.places.apiKey) {
    throw new AppError(
      'Places data is not configured. Set GOOGLE_PLACES_API_KEY in .env.',
      500,
      'PLACES_NOT_CONFIGURED'
    );
  }
}

function normalizePlace(place) {
  return {
    id: place.id,
    name: place.displayName?.text || 'Unknown',
    address: place.formattedAddress || null,
    rating: place.rating ?? null,
    ratingCount: place.userRatingCount ?? 0,
    priceLevel: place.priceLevel || null,
    openNow: place.currentOpeningHours?.openNow ?? null,
    mapsUri: place.googleMapsUri || null,
    location: place.location ? { lat: place.location.latitude, lon: place.location.longitude } : null,
    photoName: place.photos?.[0]?.name || null,
  };
}

async function searchNearby({
  lat,
  lon,
  includedTypes,
  cacheKeyPrefix,
  radiusMeters = DEFAULT_RADIUS_METERS,
  maxResults = 10,
  fieldMask = FIELD_MASK,
  normalize = normalizePlace,
}) {
  requireApiKey();

  const cacheKey = `${cacheKeyPrefix}:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = await getFromCache(cacheKey, CACHE_TTL_MS);
  if (cached) return cached;

  try {
    const response = await axios.post(
      BASE_URL,
      {
        includedTypes,
        maxResultCount: maxResults,
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lon }, radius: radiusMeters },
        },
        rankPreference: 'POPULARITY',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': config.places.apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        timeout: 10000,
      }
    );

    const results = (response.data.places || []).map(normalize);
    writeToCache(cacheKey, results, CACHE_TTL_MS);
    return results;
  } catch (err) {
    if (err.response?.status === 403) {
      throw new AppError(
        'Places API key is invalid, or "Places API (New)" is not enabled for this key.',
        502,
        'PLACES_PROVIDER_ERROR'
      );
    }
    logger.warn('Places nearby search failed', { lat, lon, includedTypes, error: err.message });
    throw new AppError('Could not fetch nearby places right now.', 502, 'PLACES_PROVIDER_ERROR');
  }
}

function normalizeAttraction(place) {
  return {
    ...normalizePlace(place),
    description: place.editorialSummary?.text || null,
    category: place.primaryTypeDisplayName?.text || null,
  };
}

async function getNearbyHotels({ lat, lon }) {
  return searchNearby({ lat, lon, includedTypes: ['lodging'], cacheKeyPrefix: 'hotels' });
}

async function getNearbyRestaurants({ lat, lon }) {
  return searchNearby({ lat, lon, includedTypes: ['restaurant'], cacheKeyPrefix: 'restaurants' });
}

// Tourist attractions for a destination. Separate from the hotels/restaurants
// lookup above (different Google Places "includedTypes", wider radius since
// attractions worth visiting are often spread further from the airport, and
// a richer field mask for description/category) but reuses the same
// provider, cache, and normalization pattern rather than standing up a new
// data source. All fields come straight from Google Places — nothing here is
// invented or hardcoded.
async function getTouristAttractions({ lat, lon }) {
  return searchNearby({
    lat,
    lon,
    includedTypes: ['tourist_attraction'],
    cacheKeyPrefix: 'attractions',
    radiusMeters: ATTRACTIONS_RADIUS_METERS,
    fieldMask: ATTRACTIONS_FIELD_MASK,
    normalize: normalizeAttraction,
  });
}

async function getPhotoBytes({ photoName, maxWidthPx = 400 }) {
  requireApiKey();

  const cacheKey = `photo:${photoName}:${maxWidthPx}`;
  const cached = placesCache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(`https://places.googleapis.com/v1/${photoName}/media`, {
      params: { maxWidthPx, key: config.places.apiKey },
      responseType: 'arraybuffer',
      timeout: 10000,
    });

    const result = { data: Buffer.from(response.data), contentType: response.headers['content-type'] || 'image/jpeg' };
    placesCache.set(cacheKey, result, CACHE_TTL_MS);
    return result;
  } catch (err) {
    logger.warn('Places photo fetch failed', { photoName, error: err.message });
    throw new AppError('Could not load this photo right now.', 502, 'PLACES_PROVIDER_ERROR');
  }
}

module.exports = { getNearbyHotels, getNearbyRestaurants, getTouristAttractions, getPhotoBytes };
