'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

/**
 * In-app "Back" control for standalone pages (How It Works, Pricing, About,
 * Shreya AI, etc). Not the browser back button — this is a client-side
 * affordance that:
 *  - goes to the previous page in the app's own history when the visit
 *    actually came from within FlightOptimizer, or
 *  - falls back to a safe internal route (default: the homepage) when the
 *    page was opened directly (no useful internal history), so it never
 *    sends anyone to an unrelated external site or a blank history entry.
 *
 * Rendered as a real <Link> (not a <button>) so it has a working href for
 * no-JS/SSR, is a proper focusable, keyboard-activatable link, and never
 * triggers a full page reload.
 */
function BackButton({ fallbackHref = '/', label = 'Back' }) {
  const router = useRouter();

  function handleClick(event) {
    const cameFromSameOrigin =
      typeof document !== 'undefined' &&
      typeof window !== 'undefined' &&
      document.referrer &&
      (() => {
        try {
          return new URL(document.referrer).origin === window.location.origin;
        } catch {
          return false;
        }
      })();

    const hasInternalHistory = typeof window !== 'undefined' && window.history.length > 1 && cameFromSameOrigin;

    if (hasInternalHistory) {
      event.preventDefault();
      router.back();
    }
    // Otherwise, let the Link's normal href navigation to fallbackHref proceed.
  }

  return (
    <div className="container-page pt-5">
      <Link
        href={fallbackHref}
        onClick={handleClick}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-horizon-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {label}
      </Link>
    </div>
  );
}

export { BackButton };
