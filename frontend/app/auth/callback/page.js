'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { PageSpinner } from '@/components/ui/Spinner';
import { trackLogin } from '@/lib/analytics';

export default function OAuthCallbackPage() {
  const { loading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return; // AuthProvider's mount-time silent-refresh is still running
    if (isAuthenticated) {
      // The backend doesn't return which OAuth provider was used, and OAuth
      // serves both login and first-time sign-up through the same redirect,
      // so this is reported as a generic 'oauth' login rather than guessing
      // at sign_up vs. login (or which provider).
      trackLogin({ method: 'oauth' });
    }
    router.replace(isAuthenticated ? '/' : '/login?error=oauth_failed');
  }, [loading, isAuthenticated, router]);

  return <PageSpinner label="Finishing sign-in..." />;
}
