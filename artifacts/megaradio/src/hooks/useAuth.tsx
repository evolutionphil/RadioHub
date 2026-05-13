import { createContext, useContext, useState, ReactNode, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { faIdentify, faReset } from '../lib/flowalive';

interface User {
  _id: string;
  username: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  avatar?: string;
  preferences: {
    theme: string;
    language: string;
    autoplay: boolean;
    volume: number;
    notificationsEnabled: boolean;
  };
  permissions: {
    canManageStations: boolean;
    canManageUsers: boolean;
    canRunSync: boolean;
    canViewAnalytics: boolean;
    canExportData: boolean;
  };
  emailVerified: boolean;
  favoriteStations: string[];
  recentlyPlayedStations: string[];
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [tokenProcessed, setTokenProcessed] = useState(false);
  const tokenExchangeStarted = useRef(false);

  useEffect(() => {
    if (tokenExchangeStarted.current) {
      console.log('[AUTH] ⏭️ token exchange already started in this mount — skipping duplicate effect run');
      return;
    }
    tokenExchangeStarted.current = true;

    const params = new URLSearchParams(window.location.search);
    const authToken = params.get('auth_token');

    console.log('[AUTH] 🚀 useAuth mount — current URL:', window.location.href);
    console.log('[AUTH] 🔑 auth_token in URL:', authToken ? `${authToken.slice(0, 16)}…(${authToken.length} chars)` : 'NONE');
    // NOTE: connect.sid is HttpOnly so it WILL NOT appear in document.cookie.
    // Only non-HttpOnly cookies (analytics, language preference, etc.) show up.
    console.log('[AUTH] 🍪 document.cookie (HttpOnly cookies are NOT shown here):', document.cookie || '(empty)');

    if (authToken) {
      params.delete('auth_token');
      const cleanUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
      console.log('[AUTH] 🧹 Cleaning URL →', cleanUrl);
      window.history.replaceState({}, '', cleanUrl);

      // CRITICAL race-fix: there are 16+ components that fire useQuery(['/api/auth/me'])
      // synchronously on mount via the legacy `useAuth.ts` hook. Without a cookie they
      // get back {user:null, authenticated:false} — and if their fetch resolves AFTER
      // our setQueryData below, it CLOBBERS the freshly-written user object. To stop
      // that, we (1) immediately seed a placeholder so eager observers see "pending"
      // instead of "logged out", and (2) cancel any in-flight /me query right before
      // we write the real user — React Query then drops the late response.
      console.log('[AUTH] 🛡️ Cancelling in-flight /api/auth/me to prevent clobber, seeding pending state');
      queryClient.cancelQueries({ queryKey: ['/api/auth/me'] }).catch(() => {});
      queryClient.setQueryData(['/api/auth/me'], { user: null, authenticated: false, _pendingTokenExchange: true });

      console.log('[AUTH] 📤 POST /api/auth/token-session — sending token, credentials:include');
      const t0 = performance.now();
      fetch('/api/auth/token-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: authToken }),
        credentials: 'include',
      })
        .then(async (res) => {
          const elapsed = Math.round(performance.now() - t0);
          console.log(`[AUTH] 📥 token-session response — status:${res.status} ok:${res.ok} elapsed:${elapsed}ms`);
          // connect.sid is HttpOnly so it never appears here even when set.
          console.log('[AUTH] 🍪 non-HttpOnly cookies after POST:', document.cookie || '(empty)');

          if (!res.ok) {
            const errBody = await res.text().catch(() => '(unreadable body)');
            console.error('[AUTH] ❌ token-session FAILED:', res.status, errBody);
            return;
          }

          let body: any = null;
          try {
            body = await res.json();
            console.log('[AUTH] ✅ token-session body:', body);
          } catch (e) {
            console.error('[AUTH] ❌ token-session JSON parse failed:', e);
          }

          // DEFENSIVE: if server returned the user object, write it straight into
          // the query cache so we don't depend on the session cookie persisting
          // in the browser (some browsers / strict cookie policies drop SameSite=None).
          if (body?.user) {
            console.log('[AUTH] 💾 Writing user directly to cache (cookie-independent path)');
            // Cancel again right before write — covers any /me request that
            // started during the token-session round-trip and would otherwise
            // race-overwrite the user with a {user:null} response.
            await queryClient.cancelQueries({ queryKey: ['/api/auth/me'] }).catch(() => {});
            queryClient.setQueryData(['/api/auth/me'], { user: body.user, authenticated: true });
          } else {
            console.log('[AUTH] 🔄 No user in response — invalidating /api/auth/me to refetch');
            queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
          }
        })
        .catch((err) => {
          console.error('[AUTH] 💥 token-session fetch threw:', err);
        })
        .finally(() => {
          console.log('[AUTH] 🏁 token-session flow complete — enabling /me query');
          setTokenProcessed(true);
        });
    } else {
      console.log('[AUTH] ⏭️ No auth_token, enabling /me query directly');
      setTokenProcessed(true);
    }
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['/api/auth/me'],
    queryFn: async ({ signal }) => {
      console.log('[AUTH] 📤 GET /api/auth/me — credentials:include, cookie:', document.cookie || '(empty)');
      // Forward AbortSignal so queryClient.cancelQueries(...) can abort us
      // if a token-session exchange starts mid-flight (race-fix).
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
        signal,
      });
      console.log(`[AUTH] 📥 /me response — status:${response.status} ok:${response.ok}`);
      if (!response.ok) {
        if (response.status === 401) {
          console.warn('[AUTH] ⚠️ /me returned 401 — not authenticated');
          return null;
        }
        throw new Error('Failed to fetch user');
      }
      const json = await response.json();
      console.log('[AUTH] ✅ /me payload — authenticated:', json?.authenticated, 'user:', json?.user?.email || '(null)');
      return json;
    },
    retry: false,
    enabled: tokenProcessed,
    // Prevent the immediate refetch from clobbering the user object we wrote
    // via setQueryData in the token-session flow. setQueryData refreshes
    // dataUpdatedAt; with a positive staleTime React Query treats the cache as
    // fresh and skips the mount refetch.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // CRITICAL FIX: API returns { user: {...} }, need to extract the user object
  const user = (data as any)?.user as User | null;

  useEffect(() => {
    if (!isLoading) {
      if (user) {
        faIdentify(user._id, {
          username: user.username,
          email: user.email,
          name: user.fullName,
          role: user.role,
          plan: user.role === 'admin' ? 'admin' : 'free',
        });
      } else {
        faReset();
      }
    }
  }, [user?._id, isLoading]);

  const contextValue: AuthContextType = {
    user: user || null,
    isAuthenticated: !!user,
    isLoading,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}