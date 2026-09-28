'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { tripService } from '@/services/tripService';
import { CategorySummary } from '@/components/results/CategorySummary';
import { RecommendationCard } from '@/components/results/RecommendationCard';
import { ExpenseCalculatorCard } from '@/components/results/ExpenseCalculatorCard';
import { TripTimelineCard } from '@/components/results/TripTimelineCard';
import { PdfExportButton } from '@/components/results/PdfExportButton';
import { ShareTripButton } from '@/components/trips/ShareTripButton';
import { Button } from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { formatInr, formatIndianDate } from '@/utils/format';
import { computeExpenseBreakdown } from '@/utils/expenseCalculator';

function TripDetailsContent() {
  const { tripId } = useParams();
  const router = useRouter();

  const { data: trip, isLoading, isError } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => tripService.getTrip(tripId),
    retry: false,
  });

  if (isLoading) return <PageSpinner label="Loading trip..." />;

  if (isError || !trip) {
    return (
      <div className="flex flex-col items-center py-20 text-center" role="alert">
        <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
        <h2 className="mt-4 font-display text-xl text-ink-900">Trip not found</h2>
        <p className="mt-1.5 text-ink-500">It may have been removed, or doesn’t belong to this account.</p>
        <Button onClick={() => router.push('/dashboard')} variant="outline" className="mt-6">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to dashboard
        </Button>
      </div>
    );
  }

  // result_json was stored from a live optimizer run — same shape as /results uses
  const { recommendations = [], categories = {}, meta = {} } = trip.result_json || {};

  // Expense Calculator: reuses the exact same calculation logic and UI
  // component as the live /results page (utils/expenseCalculator.js +
  // ExpenseCalculatorCard) — nothing recomputed here. topRecommendation
  // already carries its own budgetInsight / livingCostEstimate / travelers-
  // aware figures from when this trip was originally optimized, so this is
  // purely a display-layer read of already-stored data — no new API call.
  // Tourist-attraction pricing data isn't loaded on this page (it isn't
  // fetched elsewhere here), so the attractions category simply shows as
  // "not enough data yet", exactly as it would on /results before that data
  // has loaded.
  const topRecommendation = recommendations[0];
  const expenseBreakdown = topRecommendation
    ? computeExpenseBreakdown({
        flightCostInr: topRecommendation.totalPriceInr,
        budgetInsight: topRecommendation.budgetInsight,
        livingCostEstimate: topRecommendation.livingCostEstimate,
        attractionsEstimate: null,
        travelers: trip.travelers,
      })
    : null;

  return (
    <div className="space-y-8">
      <button
        onClick={() => router.push('/dashboard')}
        className="flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Dashboard
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
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
        <div className="flex items-center gap-2">
          {topRecommendation && (
            <PdfExportButton
              recommendation={topRecommendation}
              destinationCity={topRecommendation?.destinationAirports?.[0]?.city}
              expenseBreakdown={expenseBreakdown}
              filename={`trip-${trip.origin_iata}-${(trip.destination_countries || []).join('-')}-${trip.departure_date}.pdf`}
            />
          )}
          <ShareTripButton tripId={tripId} />
          <Badge variant="horizon">{trip.status}</Badge>
        </div>
      </div>

      {recommendations.length > 0 ? (
        <>
          <CategorySummary categories={categories} />
          {expenseBreakdown && <ExpenseCalculatorCard breakdown={expenseBreakdown} isLoadingAttractions={false} />}
          {/* Hotels/attractions/restaurants aren't fetched on this page (same
              constraint noted above for the Expense Calculator's attractions
              line) — the timeline shows flight/date info from stored
              result_json and marks those sections unavailable rather than
              fabricating them. */}
          <TripTimelineCard recommendation={topRecommendation} destinationCity={topRecommendation?.destinationAirports?.[0]?.city} />
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

export { TripDetailsContent };
