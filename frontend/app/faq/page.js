import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { ChevronDown } from 'lucide-react';

export const metadata = { title: 'FAQ' };

const FAQS = [
  {
    question: 'Are these real, bookable flights?',
    answer:
      "By default this runs on a mock flight provider tuned to realistic pricing and duration by distance. A real Amadeus API integration exists in the codebase and can be switched on via configuration — this is a portfolio build, not a live booking service, so you can't complete a purchase here.",
  },
  {
    question: 'How far do "nearby airports" go?',
    answer:
      'Up to 3 alternate airports within roughly 300km of your city, ranked by a blend of distance and how major the hub is — a slightly farther major airport can beat a very close tiny one.',
  },
  {
    question: 'How many countries can one trip cover?',
    answer:
      'Up to 4. Beyond that, the number of route order + date + airport combinations grows too fast to search in a reasonable time, so it\'s capped.',
  },
  {
    question: 'How does flexible date search work?',
    answer:
      'Turning it on checks departure dates up to 3 days either side of what you picked, keeping your trip length the same, and returns whichever combination scores best for your chosen preference.',
  },
  {
    question: 'What does "optimize for balanced" actually do?',
    answer:
      'Each result is scored on price, duration, and number of stops, weighted according to whether you chose cheapest, fastest, or balanced. Balanced weighs all three roughly evenly instead of maximizing on just one.',
  },
  {
    question: 'Why does a recommendation say it uses a "nearby airport"?',
    answer:
      "That badge means the optimizer picked an alternate airport instead of the main one for your city, usually because it worked out cheaper or shorter overall — the explanation text under each result spells out the trade-off in plain numbers.",
  },
  {
    question: 'Do I need an account to search?',
    answer:
      "No — searching works as a guest. Creating an account lets you save trips and see your search history in the dashboard.",
  },
  {
    question: 'Can I actually upgrade to Pro or Business?',
    answer:
      "Not yet. The pricing tiers, database schema, and Razorpay configuration are in place, but the payment flow itself isn't wired up in this build — registering currently creates a Free-tier account regardless of which plan button you click.",
  },
];

export default function FAQPage() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="container-page max-w-4xl py-16">
        <h1 className="font-display text-display-md text-ink-900">Frequently asked questions</h1>

        <div className="mt-8 divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white">
          {FAQS.map((faq) => (
            <details key={faq.question} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ink-900">
                {faq.question}
                <ChevronDown className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2.5 text-sm leading-relaxed text-ink-600">{faq.answer}</p>
            </details>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
