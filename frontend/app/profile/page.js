'use client';

import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { formatIndianDate, formatInr } from '@/utils/format';
import { LogOut, Sparkles } from 'lucide-react';
import Link from 'next/link';

const PLAN_LABELS = { free: 'Free', pro: 'Pro', business: 'Business' };
const PLAN_PRICES = { pro: 499, business: 1499 };

function ProfileContent() {
  const { user, subscription, logout } = useAuth();
  const plan = subscription?.plan || 'free';

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="font-display text-display-sm text-ink-900">Profile</h1>

      <Card className="p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-horizon-700 text-xl font-semibold text-white">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </span>
          <div>
            <p className="font-display text-lg text-ink-900">{user?.name}</p>
            <p className="text-sm text-ink-500">{user?.email}</p>
          </div>
        </div>

        <dl className="mt-6 space-y-3 border-t border-ink-100 pt-5 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-400">Sign-in method</dt>
            <dd className="capitalize text-ink-700">{user?.auth_provider || 'email'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-400">Email verified</dt>
            <dd>
              <Badge variant={user?.email_verified ? 'route' : 'amber'}>
                {user?.email_verified ? 'Verified' : 'Pending'}
              </Badge>
            </dd>
          </div>
          {user?.created_at && (
            <div className="flex justify-between">
              <dt className="text-ink-400">Member since</dt>
              <dd className="text-ink-700">{formatIndianDate(user.created_at)}</dd>
            </div>
          )}
        </dl>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-ink-400">Current plan</p>
            <p className="mt-0.5 font-display text-lg text-ink-900">{PLAN_LABELS[plan]}</p>
          </div>
          <Badge variant={plan === 'free' ? 'neutral' : 'amber'}>
            {plan === 'free' ? 'Free' : `${formatInr(PLAN_PRICES[plan])}/mo`}
          </Badge>
        </div>
        {subscription?.current_period_end && plan !== 'free' && (
          <p className="mt-2 text-xs text-ink-400">
            Renews {formatIndianDate(subscription.current_period_end)}
          </p>
        )}
        {plan === 'free' && (
          <Link href="/pricing">
            <Button variant="outline" size="sm" className="mt-4 w-full">
              <Sparkles className="h-3.5 w-3.5" /> Upgrade plan
            </Button>
          </Link>
        )}
      </Card>

      <p className="text-center text-xs text-ink-400">
        Editing your name and travel preferences is coming in a future update.
      </p>

      <Button variant="outline" onClick={logout} className="w-full">
        <LogOut className="h-4 w-4" /> Log out
      </Button>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="container-page py-14">
        <ProtectedRoute>
          <ProfileContent />
        </ProtectedRoute>
      </main>
      <Footer />
    </>
  );
}
