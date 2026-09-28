import Link from 'next/link';
import { Sparkles, ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';

/**
 * A static, presentational preview of the existing AI Agent chat — not the
 * live component. It mirrors AIAgentContent's ChatBubble styling (same
 * colors/roles) so it reads as the same product, without wiring up real
 * conversation state or calling the AI backend from the homepage.
 */
function ShreyaPreview() {
  return (
    <figure className="rounded-xl border border-ink-100 bg-white p-5 shadow-card">
      <figcaption className="flex items-center gap-2.5 border-b border-ink-100 pb-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-horizon-700 text-white">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-sm font-semibold text-ink-900">Shreya AI</span>
          <span className="block text-xs text-ink-400">Example conversation</span>
        </span>
      </figcaption>

      <div className="mt-4 space-y-3">
        <div className="flex justify-start">
          <p className="max-w-[85%] rounded-xl bg-ink-50 px-3.5 py-2 text-sm leading-relaxed text-ink-800">
            <span className="sr-only">Shreya AI said: </span>
            Hi! I&apos;m Shreya AI. I can help you understand your flight options.
          </p>
        </div>
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-xl bg-horizon-700 px-3.5 py-2 text-sm leading-relaxed text-white">
            <span className="sr-only">You said: </span>
            Why is this option better?
          </p>
        </div>
        <div className="flex justify-start">
          <p className="max-w-[85%] rounded-xl bg-ink-50 px-3.5 py-2 text-sm leading-relaxed text-ink-800">
            <span className="sr-only">Shreya AI said: </span>
            It saves ₹8,400 while adding only 1h 20m of travel time.
          </p>
        </div>
      </div>
    </figure>
  );
}

function MeetShreya() {
  return (
    <section className="bg-horizon-50 py-12 lg:flex lg:min-h-screen lg:items-center lg:py-14">
      <div className="section-wide w-full">
        <div className="grid items-center gap-10 lg:grid-cols-[9fr_11fr] lg:gap-16 xl:gap-20">
          <div className="mx-auto max-w-lg lg:mx-0">
            <h2 className="font-display text-display-sm text-ink-900">Meet Shreya AI</h2>
            <p className="mt-2 text-lg text-horizon-700">Your AI travel copilot</p>
            <p className="mt-4 max-w-md text-ink-600">
              Ask Shreya AI about your flight options, compare recommendations, and understand why one
              trip may be better than another.
            </p>
            <p className="mt-3 max-w-md text-sm text-ink-500">
              She&apos;s part of FlightOptimizer, not a separate app — built to explain the
              recommendations the optimizer already found for you.
            </p>

            <Link href="/ai-agent" className={buttonVariants({ className: 'mt-6' })}>
              Ask Shreya AI
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {/*
           * Capped at max-w-md (448px) on mobile/tablet, where it's centered
           * under the text column. From lg up it's a real 55%-ish grid
           * column (not a floating narrow card), so the cap is lifted and
           * the preview grows to fill that column width.
           */}
          <div className="mx-auto w-full max-w-md lg:mx-0 lg:max-w-none">
            <ShreyaPreview />
          </div>
        </div>
      </div>
    </section>
  );
}

export { MeetShreya };
