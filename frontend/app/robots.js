const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // logged-in-only or action pages — no value being indexed, and
        // /results in particular would otherwise generate infinite crawl
        // variations from query params. /offline (Q9) is a service-worker
        // fallback shell, not real content, so it gets the same treatment.
        disallow: ['/dashboard', '/profile', '/trips/', '/results', '/offline'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
