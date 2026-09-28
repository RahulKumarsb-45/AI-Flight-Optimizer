import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { BackButton } from '@/components/common/BackButton';
import { RouteArc } from '@/components/common/RouteArc';

export const metadata = { title: 'About' };

const PRINCIPLES = [
  {
    title: 'Real optimization, not a filter',
    description:
      'Nearby airports, flexible dates, and route ordering are searched combinatorially and scored — not just sorted by price.',
  },
  {
    title: 'Explainable by default',
    description:
      'Every recommendation says exactly what it costs more or less, and why — no black-box ranking to take on faith.',
  },
  {
    title: 'Built like production software',
    description:
      'Real request validation, capped combinatorics to keep searches fast, automated tests, and accessibility work throughout.',
  },
];

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <BackButton />
      {/*
       * Matches the homepage's section pattern: a full-width container-page
       * (same as Hero/HowItWorks/Features) so the page uses the same amount
       * of screen as the homepage, with an inner max-width only around the
       * text itself so paragraphs stay comfortably readable rather than
       * running edge to edge.
       */}
      <main id="main-content" className="container-page py-16">
        <div className="mx-auto max-w-3xl text-center">
          <RouteArc width={360} height={120} className="mx-auto block" />
          <h1 className="mt-6 font-display text-display-md text-ink-900">Why we built this</h1>
        </div>

        <div className="mx-auto mt-6 max-w-3xl space-y-4 text-ink-600">
          <p>
            Most flight search tools do one thing: they show you flights for the exact route and dates you typed in.
            But the cheapest, fastest, or most sensible way to get somewhere often isn&rsquo;t the obvious one — a
            nearby airport might be a fraction of the price, or shifting your dates by a couple of days could save
            hours of layover time.
          </p>
          <p>
            FlightOptimizer runs that exploration for you: it expands your search across nearby airports, checks a
            window of flexible dates, and — for multi-country trips — tries different route orderings, then scores
            everything on price, duration, and stops so you can see the trade-offs at a glance instead of running
            the same search a dozen times by hand.
          </p>
          <p>
            This is an independent project built end-to-end — backend, optimizer engine, and frontend — as a
            demonstration of production-style engineering: real request validation, capped combinatorics to keep
            searches fast, and explanations for every recommendation instead of a black-box ranking.
          </p>
          <p className="text-sm text-ink-400">
            Flight data in the current build comes from a mock provider tuned to realistic pricing and duration
            patterns. Support for live pricing via a real flight API is a planned next step.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:gap-8">
          {PRINCIPLES.map((principle) => (
            <div key={principle.title} className="rounded-lg border border-ink-100 bg-white p-6 lg:p-7">
              <h2 className="font-display text-lg text-ink-900">{principle.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{principle.description}</p>
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
