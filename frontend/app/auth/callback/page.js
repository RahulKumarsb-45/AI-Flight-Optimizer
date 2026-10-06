'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageSpinner } from '@/components/ui/Spinner';
import { trackLogin } from '@/lib/analytics';

export default function OAuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // Google OAuth has already been completed by the backend.
    // Do NOT call /auth/refresh here.
    // AuthProvider will handle the session refresh on the home page.
    trackLogin({ method: 'oauth' });

    router.replace('/');
  }, [router]);

  return <PageSpinner label="Finishing sign-in..." />;
}