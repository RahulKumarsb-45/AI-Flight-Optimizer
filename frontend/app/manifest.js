// Web App Manifest, served by Next.js at /manifest.webmanifest.
// Uses the same file-based App Router convention as robots.js/sitemap.js
// alongside it, rather than a hand-written public/manifest.json.
//
// Colors match the existing Tailwind brand palette (tailwind.config.js):
// theme_color -> horizon-700 (#1F2A52), background_color -> paper (#F7F8FA).
// Icons reuse the same amber-on-navy plane mark used for the wordmark in
// Navbar.jsx/Footer.jsx (see /public/icons — generated from that palette,
// not a new/unrelated visual identity).
export default function manifest() {
  return {
    id: '/',
    name: 'FlightOptimizer',
    short_name: 'FlightOptimizer',
    description:
      'Plan smarter trips with AI-optimized flight routes, flexible dates, and nearby-airport savings — built for the Indian traveler.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Deliberately not locked to "portrait": the app includes a Mapbox map
    // (hotels/restaurants/places) and data-dense results tables that are
    // genuinely more usable in landscape, and the PWA is also a supported
    // desktop (Chrome/Edge) experience where orientation lock doesn't apply
    // anyway. "any" is the safer choice for this particular app's UI.
    orientation: 'any',
    background_color: '#F7F8FA',
    theme_color: '#1F2A52',
    lang: 'en-IN',
    dir: 'ltr',
    categories: ['travel', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Point at real, existing routes only — shortcuts are an install-quality
    // nicety, not a new feature.
    shortcuts: [
      {
        name: 'New flight search',
        short_name: 'Search',
        url: '/search',
        description: 'Start a new AI-optimized flight search',
      },
      {
        name: 'Dashboard',
        short_name: 'Dashboard',
        url: '/dashboard',
        description: 'View your saved trips and searches',
      },
    ],
  };
}
