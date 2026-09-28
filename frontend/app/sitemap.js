const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

// Static, public marketing/legal pages only — search/results/dashboard/trips/profile
// are excluded since they're either behind auth or produce infinite query-string
// variations that don't belong in a sitemap.
const STATIC_ROUTES = ['', '/about', '/pricing', '/contact', '/faq', '/privacy', '/terms', '/login', '/register'];

export default function sitemap() {
  const now = new Date();
  return STATIC_ROUTES.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: now,
    changeFrequency: route === '' ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : 0.6,
  }));
}
