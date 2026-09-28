import Link from 'next/link';
import { Plane } from 'lucide-react';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { RouteArc } from '@/components/common/RouteArc';

export const metadata = { title: 'Create account' };

export default function RegisterPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-16 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
            <Plane className="h-5 w-5 text-amber-500" strokeWidth={2.5} aria-hidden="true" />
            FlightOptimizer
          </Link>

          <h1 className="mt-8 font-display text-display-sm text-ink-900">Create your account</h1>
          <p className="mt-1.5 text-ink-500">Start with 5 free optimized searches a month.</p>

          <div className="mt-8">
            <RegisterForm />
          </div>

          <p className="mt-6 text-center text-sm text-ink-500">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-horizon-700 hover:underline">
              Login
            </Link>
          </p>
        </div>
      </div>

      <div className="hidden items-center justify-center bg-ink-900 lg:flex">
        <RouteArc width={420} height={160} showPlane />
      </div>
    </main>
  );
}
