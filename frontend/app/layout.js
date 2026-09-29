import { QueryProvider } from '@/lib/QueryProvider';
import { AuthProvider } from '@/hooks/useAuth';
import { ToastProvider } from '@/components/ui/Toast';
import { GoogleAnalytics } from '@/components/analytics/GoogleAnalytics';
import { PWAProvider } from '@/components/pwa/PWAProvider';
import './globals.css';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  'http://localhost:3000';

export const metadata = {
  metadataBase: new URL(SITE_URL),

  applicationName: 'FlightOptimizer',

  title: {
    default: 'FlightOptimizer — AI-powered trip planning',
    template: '%s · FlightOptimizer',
  },

  description:
    'Plan smarter trips with AI-optimized flight routes, flexible dates, and nearby-airport savings — built for the Indian traveler.',

  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'FlightOptimizer',
  },

  openGraph: {
    title:
      'FlightOptimizer — AI-powered trip planning',

    description:
      'Nearby-airport search, flexible dates, and multi-city route optimization.',

    url: SITE_URL,

    siteName: 'FlightOptimizer',

    locale: 'en_IN',

    type: 'website',
  },

  twitter: {
    card: 'summary_large_image',

    title:
      'FlightOptimizer — AI-powered trip planning',

    description:
      'Nearby-airport search, flexible dates, and multi-city route optimization.',
  },
};

// Next.js App Router viewport configuration
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1F2A52',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <PWAProvider />

        <GoogleAnalytics />

        <QueryProvider>
          <AuthProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}