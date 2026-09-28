'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { authService } from '@/services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true); // true until initial silent-refresh attempt resolves

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const token = await authService.silentRefresh();
      if (cancelled) return;

      if (token) {
        try {
          const { user: me, subscription: sub } = await authService.me();
          if (!cancelled) {
            setUser(me);
            setSubscription(sub);
          }
        } catch {
          if (!cancelled) setUser(null);
        }
      }
      if (!cancelled) setLoading(false);
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const loggedInUser = await authService.login(credentials);
    setUser(loggedInUser);
    try {
      const { subscription: sub } = await authService.me();
      setSubscription(sub);
    } catch {
      // non-fatal — subscription will populate on next full page load
    }
    return loggedInUser;
  }, []);

  const register = useCallback(async (details) => {
    return authService.register(details);
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    setSubscription(null);
  }, []);

  /**
   * Re-fetches user + subscription without a full page reload — used right
   * after a successful payment so the UI reflects the new plan immediately.
   */
  const refetchUser = useCallback(async () => {
    try {
      const { user: me, subscription: sub } = await authService.me();
      setUser(me);
      setSubscription(sub);
    } catch {
      // ignore — leaves previous state in place
    }
  }, []);

  // Without this, a brand-new object literal was created on every render of
  // AuthProvider (e.g. any state change anywhere that re-renders this
  // component tree), which changes the context value's identity and forces
  // every single consumer of useAuth() to re-render too — even when none of
  // user/subscription/loading actually changed. login/register/logout/
  // refetchUser are already stable (useCallback with empty deps), so this
  // object is now only recreated when one of the real state values changes.
  const value = useMemo(
    () => ({ user, subscription, loading, login, register, logout, refetchUser, isAuthenticated: !!user }),
    [user, subscription, loading, login, register, logout, refetchUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
