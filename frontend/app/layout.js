import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import { QueryProvider } from '@/lib/QueryProvider';
import { AuthProvider } from '@/hooks/useAuth';
import { ToastProvider } from '@/components/ui/Toast';
import { GoogleAnalytics } from '@/components/analytics/GoogleAnalytics';
import { PWAProvider } from '@/components/pwa/PWAProvider';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  weight: ['500', '600', '700'],
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  weight: ['400', '500'],
  display: 'swap',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: 'FlightOptimizer',
  title: {
    default: 'FlightOptimizer — AI-powered trip planning',
    template: '%s · FlightOptimizer',
  },
  description:
    'Plan smarter trips with AI-optimized flight routes, flexible dates, and nearby-airport savings — built for the Indian traveler.',
  // manifest/icons are NOT set here: app/manifest.js, app/icon.png, and
  // app/apple-icon.png are all Next.js App Router file-based conventions
  // that get auto-discovered and linked in <head> on their own (Q9). Adding
  // them again here would risk duplicate <link> tags.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'FlightOptimizer',
  },
  openGraph: {
    title: 'FlightOptimizer — AI-powered trip planning',
    description: 'Nearby-airport search, flexible dates, and multi-city route optimization.',
    url: SITE_URL,
    siteName: 'FlightOptimizer',
    locale: 'en_IN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FlightOptimizer — AI-powered trip planning',
    description: 'Nearby-airport search, flexible dates, and multi-city route optimization.',
  },
};

// Next.js 14 split themeColor/viewport out of `metadata` into their own
// export (having them inside `metadata` now logs a console warning) — this
// is what actually drives the browser UI chrome color and mobile viewport
// behavior for the installed PWA.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1F2A52', // matches theme_color in app/manifest.js (horizon-700)
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <PWAProvider />
        <GoogleAnalytics />
        <QueryProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
