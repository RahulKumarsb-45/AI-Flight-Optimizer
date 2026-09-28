'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, ShieldCheck, Zap, Users, MapPinned, CalendarRange, Route } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { useAuth } from '@/hooks/useAuth';

const TRUST_ITEMS = [
  { icon: ShieldCheck, label: 'Trusted recommendations' },
  { icon: Zap, label: 'Saves time & money' },
  { icon: Users, label: 'Built for Indian travelers' },
];

const BENEFITS = [
  { icon: MapPinned, title: 'More airports', subtitle: 'More options' },
  { icon: CalendarRange, title: 'Smarter dates', subtitle: 'Lower fares' },
  { icon: Route, title: 'Multi-city trips', subtitle: 'Bigger savings' },
];

function BenefitItems() {
  return (
    <>
      {BENEFITS.map(({ icon: Icon, title, subtitle }) => (
        <div key={title} className="flex items-center gap-3">
          <Icon className="h-5 w-5 shrink-0 text-horizon-700" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-ink-900">{title}</p>
            <p className="text-xs text-ink-500">{subtitle}</p>
          </div>
        </div>
      ))}
    </>
  );
}

function Hero() {
    const { isAuthenticated, loading } = useAuth();
  return (
    <section className="relative overflow-hidden bg-horizon-900">
      {/*
       * Background photo fills the entire hero (not a boxed-in image).
       * object-position is tuned per breakpoint so the airplane stays in
       * frame as the visible crop narrows on smaller viewports — the photo
       * itself is wider (16:9-ish) than most of these viewport ratios, so a
       * single fixed position would push the plane off-screen on phones.
       */}
      <div className="absolute inset-0">
        <Image
          src="/images/Airoplanee.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[78%_center] sm:object-[70%_center] md:object-[66%_center] lg:object-[60%_center] xl:object-[54%_center]"
        />
        {/*
         * Subtle readability scrim, not an opaque cover — the sky, clouds,
         * mountains and airplane all stay visible. Vertical on mobile/
         * tablet (copy sits on top of the photo), horizontal from the left
         * on desktop (copy sits in the left column, photo dominates the
         * right two-thirds).
         */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-white/93 from-10% via-white/60 via-45% to-white/15 to-90% lg:bg-gradient-to-r lg:from-white/92 lg:from-0% lg:via-white/45 lg:via-40% lg:to-transparent lg:to-75%"
        />
      </div>

      <div className="container-page relative">
        <div className="grid gap-6 py-10 sm:py-12 lg:grid-cols-2 lg:items-center lg:gap-6 lg:py-14 xl:py-16">
          {/* Left column: headline, copy, CTAs, trust items */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="relative"
          >
            <span className="inline-flex items-center text-xs font-semibold uppercase tracking-[0.2em] text-horizon-500">
              Smarter flights. Bigger journeys.
            </span>

            <h1 className="mt-3 text-balance font-display text-display-md text-ink-900 sm:text-display-lg lg:text-display-xl">
              Stop searching flights.
              <br />
              <span className="text-amber-600">Start optimizing trips.</span>
            </h1>

            <p className="mt-4 max-w-xl text-balance text-lg text-ink-600">
              Tell us your budget and dates. We check nearby airports, flexible dates, and
              multi-city routes — then explain exactly why each recommendation beats the rest.
            </p>

           <div className="mt-6 flex flex-col gap-3 sm:flex-row">
           <Link
  href={
    loading
      ? '#'
      : isAuthenticated
        ? '/dashboard'
        : '/register?redirect=/dashboard'
  }
  className={`${buttonVariants({ size: 'lg' })} w-full sm:w-auto`}
>
  Plan your first trip
  <ArrowRight className="h-4 w-4" aria-hidden="true" />
</Link>
              <Link
                href="/#how-it-works"
                className={`${buttonVariants({ variant: 'outline', size: 'lg' })} w-full border-ink-200 bg-white/70 backdrop-blur-sm hover:bg-white sm:w-auto`}
              >
                See how it works
              </Link>
            </div>

            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-3">
              {TRUST_ITEMS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2 text-sm font-medium text-ink-700">
                  <Icon className="h-4 w-4 text-horizon-700" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </motion.div>

          {/*
           * Right column reserves vertical space for the photo/airplane on
           * large screens, via a fixed min-height rather than content — its
           * two children (caption + benefits panel below) are both
           * absolutely positioned, so this column's rendered height is
           * always exactly that min-height, regardless of how tall the
           * left column's headline/copy get at a given breakpoint. That
           * makes the benefits panel's position below stable and
           * predictable, instead of drifting with text length the way a
           * percentage-of-the-whole-row offset did.
           */}
          <div className="relative hidden lg:block lg:min-h-[340px] xl:min-h-[380px]">
            <span
              aria-hidden="true"
              className="absolute right-6 top-2 -rotate-3 font-display text-lg italic text-ink-700 xl:right-10 xl:top-4 xl:text-xl"
            >
              Better trips ahead
              <svg
                viewBox="0 0 160 20"
                className="mt-1 h-3 w-32 text-amber-600 xl:w-36"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              >
                <path d="M4 12c30-14 100-14 152 2" />
              </svg>
            </span>

            {/*
             * Benefits panel, large screens only: sits below the airplane
             * caption and above this column's own lower edge — which, since
             * the two-column grid is vertically centered, lands in the
             * lower-middle of the hero rather than at the section's true
             * bottom.
             */}
            <div className="absolute bottom-8 right-0 z-10 flex w-fit gap-8 rounded-2xl border border-ink-100 bg-white/95 p-4 shadow-card backdrop-blur xl:bottom-10">
              <BenefitItems />
            </div>
          </div>
        </div>

        {/* Same benefits panel, stacked in normal flow below the hero copy on mobile/tablet. */}
        <div className="relative z-10 mb-8 grid grid-cols-1 gap-4 rounded-xl border border-ink-100 bg-white/95 p-4 shadow-card backdrop-blur sm:grid-cols-3 sm:gap-6 lg:hidden">
          <BenefitItems />
        </div>
      </div>
    </section>
  );
}

export { Hero };
