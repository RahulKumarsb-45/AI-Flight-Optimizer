'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { RouteArc } from '@/components/common/RouteArc';
import { cn } from '@/lib/utils';

// Simulated stages — the backend runs this pipeline synchronously in one
// request, it doesn't stream progress. These timings are just an animated
// approximation so the wait doesn't feel like a frozen screen.
const STAGES = [
  { label: 'Expanding nearby airports', ms: 700 },
  { label: 'Generating flexible dates', ms: 700 },
  { label: 'Searching flights across routes', ms: 1400 },
  { label: 'Scoring and ranking results', ms: 900 },
  { label: 'Preparing recommendations', ms: 600 },
];

function OptimizerLoadingState() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (activeIndex >= STAGES.length - 1) return;
    const timer = setTimeout(() => setActiveIndex((i) => i + 1), STAGES[activeIndex].ms);
    return () => clearTimeout(timer);
  }, [activeIndex]);

  return (
    <div className="flex flex-col items-center py-16 text-center">
      <RouteArc width={320} height={110} />
      <div className="mt-8 w-full max-w-xs space-y-3 text-left">
        {STAGES.map((stage, idx) => (
          <div key={stage.label} className="flex items-center gap-2.5 text-sm">
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                idx < activeIndex && 'border-route-500 bg-route-500 text-white',
                idx === activeIndex && 'border-horizon-600 text-horizon-600 animate-pulse',
                idx > activeIndex && 'border-ink-200 text-ink-300'
              )}
            >
              {idx < activeIndex ? <Check className="h-3 w-3" /> : idx + 1}
            </span>
            <span className={idx <= activeIndex ? 'text-ink-700' : 'text-ink-300'}>{stage.label}...</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { OptimizerLoadingState };
