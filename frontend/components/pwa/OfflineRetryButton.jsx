'use client';

import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

/**
 * Small interactive slice of the /offline page (kept as its own client
 * component so the page itself can stay a plain server component, matching
 * the pattern used by app/not-found.js and app/about/page.js).
 *
 * We don't auto-reload the moment connectivity returns — that could yank the
 * page out from under someone mid-read. Instead we just update the status
 * line live and let the person choose when to hit "Try again".
 */
export function OfflineRetryButton() {
  // null = "don't know yet" (avoids briefly showing the wrong status before
  // the effect below runs on mount).
  const [isOnline, setIsOnline] = useState(null);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={cn(buttonVariants({ variant: 'primary', size: 'md' }), 'gap-2')}
      >
        <RotateCw className="h-4 w-4" aria-hidden="true" />
        Try again
      </button>
      <p className="min-h-[1.25rem] text-sm" aria-live="polite">
        {isOnline === null ? null : isOnline ? (
          <span className="text-route-600">Back online — tap “Try again” to continue.</span>
        ) : (
          <span className="text-ink-400">Still waiting for a connection…</span>
        )}
      </p>
    </div>
  );
}
