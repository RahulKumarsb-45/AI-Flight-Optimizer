'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageSpinner } from '@/components/ui/Spinner';
import { useAuth } from '@/hooks/useAuth';
import { trackLogin } from '@/lib/analytics';

export default function OAuthCallbackPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    // AuthProvider handles the session refresh.
    // Do NOT call /auth/refresh from this page.

    if (loading) return;

    if (user) {
      trackLogin({ method: 'oauth' });
      router.replace('/');
    } else {
      router.replace('/login?error=oauth_failed');
    }
  }, [loading, user, router]);

  return <PageSpinner label="Finishing sign-in..." />;
}