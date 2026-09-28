'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Menu, X, Plane, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dropdown, DropdownTrigger, DropdownContent, DropdownItem } from '@/components/ui/Dropdown';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
];

// Shreya AI's navbar entry is a distinct CTA, not a normal nav link — it's
// kept out of NAV_LINKS on purpose so it never gets rendered as plain link
// text. This Navbar component is shared across every page (there's no
// separate homepage-only navbar), so this single label is what renders as
// the "Try Shreya AI" CTA everywhere it appears, homepage included.
const SHREYA_CTA_LABEL = 'Try Shreya AI';
const SHREYA_CTA_BASE_CLASSES =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3.5 py-1.5 text-sm font-semibold text-amber-800 transition-colors hover:border-amber-400 hover:bg-amber-100';

// Login mirrors "Get started"'s pill shape/size so both read as a single
// matched button pair, just in outline vs filled treatment, with the same
// blue (horizon) family as the filled button instead of plain text.
const LOGIN_BUTTON_CLASSES =
  'inline-flex items-center justify-center rounded font-body text-sm font-medium h-9 px-3.5 border border-horizon-300 text-horizon-700 transition-colors hover:border-horizon-400 hover:bg-horizon-50';

function Navbar() {
  const { user, isAuthenticated, logout, loading } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-100 bg-paper/80 backdrop-blur-md">
      <nav className="container-page flex h-[70px] items-center justify-between md:grid md:grid-cols-[auto_1fr_auto] md:gap-4">
        <a
          href="#main-content"
          className="sr-only rounded bg-white px-3 py-2 text-sm font-medium text-ink-900 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:shadow-card"
        >
          Skip to main content
        </a>

        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
          <Plane className="h-5 w-5 text-amber-500" strokeWidth={2.5} aria-hidden="true" />
          FlightOptimizer
        </Link>

        {/* True horizontal centering (not just flex space-between) so the
            links stay centered in the header regardless of how wide the
            logo or right-hand action group are. */}
        <div className="hidden items-center justify-self-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm font-medium text-ink-600 hover:text-ink-900">
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-4 justify-self-end md:flex">
          <Link href="/ai-agent" className={SHREYA_CTA_BASE_CLASSES}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {SHREYA_CTA_LABEL}
          </Link>
          {!loading && !isAuthenticated && (
            <div className="flex items-center gap-3">
              <Link href="/login" className={LOGIN_BUTTON_CLASSES}>
                Login
              </Link>
            <Link href="/register?redirect=/" className={buttonVariants({ size: 'sm' })}>
            Get started
            </Link>
            </div>
          )}
          {!loading && isAuthenticated && (
            <Dropdown>
              <DropdownTrigger className="flex items-center gap-2 rounded-full border border-ink-100 py-1.5 pl-1.5 pr-3 text-sm font-medium text-ink-700 hover:bg-ink-50">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-horizon-700 text-xs font-semibold text-white">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </span>
                {user?.name?.split(' ')[0]}
              </DropdownTrigger>
              <DropdownContent align="end">
                <DropdownItem onSelect={() => router.push('/search')}>New search</DropdownItem>
                <DropdownItem onSelect={() => router.push('/dashboard')}>Dashboard</DropdownItem>
                <DropdownItem onSelect={() => router.push('/profile')}>Profile</DropdownItem>
                <DropdownItem onSelect={logout} className="text-danger-600">
                  Log out
                </DropdownItem>
              </DropdownContent>
            </Dropdown>
          )}
        </div>

        <button
          className="p-2 md:hidden"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
        >
          {mobileOpen ? <X className="h-6 w-6" aria-hidden="true" /> : <Menu className="h-6 w-6" aria-hidden="true" />}
        </button>
      </nav>

      <div
        id="mobile-menu"
        aria-hidden={!mobileOpen}
        // `inert` (not just visually collapsed) so a keyboard user tabbing
        // through the page can't land on links/buttons that are hidden
        // behind max-h-0 overflow-hidden — without it they were still
        // focusable even while invisible.
        {...(mobileOpen ? {} : { inert: 'true' })}
        className={cn('overflow-hidden border-t border-ink-100 md:hidden', mobileOpen ? 'max-h-96' : 'max-h-0 border-t-0')}
      >
        <div className="container-page flex flex-col gap-1 py-4">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded px-2 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/ai-agent"
            className={cn(SHREYA_CTA_BASE_CLASSES, 'mt-1 w-full')}
            onClick={() => setMobileOpen(false)}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {SHREYA_CTA_LABEL}
          </Link>
          <div className="mt-2 flex flex-col gap-2 border-t border-ink-100 pt-3">
            {!isAuthenticated ? (
              <>
                <Link href="/login" className={cn(LOGIN_BUTTON_CLASSES, 'h-11 w-full text-[15px]')}>
                  Login
                </Link>
                <Link href="/register?redirect=/" className={buttonVariants({})}>
                Get started
                 </Link>
              </>
            ) : (
              <button onClick={logout} className={buttonVariants({ variant: 'outline' })}>
                Log out
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

export { Navbar };
