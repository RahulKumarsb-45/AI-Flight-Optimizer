'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageSpinner } from '@/components/ui/Spinner';
import { trackLogin } from '@/lib/analytics';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://ai-flight-optimizer-api.onrender.com/api';

export default function OAuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const finishOAuth = async () => {
      try {
        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`Refresh failed: ${response.status}`);
        }

        trackLogin({ method: 'oauth' });

        // Force a fresh app load so AuthProvider reads the new session.
        window.location.replace('/');
      } catch (error) {
        console.error('OAuth callback failed:', error);
        router.replace('/login?error=oauth_failed');
      }
    };

    finishOAuth();
  }, [router]);

  return <PageSpinner label="Finishing sign-in..." />;
}