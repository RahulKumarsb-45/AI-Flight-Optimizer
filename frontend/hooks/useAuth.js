'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { usePathname } from 'next/navigation';
import { authService } from '@/services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);

  const pathname = usePathname();

  /**
   * Restore the existing session when the application loads.
   *
   * IMPORTANT:
   * The OAuth callback page handles its own refresh.
   * Therefore AuthProvider must NOT call silentRefresh()
   * while the user is on /auth/callback.
   *
   * This prevents two refresh requests from happening
   * at the same time and invalidating the refresh token.
   */
  useEffect(() => {
    // OAuth callback handles authentication itself.
    if (pathname === '/auth/callback') {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function restoreSession() {
      try {
        const token = await authService.silentRefresh();

        // Component/page changed before request finished.
        if (cancelled) return;

        if (token) {
          try {
            const { user: me, subscription: sub } =
              await authService.me();

            if (!cancelled) {
              setUser(me);
              setSubscription(sub);
            }
          } catch {
            if (!cancelled) {
              setUser(null);
              setSubscription(null);
            }
          }
        } else {
          if (!cancelled) {
            setUser(null);
            setSubscription(null);
          }
        }
      } catch {
        // No valid session. This is normal for logged-out users.
        if (!cancelled) {
          setUser(null);
          setSubscription(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  /**
   * Normal email/password login.
   */
  const login = useCallback(async (credentials) => {
    const loggedInUser = await authService.login(credentials);

    setUser(loggedInUser);

    try {
      const { subscription: sub } = await authService.me();
      setSubscription(sub);
    } catch {
      // Subscription is non-critical.
    }

    return loggedInUser;
  }, []);

  /**
   * Register a new user.
   */
  const register = useCallback(async (details) => {
    return authService.register(details);
  }, []);

  /**
   * Logout the current user.
   */
  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      setUser(null);
      setSubscription(null);
    }
  }, []);

  /**
   * Re-fetch user and subscription without reloading the page.
   * Used after successful payment/subscription updates.
   */
  const refetchUser = useCallback(async () => {
    try {
      const { user: me, subscription: sub } =
        await authService.me();

      setUser(me);
      setSubscription(sub);
    } catch {
      // Keep the existing state if the request fails.
    }
  }, []);

  /**
   * Memoized context value prevents unnecessary re-renders.
   */
  const value = useMemo(
    () => ({
      user,
      subscription,
      loading,
      login,
      register,
      logout,
      refetchUser,
      isAuthenticated: !!user,
    }),
    [
      user,
      subscription,
      loading,
      login,
      register,
      logout,
      refetchUser,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error(
      'useAuth must be used within AuthProvider'
    );
  }

  return ctx;
}