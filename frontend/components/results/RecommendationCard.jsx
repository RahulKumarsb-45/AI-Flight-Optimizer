'use client';

import { useState } from 'react';
import { ChevronDown, MapPin, Plane } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { formatInr, formatDuration, formatTime, formatIndianDate } from '@/utils/format';
import { cn } from '@/lib/utils';
import { trackSelectFlight } from '@/lib/analytics';

function RouteHeadline({ legs, originAirport, destinationAirports }) {
  const cities = [originAirport.city, ...destinationAirports.map((a) => a.city)];
  // multi-city circuits return to origin; single-destination trips don't repeat it
  const isCircuit = legs.length > destinationAirports.length;
  const path = isCircuit ? [...cities, originAirport.city] : cities;

  return (
    <div className="flex flex-wrap items-center gap-1.5 font-display text-lg text-ink-900">
      {path.map((city, idx) => (
        <span key={idx} className="flex items-center gap-1.5">
          {city}
          {idx < path.length - 1 && <span className="text-ink-300">→</span>}
        </span>
      ))}
    </div>
  );
}

function LegDetail({ leg, offer }) {
  if (!offer) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-ink-400">
        <Plane className="h-3.5 w-3.5" aria-hidden="true" /> {leg.fromIata} → {leg.toIata} — no offer found
      </div>
    );
  }

  const segments = offer.outbound || [];

  return (
    <div className="border-t border-ink-100 py-3 first:border-t-0">
      <div className="flex items-center justify-between text-xs text-ink-400">
        <span>{formatIndianDate(leg.date)}</span>
        <span>
          {offer.stops === 0 ? 'Direct' : `${offer.stops} stop${offer.stops > 1 ? 's' : ''}`} ·{' '}
          {formatDuration(offer.totalDurationMinutes)}
        </span>
      </div>
      <div className="mt-1.5 space-y-1.5">
        {segments.map((seg, idx) => (
          <div key={idx} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-ink-700">
              <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-ink-600">
                {seg.airline}{seg.flightNumber?.replace(seg.airline, '')}
              </span>
              {seg.fromIata} {formatTime(seg.departureTime)} → {seg.toIata} {formatTime(seg.arrivalTime)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 font-mono text-sm text-ink-500">{formatInr(offer.priceInr)}</p>
    </div>
  );
}

function RecommendationCard({ recommendation, rank, highlight }) {
  const [expanded, setExpanded] = useState(false);
  const { legs, legOffers, originAirport, destinationAirports, totalPriceInr, totalDurationMinutes, totalStops, explanation } =
    recommendation;

  const usesNearbyAirport = !originAirport.isPrimary || destinationAirports.some((a) => !a.isPrimary);

  // No live booking exists in this app (dummy/mock only, per project rules)
  // — expanding a recommendation's flight details is the closest real
  // analog to "selecting" it out of the list, so that's what's tracked.
  function handleToggleExpanded() {
    setExpanded((e) => {
      const next = !e;
      if (next) {
        trackSelectFlight({ rank, isTopPick: rank === 1, usesNearbyAirport });
      }
      return next;
    });
  }

  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-5 shadow-soft transition-shadow hover:shadow-card sm:p-6',
        highlight ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-ink-100'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {rank === 1 && <Badge variant="amber">Top pick</Badge>}
            {usesNearbyAirport && (
              <Badge variant="route">
                <MapPin className="h-3 w-3" aria-hidden="true" /> Nearby airport
              </Badge>
            )}
          </div>
          <div className="mt-2">
            <RouteHeadline legs={legs} originAirport={originAirport} destinationAirports={destinationAirports} />
          </div>
          <p className="mt-1 text-sm text-ink-400">
            {totalStops === 0 ? 'Direct' : `${totalStops} stop${totalStops > 1 ? 's' : ''}`} ·{' '}
            {formatDuration(totalDurationMinutes)} total
          </p>
        </div>

        <div className="text-right">
          <p className="font-mono text-2xl font-medium text-ink-900">{formatInr(totalPriceInr)}</p>
          <p className="text-xs text-ink-400">all travelers included</p>
        </div>
      </div>

      <p className="mt-4 rounded-lg bg-ink-50 px-4 py-3 text-sm leading-relaxed text-ink-600">{explanation}</p>

      <button
        type="button"
        onClick={handleToggleExpanded}
        className="mt-3 flex items-center gap-1 text-sm font-medium text-horizon-700 hover:underline"
      >
        {expanded ? 'Hide' : 'Show'} flight details
        <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
      </button>

      {expanded && (
        <div className="mt-2">
          {legs.map((leg, idx) => (
            <LegDetail key={idx} leg={leg} offer={legOffers?.[idx]?.[0]} />
          ))}
        </div>
      )}
    </div>
  );
}

export { RecommendationCard };
