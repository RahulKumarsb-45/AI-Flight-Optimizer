'use client';

import { CalendarDays, Plane, Hotel, Landmark, UtensilsCrossed, AlertCircle } from 'lucide-react';
import { formatIndianDate, formatTime, formatDuration, formatInr } from '@/utils/format';
import { buildTripTimeline } from '@/utils/tripTimeline';

/**
 * Trip Timeline / Day-by-Day Itinerary. Purely presentational: every entry
 * it renders comes from `buildTripTimeline` (see utils/tripTimeline.js),
 * which itself only reuses real flight legs/offers already computed by the
 * optimizer, plus whichever hotel/attraction/restaurant lists the caller
 * already has loaded (no new fetch happens here or in that helper).
 *
 * Reused as-is by both the live /results page and the saved-trip detail
 * page — `hotels` / `attractions` / `restaurants` are simply omitted on
 * pages where that data isn't loaded, and the relevant sections show as
 * "not available" rather than being fabricated.
 */
function FlightEntry({ entry }) {
  if (entry.status === 'unavailable') {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-ink-200 px-3.5 py-3 text-sm text-ink-400">
        <Plane className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="text-ink-500">
            {entry.fromIata} → {entry.toIata}
          </p>
          <p className="text-xs">{entry.note}</p>
        </div>
      </div>
    );
  }

  const directionLabel = entry.direction === 'return' ? 'Return flight' : entry.direction === 'connecting' ? 'Connecting flight' : 'Flight';

  return (
    <div className="rounded-lg border border-ink-100 px-3.5 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-ink-800">
          <Plane className="h-3.5 w-3.5 text-horizon-600" /> {directionLabel}
        </span>
        <span className="text-xs text-ink-400">
          {entry.stops === 0 ? 'Direct' : `${entry.stops} stop${entry.stops > 1 ? 's' : ''}`} ·{' '}
          {formatDuration(entry.totalDurationMinutes)}
        </span>
      </div>
      <p className="mt-1.5 text-ink-700">
        {entry.fromIata} {formatTime(entry.departureTime)} → {entry.toIata} {formatTime(entry.arrivalTime)}
      </p>
      {entry.segments?.length > 0 && (
        <p className="mt-1 text-xs text-ink-400">
          {entry.segments.map((seg) => `${seg.airline}${seg.flightNumber?.replace(seg.airline, '')}`).join(' · ')}
        </p>
      )}
      {entry.priceInr != null && <p className="mt-1.5 font-mono text-xs text-ink-500">{formatInr(entry.priceInr)}</p>}
    </div>
  );
}

function AccommodationEntry({ entry }) {
  return (
    <div className="rounded-lg border border-ink-100 px-3.5 py-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-ink-800">
        <Hotel className="h-3.5 w-3.5 text-horizon-600" /> Where you could stay{entry.city ? ` near ${entry.city}` : ''}
      </p>
      <ul className="mt-1.5 space-y-1 text-ink-600">
        {entry.options.map((hotel) => (
          <li key={hotel.id} className="truncate">
            {hotel.name}
            {hotel.rating && <span className="text-ink-400"> · {hotel.rating}★</span>}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-ink-400">Suggestions only — this app doesn&apos;t book or confirm a stay.</p>
    </div>
  );
}

function AttractionsEntry({ entry }) {
  return (
    <div className="rounded-lg border border-ink-100 px-3.5 py-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-ink-800">
        <Landmark className="h-3.5 w-3.5 text-horizon-600" /> Things to do
      </p>
      <ul className="mt-1.5 space-y-1 text-ink-600">
        {entry.items.map((place) => (
          <li key={place.id} className="truncate">
            {place.name}
            {place.category && <span className="text-ink-400"> · {place.category}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RestaurantsEntry({ entry }) {
  return (
    <div className="rounded-lg border border-ink-100 px-3.5 py-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-ink-800">
        <UtensilsCrossed className="h-3.5 w-3.5 text-horizon-600" /> Where to eat
      </p>
      <ul className="mt-1.5 space-y-1 text-ink-600">
        {entry.items.map((place) => (
          <li key={place.id} className="truncate">
            {place.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DayEntry({ entry }) {
  switch (entry.type) {
    case 'flight':
      return <FlightEntry entry={entry} />;
    case 'accommodation':
      return <AccommodationEntry entry={entry} />;
    case 'attractions':
      return <AttractionsEntry entry={entry} />;
    case 'restaurants':
      return <RestaurantsEntry entry={entry} />;
    default:
      return null;
  }
}

function DayColumn({ day }) {
  return (
    <div className="rounded-lg bg-ink-50/60 p-3.5">
      <div className="mb-2.5 flex items-baseline justify-between">
        <p className="font-display text-sm font-medium text-ink-900">Day {day.dayNumber}</p>
        <p className="text-xs text-ink-400">{formatIndianDate(day.date)}</p>
      </div>
      {day.entries.length > 0 ? (
        <div className="space-y-2">
          {day.entries.map((entry, idx) => (
            <DayEntry key={idx} entry={entry} />
          ))}
        </div>
      ) : (
        <p className="py-2 text-xs text-ink-400">Nothing scheduled yet for this day.</p>
      )}
    </div>
  );
}

function TripTimelineCard({ recommendation, hotels, attractions, restaurants, destinationCity, placesByDestination }) {
  if (!recommendation) return null;

  const { legs, legOffers, originAirport, destinationAirports } = recommendation;
  // Multi-city circuits (more legs than destinations, e.g. origin -> A -> B ->
  // origin) get each destination's own real hotel/attraction/restaurant data
  // when the caller supplies `placesByDestination` (see ResultsContent.jsx).
  // Callers that don't have that data loaded (e.g. the saved-trip detail
  // page, which doesn't fetch places at all) fall back to the flat
  // hotels/attractions/restaurants — buildTripTimeline reports whether it
  // actually had per-destination data via `usedPerDestinationData`, so the
  // caveat below only shows when data is genuinely partial/missing.
  const isMultiCityCircuit = (destinationAirports?.length || 0) > 1;
  const timeline = buildTripTimeline({
    legs,
    legOffers,
    originAirport,
    destinationAirports,
    hotels,
    attractions,
    restaurants,
    destinationCity,
    placesByDestination,
  });

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-horizon-600" />
        <p className="font-display text-base text-ink-900">Trip timeline</p>
      </div>

      {!timeline.isAvailable ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-ink-200 px-4 py-6 text-sm text-ink-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {timeline.reason}
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-400">
            {timeline.totalDays} day{timeline.totalDays > 1 ? 's' : ''}, day by day
          </p>

          {isMultiCityCircuit &&
            !timeline.usedPerDestinationData &&
            (timeline.hotelsAvailable || timeline.attractionsAvailable || timeline.restaurantsAvailable) && (
              <p className="mt-2 text-xs text-ink-400">
                Stay, attraction, and restaurant suggestions below are for {destinationAirports[0].city} only — this
                multi-city trip visits other destinations too, which aren&apos;t shown here.
              </p>
            )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {timeline.days.map((day) => (
              <DayColumn key={day.dayNumber} day={day} />
            ))}
          </div>

          {(!timeline.hotelsAvailable || !timeline.attractionsAvailable || !timeline.restaurantsAvailable) && (
            <p className="mt-4 text-xs text-ink-400">
              {[
                !timeline.hotelsAvailable && 'accommodation',
                !timeline.attractionsAvailable && 'tourist attractions',
                !timeline.restaurantsAvailable && 'restaurants',
              ]
                .filter(Boolean)
                .join(', ')}{' '}
              not shown — that data hasn&apos;t been loaded for this trip yet.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export { TripTimelineCard };
