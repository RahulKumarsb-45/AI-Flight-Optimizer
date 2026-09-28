import { IndianRupee, Zap, Scale } from 'lucide-react';
import { formatInr, formatDuration } from '@/utils/format';
import { cn } from '@/lib/utils';

const CATEGORY_META = {
  cheapest: { icon: IndianRupee, label: 'Cheapest', accent: 'text-route-600 bg-route-50' },
  fastest: { icon: Zap, label: 'Fastest', accent: 'text-amber-600 bg-amber-100' },
  balanced: { icon: Scale, label: 'Balanced', accent: 'text-horizon-700 bg-horizon-50' },
};

function CategorySummary({ categories }) {
  const entries = Object.entries(categories).filter(([, v]) => v);
  if (entries.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {entries.map(([key, cat]) => {
        const meta = CATEGORY_META[key];
        const Icon = meta.icon;
        return (
          <div key={key} className="rounded-lg border border-ink-100 bg-white p-4">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', meta.accent)}>
              <Icon className="h-3.5 w-3.5" /> {meta.label}
            </span>
            <p className="mt-2.5 font-mono text-xl text-ink-900">{formatInr(cat.totalPriceInr)}</p>
            <p className="text-xs text-ink-400">{formatDuration(cat.totalDurationMinutes)} total</p>
            {cat.explanation && <p className="mt-2 text-xs leading-relaxed text-ink-500">{cat.explanation}</p>}
          </div>
        );
      })}
    </div>
  );
}

export { CategorySummary };
