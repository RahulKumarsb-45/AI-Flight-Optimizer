const axios = require('axios');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const { placesCache } = require('../cache/memoryCache');
const redisCache = require('../cache/redisCache');
const logger = require('../logger/logger');

const REDIS_NAMESPACE = 'placescache-v2-dummy-images';

function redisKeyFor(cacheKey) {
  return `${REDIS_NAMESPACE}:${cacheKey}`;
}

/**
 * Two-layer cache:
 * 1. In-memory cache
 * 2. Redis cache
 *
 * Redis hit backfills memory.
 */
async function getFromCache(cacheKey, ttlMs) {
  const memHit = placesCache.get(cacheKey);

  if (memHit) {
    return memHit;
  }

  const redisResult = await redisCache.get(
    redisKeyFor(cacheKey)
  );

  if (redisResult) {
    placesCache.set(
      cacheKey,
      redisResult,
      ttlMs
    );

    return redisResult;
  }

  return null;
}

/**
 * Write-through cache:
 * memory + Redis
 */
function writeToCache(cacheKey, value, ttlMs) {
  placesCache.set(
    cacheKey,
    value,
    ttlMs
  );

  redisCache.set(
    redisKeyFor(cacheKey),
    value,
    ttlMs
  );
}

// ============================================================
// GEOAPIFY
// ============================================================

const BASE_URL =
  'https://api.geoapify.com/v2/places';

const CACHE_TTL_MS =
  config.places.cacheTtlHours *
  60 *
  60 *
  1000;

const DEFAULT_RADIUS_METERS = 5000;
const ATTRACTIONS_RADIUS_METERS = 10000;

// ============================================================
// LOCAL DUMMY IMAGES
// ============================================================

const DUMMY_IMAGE_COUNT = 10;

const DUMMY_IMAGE_PATHS = {
  hotel: Array.from(
    { length: DUMMY_IMAGE_COUNT },
    (_, index) =>
      `/images/hotels/hotel-${index + 1}.jpg`
  ),

  restaurant: Array.from(
    { length: DUMMY_IMAGE_COUNT },
    (_, index) =>
      `/images/restaurants/restaurant-${index + 1}.jpg`
  ),
};

/**
 * Return a different local image for each result.
 *
 * Hotel:
 * /images/hotels/hotel-1.jpg ... hotel-10.jpg
 *
 * Restaurant:
 * /images/restaurants/restaurant-1.jpg ... restaurant-10.jpg
 */
function getDummyImageUrl(imageType, index) {
  const images = DUMMY_IMAGE_PATHS[imageType];

  if (!images || images.length === 0) {
    return null;
  }

  return images[index % images.length];
}

// ============================================================
// PLACES CONFIG
// ============================================================

function requireApiKey() {
  if (!config.places.apiKey) {
    throw new AppError(
      'Places data is not configured. Set GEOAPIFY_API_KEY in .env.',
      500,
      'PLACES_NOT_CONFIGURED'
    );
  }
}

/**
 * Geoapify categories corresponding to our application needs.
 */
const PLACE_CATEGORIES = {
  hotels: [
    'accommodation.hotel',
    'accommodation.guest_house',
    'accommodation.hostel',
  ],

  restaurants: [
    'catering.restaurant',
    'catering.cafe',
    'catering.fast_food',
  ],

  attractions: [
    'tourism.attraction',
    'tourism.sights',
    'entertainment',
    'heritage',
  ],
};

/**
 * Convert Geoapify place properties into
 * the application's normalized place shape.
 */
function normalizePlace(properties) {
  if (!properties) {
    return {
      id: null,
      name: 'Unknown',
      address: null,
      rating: null,
      ratingCount: 0,
      priceLevel: null,
      openNow: null,
      mapsUri: null,
      location: null,
      photoName: null,
      imageUrl: null,
    };
  }

  const lat =
    properties.lat ??
    properties.latitude ??
    null;

  const lon =
    properties.lon ??
    properties.longitude ??
    null;

  const address =
    properties.formatted ||
    properties.address_line1 ||
    properties.address_line2 ||
    null;

  return {
    id:
      properties.place_id ||
      properties.datasource?.raw?.place_id ||
      null,

    name:
      properties.name ||
      properties.address_line1 ||
      'Unknown',

    address,

    rating:
      properties.rating ??
      properties.datasource?.raw?.rating ??
      null,

    ratingCount:
      properties.rating_count ??
      properties.datasource?.raw?.rating_count ??
      0,

    priceLevel:
      properties.price_level ??
      null,

    openNow:
      properties.open_now ??
      null,

    // Google Maps search URL
    mapsUri:
      lat !== null && lon !== null
        ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
        : null,

    location:
      lat !== null && lon !== null
        ? {
            lat,
            lon,
          }
        : null,

    // Filled later with local dummy image.
    photoName: null,

    // Filled later with local dummy image.
    imageUrl: null,
  };
}

// ============================================================
// GEOAPIFY NEARBY SEARCH
// ============================================================

/**
 * Search nearby places using Geoapify.
 *
 * imageType:
 * - hotel
 * - restaurant
 * - null for attractions
 */
async function searchNearby({
  lat,
  lon,
  categories,
  cacheKeyPrefix,
  radiusMeters = DEFAULT_RADIUS_METERS,
  maxResults = 10,
  imageType = null,
}) {
  requireApiKey();

  /**
   * v2 is intentional.
   *
   * It prevents old cached responses containing
   * previous image values from being reused.
   */
  const cacheKey =
    `${cacheKeyPrefix}:v2:` +
    `${lat.toFixed(3)},` +
    `${lon.toFixed(3)}`;

  const cached = await getFromCache(
    cacheKey,
    CACHE_TTL_MS
  );

  if (cached) {
    return cached;
  }

  try {
    // ========================================================
    // 1. GET PLACES FROM GEOAPIFY
    // ========================================================

    const response = await axios.get(
      BASE_URL,
      {
        params: {
          categories: categories.join(','),

          filter:
            `circle:${lon},${lat},${radiusMeters}`,

          bias:
            `proximity:${lon},${lat}`,

          limit: Math.min(
            maxResults,
            20
          ),

          apiKey:
            config.places.apiKey,
        },

        timeout: 10000,
      }
    );

    const features =
      response.data?.features || [];

    const results =
      features
        .map(
          (feature) =>
            normalizePlace(
              feature.properties
            )
        )
        .filter(
          (place) =>
            place.name
        )
        .slice(
          0,
          maxResults
        );

    // ========================================================
    // 2. ADD LOCAL DUMMY IMAGES
    // ========================================================

    const finalResults =
      results.map(
        (place, index) => {
          const dummyImage =
            getDummyImageUrl(
              imageType,
              index
            );

          return {
            ...place,

            // Frontend currently reads photoName.
            photoName: dummyImage,

            // Keep imageUrl too for compatibility
            // with any other existing callers.
            imageUrl: dummyImage,
          };
        }
      );

    // ========================================================
    // 3. CACHE COMPLETE RESULT
    // ========================================================

    writeToCache(
      cacheKey,
      finalResults,
      CACHE_TTL_MS
    );

    return finalResults;

  } catch (err) {
    const status =
      err.response?.status;

    const providerMessage =
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.message;

    if (
      status === 401 ||
      status === 403
    ) {
      logger.warn(
        'Geoapify Places authentication failed',
        {
          status,
          error:
            providerMessage,
        }
      );

      throw new AppError(
        'Geoapify API key is invalid or not authorized.',
        502,
        'PLACES_PROVIDER_ERROR'
      );
    }

    logger.warn(
      'Geoapify nearby search failed',
      {
        lat,
        lon,
        categories,
        status,
        error:
          providerMessage,
      }
    );

    throw new AppError(
      'Could not fetch nearby places right now.',
      502,
      'PLACES_PROVIDER_ERROR'
    );
  }
}

// ============================================================
// HOTELS
// ============================================================

/**
 * Hotels / accommodation.
 */
async function getNearbyHotels({
  lat,
  lon,
}) {
  return searchNearby({
    lat,
    lon,

    categories:
      PLACE_CATEGORIES.hotels,

    cacheKeyPrefix:
      'hotels',

    radiusMeters:
      DEFAULT_RADIUS_METERS,

    maxResults:
      10,

    imageType:
      'hotel',
  });
}

// ============================================================
// RESTAURANTS
// ============================================================

/**
 * Restaurants / cafes / fast food.
 */
async function getNearbyRestaurants({
  lat,
  lon,
}) {
  return searchNearby({
    lat,
    lon,

    categories:
      PLACE_CATEGORIES.restaurants,

    cacheKeyPrefix:
      'restaurants',

    radiusMeters:
      DEFAULT_RADIUS_METERS,

    maxResults:
      10,

    imageType:
      'restaurant',
  });
}

// ============================================================
// TOURIST ATTRACTIONS
// ============================================================

/**
 * Tourist attractions.
 *
 * No local attraction images are assigned because
 * the current image folders contain hotel and
 * restaurant image sets.
 */
async function getTouristAttractions({
  lat,
  lon,
}) {
  return searchNearby({
    lat,
    lon,

    categories:
      PLACE_CATEGORIES.attractions,

    cacheKeyPrefix:
      'attractions',

    radiusMeters:
      ATTRACTIONS_RADIUS_METERS,

    maxResults:
      10,

    imageType:
      null,
  });
}

// ============================================================
// BACKWARD COMPATIBILITY
// ============================================================

/**
 * Kept for backward compatibility with
 * existing callers.
 */
async function getPhotoBytes() {
  return null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getNearbyHotels,
  getNearbyRestaurants,
  getTouristAttractions,
  getPhotoBytes,
};