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
    // Wait for AuthProvider to restore the session.
    if (loading) {
      return;
    }

    // Session restored successfully.
    if (user) {
      trackLogin({ method: 'oauth' });
      router.replace('/');
      return;
    }

    // OAuth callback completed but session could not be restored.
    router.replace('/login?error=oauth_failed');
  }, [loading, user, router]);

  return <PageSpinner label="Finishing sign-in..." />;
}