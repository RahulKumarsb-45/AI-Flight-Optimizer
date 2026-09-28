import { Check, Minus } from 'lucide-react';
import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { BackButton } from '@/components/common/BackButton';
import { PricingPlans } from '@/components/pricing/PricingPlans';
import { PLANS } from '@/components/pricing/plans-data';

export const metadata = { title: 'Pricing' };

const FEATURES = [
  { label: 'Optimized searches per month', free: '5', pro: 'Unlimited', business: 'Unlimited' },
  { label: 'Nearby airport expansion', free: true, pro: true, business: true },
  { label: 'Flexible date search (±3 days)', free: true, pro: true, business: true },
  { label: 'Multi-city routing', free: '1 country', pro: 'Up to 4 countries', business: 'Up to 4 countries' },
  { label: 'Saved trips', free: '1', pro: 'Unlimited', business: 'Unlimited' },
  { label: 'Cheapest / fastest / balanced picks', free: true, pro: true, business: true },
  { label: 'Price alerts', free: false, pro: true, business: true },
  { label: 'Multiple traveler profiles', free: false, pro: false, business: true },
  { label: 'Priority support', free: false, pro: false, business: true },
];

function FeatureCell({ value }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-route-600" />;
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-ink-300" />;
  return <span className="text-sm text-ink-700">{value}</span>;
}

export default function PricingPage() {
  return (
    <>
      <Navbar />
      <BackButton />
      <main id="main-content" className="container-page py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-display-md text-ink-900">Simple, transparent pricing</h1>
          <p className="mt-3 text-ink-500">
            Start free. Upgrade when you&rsquo;re planning trips often enough that unlimited searches pay for themselves.
          </p>
        </div>

        <div className="mt-12">
          <PricingPlans />
        </div>

        <div className="mt-16 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-100">
                <th className="py-3 text-sm font-medium text-ink-400">Feature</th>
                {PLANS.map((plan) => (
                  <th key={plan.key} className="py-3 text-center text-sm font-medium text-ink-700">
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((row) => (
                <tr key={row.label} className="border-b border-ink-50">
                  <td className="py-3.5 text-sm text-ink-700">{row.label}</td>
                  <td className="py-3.5 text-center">
                    <FeatureCell value={row.free} />
                  </td>
                  <td className="py-3.5 text-center">
                    <FeatureCell value={row.pro} />
                  </td>
                  <td className="py-3.5 text-center">
                    <FeatureCell value={row.business} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-center text-sm text-ink-400">
          Prices in INR, billed monthly. Payments are processed securely via Razorpay.
        </p>
      </main>
      <Footer />
    </>
  );
}
