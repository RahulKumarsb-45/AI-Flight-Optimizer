'use client';

// app/error.js only catches errors thrown below the root layout. If the
// root layout itself throws, Next.js requires this special file instead —
// and since it replaces the root layout, it must render its own <html>/
// <body>. See: https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';
import { useEffect } from 'react';

export default function GlobalError({ error }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        {/* NextError is Next.js's built-in error page component. Its type
            signature wants a statusCode, but the App Router doesn't expose
            one for root-layout errors, so we pass 0 (this only affects
            NextError's own copy, not the actual HTTP response). */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
