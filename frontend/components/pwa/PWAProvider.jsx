'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

/**
 * Registers the Q9 service worker (public/sw.js) and surfaces two small,
 * dismissible status banners:
 *
 *  - a full-width bar at the very top of <body> (normal document flow, not
 *    fixed, so it doesn't fight the Navbar's own `sticky top-0`) when the
 *    browser goes offline — every page gets this, not just /offline.
 *  - a small toast-like card, bottom-right, when a new service worker has
 *    installed and is waiting to take over. Deliberately opt-in (a button,
 *    not an auto-refresh) — see sw.js for why: this app has payment and
 *    multi-step form flows that must never be yanked out from under someone.
 *
 * Rendered once from app/layout.js, as the first child of <body>.
 */
export function PWAProvider() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState(null);
  const [isOffline, setIsOffline] = useState(false);

  // --- service worker registration + update detection ---------------------
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // Not registered in development on purpose:
    //  - `next dev`'s assets aren't content-hashed the way a production
    //    build's are, so sw.js's cache-first rule for /_next/static/* would
    //    happily keep serving a stale dev bundle after a restart.
    //  - There's no production build to precache the offline shell from
    //    yet, so there's nothing meaningful to test against locally anyway.
    // Production behavior (Docker/deployed builds run with NODE_ENV=production)
    // is unaffected.
    if (process.env.NODE_ENV !== 'production') return;

    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // An update was already installed and waiting from earlier in this
        // browsing session (e.g. a previous tab picked it up).
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting);
          setUpdateAvailable(true);
        }

        // A new worker starts installing while this page is open.
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaitingWorker(installing);
              setUpdateAvailable(true);
            }
          });
        });
      })
      .catch(() => {
        // A failed registration (unsupported browser, blocked by an
        // extension, etc.) should never break the app — it works fine with
        // no service worker at all, just without offline fallback/install.
      });
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waitingWorker) return;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    setUpdateAvailable(false);
  }, [waitingWorker]);

  // --- online/offline status -----------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsOffline(!navigator.onLine);
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return (
    <>
      {isOffline && (
        <div role="status" aria-live="polite" className="bg-ink-900 py-1.5 text-center text-xs font-medium text-white">
          You’re offline — search, sign-in, Shreya AI, and payments won’t work until you’re back online.
        </div>
      )}

      {updateAvailable && (
        <div className="fixed inset-x-0 bottom-4 z-[90] flex justify-center px-4 sm:left-auto sm:right-4 sm:justify-end">
          <div
            role="status"
            className="flex items-center gap-3 rounded-lg border border-ink-100 bg-white px-4 py-3 text-sm shadow-card"
          >
            <span className="text-ink-700">A new version of FlightOptimizer is ready.</span>
            <button
              type="button"
              onClick={applyUpdate}
              className="inline-flex items-center gap-1.5 rounded bg-horizon-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-horizon-800"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setUpdateAvailable(false)}
              aria-label="Dismiss update notification"
              className="text-ink-400 transition-colors hover:text-ink-700"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
