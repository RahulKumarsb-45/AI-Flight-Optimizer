'use client';

import { Suspense, useEffect } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { GA_MEASUREMENT_ID, isAnalyticsEnabled, trackPageView } from '@/lib/analytics';


// abc

/**
 * Fires a page_view on mount (the initial load) and again on every
 * client-side route change (App Router pushState navigation doesn't trigger
 * a full page load, so GA can't see it on its own). Wrapped in Suspense by
 * the parent because useSearchParams() opts a component into client-side
 * rendering, which Next.js requires to be Suspense-bounded.
 *
 * GA's own automatic pageview is turned off in the gtag('config', ...)
 * bootstrap below (send_page_view: false) specifically so that this single
 * effect is the only place a page_view is ever sent — that's what
 * guarantees the initial load isn't double-counted.
 */
function GAPageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isAnalyticsEnabled) return;
    const query = searchParams?.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    trackPageView(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  return null;
}

/**
 * Root-level GA4 setup. Renders nothing visible; entirely a no-op when
 * NEXT_PUBLIC_GA_MEASUREMENT_ID is unset (matches the Sentry
 * NEXT_PUBLIC_SENTRY_DSN pattern used elsewhere in this app — see
 * sentry.client.config.js).
 *
 * Bootstrap ordering (Q8 correction — see README "Known limitations"):
 * the dataLayer/gtag queue stub is loaded with strategy="beforeInteractive"
 * so it is injected into the initial HTML and guaranteed to run before
 * hydration — i.e. before GAPageViewTracker's effect can possibly fire.
 * Once `window.gtag` exists (even as just the queueing stub below), the
 * `typeof window.gtag === 'function'` guard in lib/analytics.js passes
 * immediately, and any call made before the real gtag.js file finishes
 * downloading is simply queued in `dataLayer` and flushed once it arrives.
 * That's what actually closes the race — not the guard itself (which stays,
 * as a defensive fallback for the case analytics is disabled entirely).
 *
 * The real gtag.js file is loaded separately with strategy="afterInteractive"
 * since it doesn't need to block anything — it only needs to exist *some*
 * time after the stub, never before it.
 */
function GoogleAnalytics() {
  if (!isAnalyticsEnabled) return null;

  return (
    <>
      {/*
        eslint-disable-next-line @next/next/no-before-interactive-script-outside-document --
        This rule only whitelists files whose path literally contains "/app/"
        (see @next/eslint-plugin-next's no-before-interactive-script-outside-document
        rule), so it doesn't recognize this component even though it's only ever
        rendered from app/layout.js (the App Router root layout), which is exactly
        where Next.js's own docs say beforeInteractive belongs:
        https://nextjs.org/docs/messages/no-before-interactive-script-outside-document
      */}
      <Script id="ga4-bootstrap" strategy="beforeInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){window.dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', {
            // GAPageViewTracker below sends page_view itself on mount and on
            // every subsequent route change (App Router navigations don't
            // trigger a full page load, so GA can't see them on its own).
            // Disabling the automatic pageview here means every page_view —
            // including the first — goes through that single code path, so
            // none is ever double-counted.
            send_page_view: false,
            // Privacy-conscious defaults: no Google Signals / ads
            // personalization. This is plain product analytics, not an ad
            // tracking pixel.
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
          });
        `}
      </Script>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Suspense fallback={null}>
        <GAPageViewTracker />
      </Suspense>
    </>
  );
}

export { GoogleAnalytics };
