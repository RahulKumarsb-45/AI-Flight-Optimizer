'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageSpinner } from '@/components/ui/Spinner';
import { authService } from '@/services/authService';
import { trackLogin } from '@/lib/analytics';

export default function OAuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const finishOAuth = async () => {
      try {
        // The backend has already created the refresh-token cookie.
        // Refresh once to obtain the access token.
        const token = await authService.silentRefresh();

        if (!token) {
          throw new Error('Unable to restore authentication session');
        }

        // Verify that the authenticated user can be loaded.
        await authService.me();

        if (cancelled) return;

        trackLogin({ method: 'oauth' });

        router.replace('/');
      } catch (error) {
        console.error('OAuth callback failed:', error);

        if (!cancelled) {
          router.replace('/login?error=oauth_failed');
        }
      }
    };

    finishOAuth();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return <PageSpinner label="Finishing sign-in..." />;
}