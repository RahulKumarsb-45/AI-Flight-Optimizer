'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { OAuthButtons } from './OAuthButtons';
import { ApiError } from '@/lib/apiClient';
import { trackLogin } from '@/lib/analytics';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const OAUTH_ERROR_MESSAGES = {
  oauth_denied: 'Sign-in was cancelled.',
  oauth_invalid_state: 'That sign-in link expired. Please try again.',
  oauth_failed: 'Sign-in failed. Please try again or use your password.',
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    const errorCode = searchParams.get('error');
    if (errorCode) {
      toast({ variant: 'error', title: OAUTH_ERROR_MESSAGES[errorCode] || 'Sign-in failed' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(values) {
    setSubmitting(true);
    try {
      await login(values);
      trackLogin({ method: 'password' });
      router.push('/');
    } catch (err) {
      const isLocked = err instanceof ApiError && err.errorCode === 'AUTH_ACCOUNT_LOCKED';
      const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
      toast({ variant: 'error', title: isLocked ? 'Account temporarily locked' : 'Login failed', description: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <OAuthButtons />
      <div className="flex items-center gap-3 text-xs text-ink-400">
        <div className="h-px flex-1 bg-ink-100" />
        or continue with email
        <div className="h-px flex-1 bg-ink-100" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <Input label="Email" type="email" placeholder="you@example.com" error={errors.email?.message} {...register('email')} />
        <div>
          <Input label="Password" type="password" error={errors.password?.message} {...register('password')} />
          <Link href="/forgot-password" className="mt-1.5 inline-block text-sm text-horizon-700 hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" loading={submitting} className="mt-2">
          Login
        </Button>
      </form>
    </div>
  );
}

export { LoginForm };
