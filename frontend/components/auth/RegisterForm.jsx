'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/apiClient';
import { OAuthButtons } from './OAuthButtons';
import { trackSignUp } from '@/lib/analytics';

// Mirrors backend/src/validators/authValidators.js exactly — a mismatch here
// means users pass frontend validation only to get rejected by the API.
const schema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(150),
  email: z.string().trim().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
  confirmPassword: z.string(),
  agreeToTerms: z.literal(true, { errorMap: () => ({ message: 'You must agree to the terms to continue' }) }),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

function RegisterForm() {
  const router = useRouter();
  const { register: registerUser } = useAuth();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });

  async function onSubmit(values) {
    setSubmitting(true);
    try {
      await registerUser({ name: values.name, email: values.email, password: values.password });
      trackSignUp({ method: 'password' });
      toast({ variant: 'success', title: 'Account created', description: 'You can now log in.' });
      router.push('/login');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
      toast({ variant: 'error', title: 'Registration failed', description: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <OAuthButtons />
      <div className="flex items-center gap-3 text-xs text-ink-400">
        <div className="h-px flex-1 bg-ink-100" />
        or sign up with email
        <div className="h-px flex-1 bg-ink-100" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <Input label="Full name" placeholder="Aditi Sharma" error={errors.name?.message} {...register('name')} />
        <Input label="Email" type="email" placeholder="you@example.com" error={errors.email?.message} {...register('email')} />
        <Input
          label="Password"
          type="password"
          placeholder="At least 8 characters"
          helperText="Must include an uppercase letter and a number"
          error={errors.password?.message}
          {...register('password')}
        />
        <Input
          label="Confirm password"
          type="password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <label className="flex items-start gap-2 text-sm text-ink-600">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-ink-300"
            aria-invalid={!!errors.agreeToTerms}
            aria-describedby={errors.agreeToTerms ? 'agree-to-terms-error' : undefined}
            {...register('agreeToTerms')}
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" className="underline hover:text-ink-900">Terms</Link> and{' '}
            <Link href="/privacy" className="underline hover:text-ink-900">Privacy Policy</Link>
          </span>
        </label>
        {errors.agreeToTerms && (
          <p id="agree-to-terms-error" className="-mt-2 text-sm text-danger-600">
            {errors.agreeToTerms.message}
          </p>
        )}

        <Button type="submit" loading={submitting} className="mt-2">
          Create account
        </Button>
      </form>
    </div>
  );
}

export { RegisterForm };
