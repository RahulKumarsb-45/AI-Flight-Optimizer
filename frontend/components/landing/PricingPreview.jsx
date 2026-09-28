import Link from 'next/link';
import { Check } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatInr } from '@/utils/format';

const PLANS = [
  {
    name: 'Free',
    price: 0,
    tagline: 'Try the optimizer',
    features: ['5 optimized searches / month', '1 saved trip', 'Cheapest, fastest & balanced picks'],
  },
  {
    name: 'Pro',
    price: 499,
    tagline: 'For frequent planners',
    highlighted: true,
    features: ['Unlimited searches', 'Unlimited saved trips', 'Multi-city routing (up to 4 countries)', 'Price alerts'],
  },
  {
    name: 'Business',
    price: 1499,
    tagline: 'For teams booking travel',
    features: ['Everything in Pro', 'Multiple traveler profiles', 'Priority support'],
  },
];

function PricingPreview() {
  return (
    <section className="container-page py-16">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="font-display text-display-sm text-ink-900">Simple, ₹-first pricing</h2>
        <p className="mt-3 text-ink-500">Start free. Upgrade only when the searches run out.</p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:gap-8">
        {PLANS.map((plan, index) => (
          <div
            key={plan.name}
            className={
              (plan.highlighted
                ? 'flex h-full flex-col rounded-xl border-2 border-amber-500 bg-white p-7 shadow-glow-amber'
                : 'flex h-full flex-col rounded-xl border border-ink-100 bg-white p-7 shadow-soft') +
              // On the tablet 2-column grid, the 3rd card would otherwise sit
              // alone in a half-empty row — span it full width there. Desktop
              // (lg+) goes back to the normal 3-up row.
              (index === PLANS.length - 1
                ? ' sm:col-span-2 sm:mx-auto sm:w-full sm:max-w-sm lg:col-span-1 lg:mx-0 lg:max-w-none'
                : '')
            }
          >
            <h3 className="font-display text-xl text-ink-900">{plan.name}</h3>
            <p className="mt-1 text-sm text-ink-500">{plan.tagline}</p>
            <p className="mt-4 font-mono text-3xl font-medium text-ink-900">
              {plan.price === 0 ? 'Free' : formatInr(plan.price)}
              {plan.price > 0 && <span className="text-sm font-normal text-ink-400">/month</span>}
            </p>
            <ul className="mt-5 space-y-2.5">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-ink-600">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-route-500" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/register"
              className={buttonVariants({ variant: plan.highlighted ? 'accent' : 'outline', className: 'mt-6 w-full lg:mt-auto' })}
            >
              {plan.price === 0 ? 'Start free' : 'Choose ' + plan.name}
            </Link>
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-ink-400">
        <Link href="/pricing" className="underline underline-offset-2 hover:text-ink-700">
          Compare full plan details
        </Link>
      </p>
    </section>
  );
}

export { PricingPreview };
