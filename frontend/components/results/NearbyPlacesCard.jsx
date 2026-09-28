'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star, ExternalLink, Hotel, UtensilsCrossed, ImageOff } from 'lucide-react';
import { placesService } from '@/services/placesService';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import {
  trackHotelSearch,
  trackSelectHotel,
  trackRestaurantSearch,
  trackSelectRestaurant,
} from '@/lib/analytics';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

const PRICE_LEVEL_LABELS = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '₹',
  PRICE_LEVEL_MODERATE: '₹₹',
  PRICE_LEVEL_EXPENSIVE: '₹₹₹',
  PRICE_LEVEL_VERY_EXPENSIVE: '₹₹₹₹',
};

function photoUrl(photoName) {
  return `${API_BASE_URL}/places/photo?name=${encodeURIComponent(photoName)}&maxWidth=200`;
}

function PlaceThumbnail({ photoName, name }) {
  const [failed, setFailed] = useState(false);

  if (!photoName || failed) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-300">
        <ImageOff className="h-5 w-5" aria-hidden="true" />
      </div>
    );
  }

  return (
    // Deliberately a raw <img>, not next/image: this URL is our own backend's
    // dynamic photo proxy (http://localhost:5000/... in dev), not a static
    // asset — next.config.js's remotePatterns only allows https, and the
    // production API host isn't known at build time either. loading="lazy"
    // still gets the real win (off-screen thumbnails in this list aren't
    // fetched until they scroll into view) without that risk.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoUrl(photoName)}
      alt={name}
      loading="lazy"
      decoding="async"
      className="h-14 w-14 shrink-0 rounded-lg object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function PlaceRow({ place, type, iataCode }) {
  function handleSelect() {
    const payload = { iataCode, hasRating: Boolean(place.rating) };
    if (type === 'hotels') trackSelectHotel(payload);
    else trackSelectRestaurant(payload);
  }

  return (
    <a
      href={place.mapsUri || '#'}
      target="_blank"
      rel="noreferrer"
      onClick={handleSelect}
      className="flex items-center gap-3 rounded-lg border border-ink-100 px-3.5 py-2.5 text-sm transition-colors hover:border-horizon-200 hover:bg-horizon-50/40"
    >
      <PlaceThumbnail photoName={place.photoName} name={place.name} />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink-800">{place.name}</p>
        <p className="truncate text-xs text-ink-400">{place.address}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-ink-500">
        {place.rating && (
          <span className="flex items-center gap-0.5">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" /> {place.rating}
          </span>
        )}
        {place.priceLevel && <span>{PRICE_LEVEL_LABELS[place.priceLevel] || ''}</span>}
        <ExternalLink className="h-3 w-3 text-ink-300" aria-hidden="true" />
      </div>
    </a>
  );
}

function PlacesList({ iataCode, type }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['places', type, iataCode],
    queryFn: () => (type === 'hotels' ? placesService.getHotels(iataCode) : placesService.getRestaurants(iataCode)),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!data?.[type]) return;
    const resultCount = data[type].length;
    if (type === 'hotels') trackHotelSearch({ iataCode, resultCount });
    else trackRestaurantSearch({ iataCode, resultCount });
    // Fires once per successful (type, iataCode) load — react-query already
    // dedupes/caches the underlying request via staleTime, this just mirrors
    // that so a search isn't logged twice for the same cached data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, type, iataCode]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-ink-50" />
        ))}
      </div>
    );
  }

  if (isError || !data?.[type]?.length) {
    return <p className="py-6 text-center text-sm text-ink-400">Nothing found nearby right now.</p>;
  }

  return (
    <div className="space-y-2">
      {data[type].map((place) => (
        <PlaceRow key={place.id} place={place} type={type} iataCode={iataCode} />
      ))}
    </div>
  );
}

function NearbyPlacesCard({ iataCode, city }) {
  const [tab, setTab] = useState('hotels');

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="font-display text-base text-ink-900">Near {city}</p>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="hotels">
              <Hotel className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Hotels
            </TabsTrigger>
            <TabsTrigger value="restaurants">
              <UtensilsCrossed className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Food
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-4">
        <PlacesList iataCode={iataCode} type={tab} />
      </div>
    </div>
  );
}

export { NearbyPlacesCard };
