import Link from 'next/link';
import { ArrowRight, MapPinned, CalendarRange, Route, ScrollText } from 'lucide-react';
import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { BackButton } from '@/components/common/BackButton';
import { buttonVariants } from '@/components/ui/button-variants';

export const metadata = { title: 'How It Works' };

const STEPS = [
  {
    number: '01',
    title: 'Tell us your trip',
    description: 'Origin, destinations, dates and budget.',
    detail:
      'Start with as little as an origin city and where you want to go. Add dates, a budget in ₹, and how many people are travelling — the optimizer works with whatever you give it.',
  },
  {
    number: '02',
    title: 'We optimize',
    description: 'Nearby airports, flexible dates and multi-city routes.',
    detail:
      'Behind the scenes we expand your search across nearby airports, check a window of flexible dates, and — for multi-country trips — try different route orderings, all within a time budget that keeps searches fast.',
  },
  {
    number: '03',
    title: 'Compare recommendations',
    description: 'See the best options and understand the trade-offs.',
    detail:
      'Every result is scored on price, duration, and number of stops. Cheapest, fastest, and balanced picks are called out so you can see the trade-offs at a glance instead of scrolling a long list.',
  },
  {
    number: '04',
    title: 'Ask Shreya AI',
    description: 'Ask Shreya AI why an option is better and get help understanding your trip.',
    detail:
      'Ask Shreya AI about your flight options in plain language — why one trip beats another, what a nearby-airport swap actually saves, or how to fit your budget.',
  },
];

const WHY_IT_WORKS = [
  {
    icon: MapPinned,
    title: 'Nearby airport expansion',
    description:
      'Flying from Delhi? We also check Jaipur and Chandigarh. A 2-hour drive can mean a ₹6,000 saving on the flight itself.',
  },
  {
    icon: CalendarRange,
    title: 'Flexible date search',
    description: 'Give us a ±3 day window and we search every combination — not just the exact date you typed in.',
  },
  {
    icon: Route,
    title: 'Multi-city routing',
    description: 'Plan a circuit across up to 4 countries. We work out the order and dates that keep travel time sane.',
  },
  {
    icon: ScrollText,
    title: 'A reason for every pick',
    description: 'No black-box ranking. Every recommendation says exactly what it costs more or less, and why.',
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <Navbar />
      <BackButton />
      <main id="main-content">
        {/* Intro — same container-page + centered max-width text pattern the
            homepage uses for every section heading, so this page opens at
            the same visual width as the homepage rather than a narrow
            floating column. */}
        <section className="container-page py-16">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="font-display text-display-md text-ink-900">How it works</h1>
            <p className="mt-3 text-ink-500">
              From your trip details to a recommendation you understand — one flow, four steps.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 xl:gap-8">
            {STEPS.map((step) => (
              <div
                key={step.number}
                className="flex h-full flex-col rounded-lg border border-ink-100 bg-white p-6 shadow-soft transition-colors hover:border-horizon-200 lg:p-7"
              >
                <span className="font-mono text-sm text-amber-600">{step.number}</span>
                <h2 className="mt-2 font-display text-lg text-ink-900">{step.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{step.description}</p>
                <p className="mt-3 text-sm leading-relaxed text-ink-600">{step.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* What actually changes your fare — same content family as the
            homepage Features section, expanded with more detail since this
            is the dedicated page for it. */}
        <section className="container-page bg-paper-muted py-16">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-display-sm text-ink-900">What actually changes your fare</h2>
            <p className="mt-3 text-ink-500">
              Four levers most search engines ignore because checking them properly takes real computation.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-8">
            {WHY_IT_WORKS.map((feature) => (
              <div key={feature.title} className="rounded-lg border border-ink-100 bg-white p-6 lg:p-7">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-horizon-50 text-horizon-700">
                  <feature.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-3 font-display text-lg text-ink-900">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="container-page py-16 text-center">
          <div className="mx-auto max-w-2xl">
            <h2 className="font-display text-display-sm text-ink-900">Ready to see it for your trip?</h2>
            <p className="mt-3 text-ink-500">
              Run a real search, or tell Shreya AI where you want to go and let her help you get there.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/search" className={buttonVariants({ className: 'w-full sm:w-auto' })}>
                Start a search
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/ai-agent" className={buttonVariants({ variant: 'outline', className: 'w-full sm:w-auto' })}>
                Ask Shreya AI
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
