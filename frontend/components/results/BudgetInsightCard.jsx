'use client';

import { Wallet, Info, TrendingUp, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { formatInr } from '@/utils/format';

const STATUS_META = {
  comfortable: { label: 'Comfortable', variant: 'route' },
  tight: { label: 'Tight', variant: 'amber' },
  over: { label: 'Over budget', variant: 'danger' },
  unknown: { label: 'Estimate unavailable', variant: 'neutral' },
};

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{label}</p>
      <p className="font-mono text-base text-ink-900">{value}</p>
    </div>
  );
}

function formatRange(range) {
  if (!range) return '—';
  if (range.min === range.max) return formatInr(range.min);
  return `${formatInr(range.min)}–${formatInr(range.max)}`;
}

/**
 * Budget Optimizer summary for the top recommendation. Only rendered when the
 * user supplied a budget — see ResultsContent. Three independent things can
 * be shown:
 *  - `insight` (recommendations[0].budgetInsight): the full cost breakdown —
 *    flight, estimated accommodation, food, local travel, estimated total,
 *    and what's left of the budget.
 *  - `attractionsEstimate`: an optional tourist-attractions line, added only
 *    when reliable price-level data for the destination is already loaded
 *    elsewhere on the page (see ResultsContent) — never fetched separately.
 *  - `suggestion` (meta.budgetSuggestion): a trip-level nudge using a real
 *    observed price/date/destination from this same search, shown when the
 *    budget filtered out most/all options.
 */
function BudgetInsightCard({ insight, suggestion, attractionsEstimate, isLoadingAttractions }) {
  if (!insight && !suggestion) return null;

  const statusMeta = insight ? STATUS_META[insight.status] || STATUS_META.unknown : null;
  const categories = insight?.categoryBreakdown;

  const estimatedTotalWithAttractions =
    insight?.estimatedTotalTripCostInr && attractionsEstimate
      ? {
          min: insight.estimatedTotalTripCostInr.min + attractionsEstimate.min,
          max: insight.estimatedTotalTripCostInr.max + attractionsEstimate.max,
        }
      : insight?.estimatedTotalTripCostInr;

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-horizon-600" />
          <p className="font-display text-base text-ink-900">Budget breakdown</p>
        </div>
        {statusMeta && <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>}
      </div>

      {insight && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Total budget" value={formatInr(insight.budgetInr)} />
            <Stat label="Flight" value={formatInr(insight.flightCostInr)} />
            <Stat label="Est. accommodation" value={categories ? formatRange(categories.accommodation) : '—'} />
            <Stat label="Est. food" value={categories ? formatRange(categories.food) : '—'} />
            <Stat label="Est. local travel" value={categories ? formatRange(categories.localTransport) : '—'} />
            {isLoadingAttractions && <Stat label="Est. attractions" value="Loading…" />}
            {!isLoadingAttractions && attractionsEstimate && (
              <Stat label="Est. attractions" value={formatRange(attractionsEstimate)} />
            )}
            <Stat
              label="Est. total trip cost"
              value={estimatedTotalWithAttractions ? formatRange(estimatedTotalWithAttractions) : '—'}
            />
            <Stat
              label={insight.remainingAfterFlightInr < 0 ? 'Over budget by' : 'Remaining budget'}
              value={formatInr(Math.abs(insight.remainingAfterFlightInr))}
            />
          </div>

          {insight.nights != null && (
            <p className="mt-3 text-xs text-ink-400">
              Estimates cover {insight.nights} night{insight.nights > 1 ? 's' : ''}
              {attractionsEstimate
                ? `, including ~${attractionsEstimate.basedOnCount} nearby attraction${
                    attractionsEstimate.basedOnCount > 1 ? 's' : ''
                  } with known price levels`
                : ''}
              .
            </p>
          )}

          {insight.fitSummary && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-ink-50 px-3.5 py-2.5 text-sm text-ink-700">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-horizon-600" />
              <span>
                <span className="font-medium">Smart recommendation: </span>
                {insight.fitSummary}
              </span>
            </div>
          )}
        </>
      )}

      {suggestion && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-horizon-50/60 px-3.5 py-2.5 text-sm text-horizon-800">
          <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{suggestion.message}</span>
        </div>
      )}

      {insight?.note && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {insight.note}
        </p>
      )}
    </div>
  );
}

export { BudgetInsightCard };
