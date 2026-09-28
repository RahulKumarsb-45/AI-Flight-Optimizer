'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { paymentService } from '@/services/paymentService';
import { formatInr } from '@/utils/format';
import { cn } from '@/lib/utils';
import { PLANS } from './plans-data';
import { trackBeginCheckout, trackPurchase } from '@/lib/analytics';

function PricingPlans() {
  const { isAuthenticated, subscription, refetchUser } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [payingPlan, setPayingPlan] = useState(null);

  const currentPlan = subscription?.plan || (isAuthenticated ? 'free' : null);

  async function handleChoose(plan) {
    if (!isAuthenticated) {
      router.push('/register');
      return;
    }
    if (plan.key === 'free' || plan.key === currentPlan) return;

    if (typeof window.Razorpay === 'undefined') {
      toast({ variant: 'error', title: 'Payment could not load', description: 'Please refresh and try again.' });
      return;
    }

    setPayingPlan(plan.key);
    try {
      const order = await paymentService.createOrder(plan.key);
      trackBeginCheckout({ plan: plan.key, valueInr: plan.price });

      const razorpay = new window.Razorpay({
        key: order.razorpayKeyId,
        amount: order.amountPaise,
        currency: order.currency,
        order_id: order.orderId,
        name: 'FlightOptimizer',
        description: `${plan.name} plan — monthly`,
        theme: { color: '#1E3A8A' },
        handler: async (response) => {
          try {
            await paymentService.verifyPayment({
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            await refetchUser();
            trackPurchase({ plan: plan.key, valueInr: plan.price, orderId: order.orderId });
            toast({ variant: 'success', title: `You're on ${plan.name} now`, description: 'Thanks for upgrading!' });
          } catch (err) {
            toast({ variant: 'error', title: 'Payment verification failed', description: err.message });
          } finally {
            setPayingPlan(null);
          }
        },
        modal: {
          ondismiss: () => setPayingPlan(null),
        },
      });

      razorpay.on('payment.failed', (response) => {
        toast({ variant: 'error', title: 'Payment failed', description: response.error?.description });
        setPayingPlan(null);
      });

      razorpay.open();
    } catch (err) {
      toast({ variant: 'error', title: 'Could not start payment', description: err.message });
      setPayingPlan(null);
    }
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:gap-8">
        {PLANS.map((plan, index) => {
          const isCurrent = isAuthenticated && currentPlan === plan.key;
          return (
            <div
              key={plan.key}
              className={cn(
                'flex h-full flex-col rounded-xl border bg-white p-7',
                plan.highlighted ? 'border-2 border-amber-400 shadow-glow-amber' : 'border-ink-100 shadow-soft',
                // On the tablet 2-column grid the 3rd card would otherwise sit
                // alone in a half-empty row — span it full width there, same
                // pattern used by the homepage pricing preview. Desktop (lg+)
                // goes back to a normal 3-up row.
                index === PLANS.length - 1
                  ? 'sm:col-span-2 sm:mx-auto sm:w-full sm:max-w-sm lg:col-span-1 lg:mx-0 lg:max-w-none'
                  : ''
              )}
            >
              {plan.highlighted && !isCurrent && (
                <span className="mb-3 inline-block w-fit rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                  Most popular
                </span>
              )}
              {isCurrent && (
                <span className="mb-3 inline-flex w-fit items-center gap-1 rounded-full bg-route-50 px-2.5 py-1 text-xs font-medium text-route-700">
                  <Check className="h-3 w-3" aria-hidden="true" /> Current plan
                </span>
              )}
              <h2 className="font-display text-xl text-ink-900">{plan.name}</h2>
              <p className="mt-1 text-sm text-ink-500">{plan.tagline}</p>
              <p className="mt-4 font-mono text-3xl font-medium text-ink-900">
                {plan.price === 0 ? 'Free' : formatInr(plan.price)}
                {plan.price > 0 && <span className="text-sm font-normal text-ink-400">/month</span>}
              </p>

              {plan.features?.length > 0 && (
                <ul className="mt-5 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-ink-600">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-route-500" aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>
              )}

              <Button
                onClick={() => handleChoose(plan)}
                disabled={isCurrent}
                loading={payingPlan === plan.key}
                variant={plan.highlighted ? 'accent' : 'outline'}
                className="mt-6 w-full lg:mt-auto"
              >
                {isCurrent ? 'Current plan' : isAuthenticated ? `Choose ${plan.name}` : plan.price === 0 ? 'Start free' : `Choose ${plan.name}`}
              </Button>
            </div>
          );
        })}
      </div>
    </>
  );
}

export { PricingPlans };
