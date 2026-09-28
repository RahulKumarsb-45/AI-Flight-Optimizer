'use client';

import Link from 'next/link';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';

const FAQS = [
  {
    id: 'real-flights',
    question: 'Are these real, bookable flights?',
    answer:
      'By default the demo runs on a mock provider that models realistic pricing by distance. A real Amadeus integration is available and can be switched on — this is a portfolio build, not a live booking service.',
  },
  {
    id: 'nearby',
    question: 'How far do "nearby airports" go?',
    answer:
      'Up to 3 alternate airports within roughly 300km of your city, ranked by a mix of distance and how major the hub is.',
  },
  {
    id: 'multi-city',
    question: 'How many countries can one trip cover?',
    answer: 'Up to 4. Beyond that the number of route combinations grows too fast to search in reasonable time.',
  },
];

function FAQPreview() {
  return (
    <section className="container-page py-16">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="font-display text-display-sm text-ink-900">Questions people actually ask</h2>
      </div>

      {/*
       * Widened further to max-w-[75rem] (1200px, within the requested
       * 1100-1300px range) so the FAQ reads as a major homepage section
       * instead of a small central box — the previous max-w-4xl (896px)
       * was still too narrow. This width also comfortably fits all three
       * tab labels on one line at desktop widths, which removes the
       * internal tab-row scrollbar that was visible at the narrower size.
       * min-w-0 on the wrapper + TabsList still guarantees the
       * flex/inline-flex tab row can never force this block wider than its
       * container — any residual tab-label overflow (e.g. very narrow
       * viewports) scrolls inside TabsList (overflow-x-auto) rather than
       * pushing out the page.
       */}
      <div className="mx-auto mt-10 min-w-0 max-w-[75rem]">
        <Tabs defaultValue={FAQS[0].id} className="min-w-0">
          <TabsList className="w-full min-w-0 max-w-full justify-start overflow-x-auto">
            {FAQS.map((faq) => (
              <TabsTrigger key={faq.id} value={faq.id} className="whitespace-nowrap">
                {faq.question}
              </TabsTrigger>
            ))}
          </TabsList>
          {FAQS.map((faq) => (
            <TabsContent key={faq.id} value={faq.id} className="mt-5 rounded-lg border border-ink-100 bg-white p-6">
              <p className="text-ink-600">{faq.answer}</p>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <p className="mt-8 text-center text-sm text-ink-400">
        <Link href="/faq" className="underline underline-offset-2 hover:text-ink-700">
          See all FAQs
        </Link>
      </p>
    </section>
  );
}

export { FAQPreview };
