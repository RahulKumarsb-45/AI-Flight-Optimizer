import { WifiOff } from 'lucide-react';
import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { OfflineRetryButton } from '@/components/pwa/OfflineRetryButton';

// Plain, static server component — no cookies()/headers()/searchParams, so
// Next prerenders this to fixed HTML at build time. That matters here: the
// service worker (public/sw.js) fetches this exact route once at install
// time and caches the response, then serves it as the offline fallback for
// any failed navigation. If this page were dynamic per-request, the cached
// copy could go stale or embed request-specific data — it should always be
// safe to show byte-for-byte the same to anyone, online or not.
export const metadata = { title: 'You’re offline' };

export default function OfflinePage() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="container-page flex flex-col items-center py-24 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-horizon-50 text-horizon-700">
          <WifiOff className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-8 font-display text-display-md text-ink-900">You’re offline</h1>
        <p className="mt-2 max-w-sm text-ink-500">
          We can’t reach FlightOptimizer right now. Flight search, Shreya AI, sign-in, and payments all need a
          network connection — this page is available offline so you’re not staring at a browser error.
        </p>
        <OfflineRetryButton />
      </main>
      <Footer />
    </>
  );
}
