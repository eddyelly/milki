'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { http, refreshSession, send, setAccessToken } from './api';
import type { OtpChallenge, Role, Session, User } from './types';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: Status;
  user: User | null;
  /** Step 1: password → OTP is texted. */
  startLogin(identifier: string, password: string): Promise<OtpChallenge>;
  /** Step 2: confirm the 6-digit code. */
  completeLogin(challengeId: string, code: string): Promise<User>;
  resendCode(challengeId: string): Promise<OtpChallenge>;
  logout(): Promise<void>;
  hasRole(...roles: Role[]): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Non-sensitive hint that this browser has a session cookie, so signed-out visitors don't fire a refresh
 * request (and a 401) on every page load. The real check is always the httpOnly cookie on the API.
 */
const HINT = 'milki_session_hint';
const hint = {
  get: () => {
    try {
      return localStorage.getItem(HINT) === '1';
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(HINT, '1');
      else localStorage.removeItem(HINT);
    } catch {
      /* storage unavailable (private mode) — refresh simply runs every time */
    }
  },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);

  // Restore the session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    let alive = true;
    if (!hint.get()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser storage on mount
      setStatus('anonymous');
      return;
    }
    void refreshSession().then((s) => {
      if (!alive) return;
      hint.set(Boolean(s));
      setUser(s?.user ?? null);
      setStatus(s ? 'authenticated' : 'anonymous');
    });
    return () => {
      alive = false;
    };
  }, []);

  const startLogin = useCallback((identifier: string, password: string) => send<OtpChallenge>('post', '/auth/login', { identifier, password }), []);

  const completeLogin = useCallback(async (challengeId: string, code: string) => {
    const s = await send<Session>('post', '/auth/otp/verify', { challengeId, code });
    setAccessToken(s.accessToken);
    hint.set(true);
    setUser(s.user);
    setStatus('authenticated');
    return s.user;
  }, []);

  const resendCode = useCallback((challengeId: string) => send<OtpChallenge>('post', '/auth/otp/resend', { challengeId }), []);

  const logout = useCallback(async () => {
    await http.post('/auth/logout', {}).catch(() => undefined);
    hint.set(false);
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const hasRole = useCallback((...roles: Role[]) => (user ? roles.includes(user.role) : false), [user]);

  const value = useMemo(
    () => ({ status, user, startLogin, completeLogin, resendCode, logout, hasRole }),
    [status, user, startLogin, completeLogin, resendCode, logout, hasRole],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
