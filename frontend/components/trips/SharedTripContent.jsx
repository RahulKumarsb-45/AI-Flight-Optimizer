'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueries } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Link2Off } from 'lucide-react';
import { tripService } from '@/services/tripService';
import { placesService } from '@/services/placesService';
import { CategorySummary } from '@/components/results/CategorySummary';
import { RecommendationCard } from '@/components/results/RecommendationCard';
import { ExpenseCalculatorCard } from '@/components/results/ExpenseCalculatorCard';
import { TripTimelineCard } from '@/components/results/TripTimelineCard';
import { WeatherCard } from '@/components/results/WeatherCard';
import { NearbyPlacesCard } from '@/components/results/NearbyPlacesCard';
import { TouristAttractionsCard } from '@/components/results/TouristAttractionsCard';
import { PdfExportButton } from '@/components/results/PdfExportButton';
import { Button } from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { formatInr, formatIndianDate } from '@/utils/format';
import { estimateAttractionsCostInr } from '@/utils/attractionsEstimate';
import { computeExpenseBreakdown } from '@/utils/expenseCalculator';

/**
 * Public Shared Trip view, reached at /shared/[shareToken]. Renders the
 * exact real data stored for this trip (`result_json`, the same shape the
 * live /results page and the owner's /trips/[tripId] page use) — never a
 * re-run of the optimizer, never invented data. Hotels/attractions/
 * restaurants are fetched live per real destination (same public
 * `placesService` calls and multi-city fan-out ResultsContent already
 * uses) since that data isn't persisted on the trip row; this file only
 * calls those existing services, it doesn't change how they work.
 */
function SharedTripContent() {
  const { shareToken } = useParams();
  const router = useRouter();

  const { data: trip, isLoading, isError, error } = useQuery({
    queryKey: ['shared-trip', shareToken],
    queryFn: () => tripService.getSharedTrip(shareToken),
    retry: false,
  });

  const { recommendations = [], categories = {}, meta = {} } = trip?.result_json || {};
  const topRecommendation = recommendations[0];
  const topDestinationIata = topRecommendation?.destinationAirports?.[0]?.iata;
  const tripNights = topRecommendation?.budgetInsight?.nights ?? topRecommendation?.livingCostEstimate?.nights ?? null;

  // Every actual destination for this trip (see ResultsContent.jsx for the
  // same dedupe-by-iata rationale — a circuit could revisit a city).
  const destinationAirports = topRecommendation?.destinationAirports || [];
  const uniqueDestinations = useMemo(() => {
    const seen = new Set();
    return destinationAirports.filter((dest) => {
      if (!dest?.iata || seen.has(dest.iata)) return false;
      seen.add(dest.iata);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topRecommendation]);

  const { data: attractionsData, isLoading: isLoadingAttractions } = useQuery({
    queryKey: ['places', 'attractions', topDestinationIata],
    queryFn: () => placesService.getAttractions(topDestinationIata),
    staleTime: 60 * 60 * 1000,
    retry: false,
    enabled: Boolean(topDestinationIata) && Boolean(tripNights),
  });

  const { data: hotelsData } = useQuery({
    queryKey: ['places', 'hotels', topDestinationIata],
    queryFn: () => placesService.getHotels(topDestinationIata),
    staleTime: 60 * 60 * 1000,
    retry: false,
    enabled: Boolean(topDestinationIata),
  });

  const { data: restaurantsData } = useQuery({
    queryKey: ['places', 'restaurants', topDestinationIata],
    queryFn: () => placesService.getRestaurants(topDestinationIata),
    staleTime: 60 * 60 * 1000,
    retry: false,
    enabled: Boolean(topDestinationIata),
  });

  const hotelsQueries = useQueries({
    queries: uniqueDestinations.map((dest) => ({
      queryKey: ['places', 'hotels', dest.iata],
      queryFn: () => placesService.getHotels(dest.iata),
      staleTime: 60 * 60 * 1000,
      retry: false,
      enabled: Boolean(dest.iata),
    })),
  });
  const attractionsQueries = useQueries({
    queries: uniqueDestinations.map((dest) => ({
      queryKey: ['places', 'attractions', dest.iata],
      queryFn: () => placesService.getAttractions(dest.iata),
      staleTime: 60 * 60 * 1000,
      retry: false,
      enabled: Boolean(dest.iata),
    })),
  });
  const restaurantsQueries = useQueries({
    queries: uniqueDestinations.map((dest) => ({
      queryKey: ['places', 'restaurants', dest.iata],
      queryFn: () => placesService.getRestaurants(dest.iata),
      staleTime: 60 * 60 * 1000,
      retry: false,
      enabled: Boolean(dest.iata),
    })),
  });

  const placesByDestination = useMemo(() => {
    const map = {};
    uniqueDestinations.forEach((dest, i) => {
      map[dest.iata] = {
        hotels: hotelsQueries[i]?.data?.hotels,
        attractions: attractionsQueries[i]?.data?.attractions,
        restaurants: restaurantsQueries[i]?.data?.restaurants,
      };
    });
    return map;
  }, [uniqueDestinations, hotelsQueries, attractionsQueries, restaurantsQueries]);

  const attractionsEstimate = tripNights
    ? estimateAttractionsCostInr(attractionsData?.attractions, tripNights)
    : null;

  const expenseBreakdown = topRecommendation
    ? computeExpenseBreakdown({
        flightCostInr: topRecommendation.totalPriceInr,
        budgetInsight: topRecommendation.budgetInsight,
        livingCostEstimate: topRecommendation.livingCostEstimate,
        attractionsEstimate,
        travelers: trip?.travelers,
      })
    : null;

  if (isLoading) return <PageSpinner label="Loading shared trip..." />;

  if (isError || !trip) {
    const isInvalidLink = error?.status === 404 || error?.errorCode === 'SHARE_NOT_FOUND';
    return (
      <div className="flex flex-col items-center py-20 text-center" role="alert">
        {isInvalidLink ? (
          <Link2Off className="h-8 w-8 text-amber-500" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
        )}
        <h2 className="mt-4 font-display text-xl text-ink-900">
          {isInvalidLink ? 'This share link is invalid or has expired' : "Couldn't load this trip"}
        </h2>
        <p className="mt-1.5 max-w-sm text-ink-500">
          {isInvalidLink
            ? 'The owner may have revoked it, or the link is incomplete.'
            : error?.message || 'Something went wrong while loading this trip.'}
        </p>
        <Button onClick={() => router.push('/')} variant="outline" className="mt-6">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to home
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge variant="neutral" className="mb-2">
            Shared trip · view only
          </Badge>
          <h1 className="font-display text-display-sm text-ink-900">
            {trip.origin_iata} → {trip.destination_countries?.join(', ')}
          </h1>
          <p className="mt-1 text-ink-500">
            {formatIndianDate(trip.departure_date)}
            {trip.return_date && ` – ${formatIndianDate(trip.return_date)}`} · {trip.travelers} traveler
            {trip.travelers > 1 ? 's' : ''}
            {trip.budget_inr && ` · Budget ${formatInr(trip.budget_inr)}`}
          </p>
        </div>
        {topRecommendation && (
          <PdfExportButton
            recommendation={topRecommendation}
            hotels={hotelsData?.hotels}
            attractions={attractionsData?.attractions}
            restaurants={restaurantsData?.restaurants}
            destinationCity={topRecommendation?.destinationAirports?.[0]?.city}
            placesByDestination={placesByDestination}
            expenseBreakdown={expenseBreakdown}
            filename={`trip-${trip.origin_iata}-${(trip.destination_countries || []).join('-')}-${trip.departure_date}.pdf`}
          />
        )}
      </div>

      {recommendations.length > 0 ? (
        <>
          <CategorySummary categories={categories} />

          {expenseBreakdown && (
            <ExpenseCalculatorCard breakdown={expenseBreakdown} isLoadingAttractions={isLoadingAttractions} />
          )}

          {topRecommendation?.destinationAirports?.[0] && (
            <div className="grid gap-4 sm:grid-cols-2">
              <WeatherCard
                iataCode={topRecommendation.destinationAirports[0].iata}
                city={topRecommendation.destinationAirports[0].city}
              />
              <NearbyPlacesCard
                iataCode={topRecommendation.destinationAirports[0].iata}
                city={topRecommendation.destinationAirports[0].city}
              />
            </div>
          )}

          {uniqueDestinations.slice(1).map((dest) => (
            <NearbyPlacesCard key={dest.iata} iataCode={dest.iata} city={dest.city} />
          ))}

          {uniqueDestinations.map((dest) => (
            <TouristAttractionsCard key={dest.iata} iataCode={dest.iata} city={dest.city} />
          ))}

          <TripTimelineCard
            recommendation={topRecommendation}
            hotels={hotelsData?.hotels}
            attractions={attractionsData?.attractions}
            restaurants={restaurantsData?.restaurants}
            destinationCity={topRecommendation?.destinationAirports?.[0]?.city}
            placesByDestination={placesByDestination}
          />

          <div>
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink-400">
              Recommendations from this search
            </h2>
            <div className="space-y-4">
              {recommendations.map((rec, idx) => (
                <RecommendationCard key={idx} recommendation={rec} rank={idx + 1} highlight={idx === 0} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="text-ink-400">No recommendation data was stored for this trip.</p>
      )}

      {meta.permutations?.wasCapped && (
        <p className="text-center text-xs text-ink-400">
          Searched {meta.permutations.totalAfterCap} of {meta.permutations.totalGenerated} possible combinations.
        </p>
      )}
    </div>
  );
}

export { SharedTripContent };
