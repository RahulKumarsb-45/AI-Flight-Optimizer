'use client';

import { Calculator, Info } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { formatInr } from '@/utils/format';

function formatRange(range) {
  if (!range) return 'Not enough data';
  if (range.min === range.max) return formatInr(range.min);
  return `${formatInr(range.min)}–${formatInr(range.max)}`;
}

function CategoryRow({ label, entry, isLoading }) {
  const value = isLoading
    ? 'Loading…'
    : entry.amountInr != null
      ? formatInr(entry.amountInr)
      : formatRange(entry.rangeInr);

  return (
    <div className="flex items-center justify-between border-b border-ink-100 py-2.5 last:border-b-0">
      <div>
        <p className="text-sm text-ink-700">{label}</p>
        {entry.isEstimated && entry.isAvailable && <p className="text-xs text-ink-400">Estimated</p>}
        {entry.isEstimated && !entry.isAvailable && <p className="text-xs text-ink-400">Not enough data yet</p>}
        {!entry.isEstimated && <p className="text-xs text-ink-400">Actual, from your selected flight</p>}
      </div>
      <p className="font-mono text-sm text-ink-900">{value}</p>
    </div>
  );
}

/**
 * User-facing Expense Calculator. Purely presentational: every number it
 * shows comes from `breakdown` (see utils/expenseCalculator.js), which
 * itself only reuses the real selected flight price plus the existing
 * Budget Optimizer / tourist-attraction estimates — nothing is computed or
 * invented in this component.
 */
function ExpenseCalculatorCard({ breakdown, isLoadingAttractions }) {
  if (!breakdown) return null;

  const { categories, totalTripExpenseInr, budgetInr, remainingBudgetInr, overBudgetInr, nights, travelers } = breakdown;

  const statusBadge =
    overBudgetInr != null
      ? { label: 'Over budget', variant: 'danger' }
      : remainingBudgetInr != null
        ? { label: 'Within budget', variant: 'route' }
        : { label: 'No budget set', variant: 'neutral' };

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-horizon-600" />
          <p className="font-display text-base text-ink-900">Expense calculator</p>
        </div>
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
      </div>

      <p className="mt-1 text-xs text-ink-400">
        {travelers} traveler{travelers > 1 ? 's' : ''}
        {nights != null ? ` · ${nights} night${nights > 1 ? 's' : ''}` : ''}
      </p>

      <div className="mt-3">
        <CategoryRow label="Flight" entry={categories.flight} />
        <CategoryRow label="Hotel / accommodation" entry={categories.accommodation} />
        <CategoryRow label="Food" entry={categories.food} />
        <CategoryRow label="Local transport" entry={categories.localTransport} />
        <CategoryRow label="Tourist attractions / activities" entry={categories.attractions} isLoading={isLoadingAttractions} />
        <CategoryRow label="Miscellaneous" entry={categories.miscellaneous} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4 rounded-lg bg-ink-50 px-3.5 py-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-ink-400">Total trip expense</p>
          <p className="font-mono text-base text-ink-900">{formatRange(totalTripExpenseInr)}</p>
        </div>
        {budgetInr != null && (
          <div>
            <p className="text-xs text-ink-400">Your budget</p>
            <p className="font-mono text-base text-ink-900">{formatInr(budgetInr)}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-ink-400">{overBudgetInr != null ? 'Amount over budget' : 'Remaining budget'}</p>
          <p className={`font-mono text-base ${overBudgetInr != null ? 'text-danger-600' : 'text-ink-900'}`}>
            {overBudgetInr != null
              ? formatInr(overBudgetInr)
              : remainingBudgetInr != null
                ? formatInr(remainingBudgetInr)
                : '—'}
          </p>
        </div>
      </div>

      {!breakdown.hasFullEstimate && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {nights == null
            ? 'A one-way trip has no return date, so accommodation, food, and local-transport can\u2019t be estimated for it.'
            : 'Some categories don\u2019t have enough data yet to estimate.'}
        </p>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-400">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        {breakdown.note}
      </p>
    </div>
  );
}

export { ExpenseCalculatorCard };
