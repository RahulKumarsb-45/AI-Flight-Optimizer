import Link from 'next/link';
import { Plane } from 'lucide-react';

const FOOTER_LINKS = {
  Product: [
    { href: '/pricing', label: 'Pricing' },
    { href: '/how-it-works', label: 'How it works' },
    { href: '/ai-agent', label: 'Shreya AI' },
  ],
  Company: [
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
    { href: '/faq', label: 'FAQ' },
  ],
  Legal: [
    { href: '/privacy', label: 'Privacy Policy' },
    { href: '/terms', label: 'Terms & Conditions' },
  ],
};

function Footer() {
  return (
    <footer className="border-t border-ink-100 bg-white">
      <div className="container-page grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
            <Plane className="h-5 w-5 text-amber-500" strokeWidth={2.5} aria-hidden="true" />
            FlightOptimizer
          </Link>
          <p className="mt-3 max-w-xs text-sm text-ink-500">
            AI-optimized flight routes and trip planning, built for the Indian traveler.
          </p>
        </div>

        {Object.entries(FOOTER_LINKS).map(([section, links]) => (
          <div key={section}>
            <h3 className="text-sm font-semibold text-ink-900">{section}</h3>
            <ul className="mt-3 space-y-2.5">
              {links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-ink-500 hover:text-ink-900">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-ink-100 py-6">
        <p className="container-page text-center text-xs text-ink-400">
          © {new Date().getFullYear()} FlightOptimizer. Built as a portfolio project — not a live booking service.
        </p>
      </div>
    </footer>
  );
}

export { Footer };
