'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Star,
  ExternalLink,
  Landmark,
  ImageOff,
} from 'lucide-react';

import { placesService } from '@/services/placesService';
import {
  trackAttractionSearch,
  trackSelectAttraction,
} from '@/lib/analytics';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:5000/api';

/**
 * Build the correct image URL.
 *
 * Local images:
 *   /images/things-to-do/thing-1-1.jpg
 *
 * These are served directly by Next.js from:
 *   frontend/public/images/
 *
 * Older/external photo names are still supported through
 * the backend photo proxy.
 */
function photoUrl(photoName) {
  if (!photoName) {
    return null;
  }

  // ==========================================================
  // LOCAL STATIC IMAGE
  // ==========================================================

  if (
    photoName.startsWith('/images/') ||
    photoName.startsWith('http://') ||
    photoName.startsWith('https://')
  ) {
    return photoName;
  }

  // ==========================================================
  // BACKWARD COMPATIBILITY
  // ==========================================================

  return (
    `${API_BASE_URL}/places/photo` +
    `?name=${encodeURIComponent(photoName)}` +
    `&maxWidth=300`
  );
}

function AttractionThumbnail({
  photoName,
  name,
}) {
  const [failed, setFailed] = useState(false);

  const imageSrc = photoUrl(photoName);

  if (!imageSrc || failed) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-300">
        <ImageOff
          className="h-5 w-5"
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageSrc}
      alt={name || 'Attraction'}
      loading="lazy"
      decoding="async"
      className="h-16 w-16 shrink-0 rounded-lg object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function AttractionRow({
  place,
  iataCode,
}) {
  function handleSelect() {
    trackSelectAttraction({
      iataCode,
      hasRating: Boolean(place.rating),
    });
  }

  return (
    <a
      href={place.mapsUri || '#'}
      target="_blank"
      rel="noreferrer"
      onClick={handleSelect}
      className="flex items-start gap-3 rounded-lg border border-ink-100 px-3.5 py-3 text-sm transition-colors hover:border-horizon-200 hover:bg-horizon-50/40"
    >
      <AttractionThumbnail
        photoName={place.photoName}
        name={place.name}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink-800">
          {place.name}
        </p>

        {place.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">
            {place.description}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
          {place.category && (
            <span>{place.category}</span>
          )}

          {place.address && (
            <span className="truncate">
              {place.address}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-xs text-ink-500">
        {place.rating && (
          <span className="flex items-center gap-0.5">
            <Star
              className="h-3 w-3 fill-amber-400 text-amber-400"
              aria-hidden="true"
            />

            {place.rating}
          </span>
        )}

        <ExternalLink
          className="h-3 w-3 text-ink-300"
          aria-hidden="true"
        />
      </div>
    </a>
  );
}

function TouristAttractionsCard({
  iataCode,
  city,
}) {
  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: [
      'places',
      'attractions',
      iataCode,
    ],

    queryFn: () =>
      placesService.getAttractions(
        iataCode
      ),

    staleTime:
      60 * 60 * 1000,

    retry: false,

    enabled:
      Boolean(iataCode),
  });

  useEffect(() => {
    if (!data?.attractions) {
      return;
    }

    trackAttractionSearch({
      iataCode,
      resultCount:
        data.attractions.length,
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, iataCode]);

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="flex items-center gap-2">
        <Landmark
          className="h-4 w-4 text-horizon-600"
          aria-hidden="true"
        />

        <p className="font-display text-base text-ink-900">
          Things to do in {city}
        </p>
      </div>

      <div className="mt-4">

        {/* ==================================================
            LOADING
        ================================================== */}

        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-ink-50"
              />
            ))}
          </div>
        )}

        {/* ==================================================
            ERROR
        ================================================== */}

        {!isLoading && isError && (
          <p className="py-6 text-center text-sm text-ink-400">
            {error?.message ||
              "Couldn't load tourist attractions right now."}
          </p>
        )}

        {/* ==================================================
            EMPTY
        ================================================== */}

        {!isLoading &&
          !isError &&
          !data?.attractions?.length && (
            <p className="py-6 text-center text-sm text-ink-400">
              No tourist attractions found for {city} yet.
            </p>
          )}

        {/* ==================================================
            RESULTS
        ================================================== */}

        {!isLoading &&
          !isError &&
          data?.attractions?.length > 0 && (
            <div className="space-y-2">
              {data.attractions.map(
                (place, index) => (
                  <AttractionRow
                    key={
                      place.id ||
                      `${place.name}-${index}`
                    }
                    place={place}
                    iataCode={iataCode}
                  />
                )
              )}
            </div>
          )}
      </div>
    </div>
  );
}

export { TouristAttractionsCard };