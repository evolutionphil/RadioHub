import { createContext, useContext, useState, ReactNode, useEffect } from "react";
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authToken = params.get('auth_token');

    console.log('[AUTH] 🚀 useAuth mount — current URL:', window.location.href);
    console.log('[AUTH] 🔑 auth_token in URL:', authToken ? `${authToken.slice(0, 12)}…(${authToken.length} chars)` : 'NONE');
    console.log('[AUTH] 🍪 document.cookie:', document.cookie || '(empty)');

    if (authToken) {
      params.delete('auth_token');
      const cleanUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
      console.log('[AUTH] 🧹 Cleaning URL →', cleanUrl);
      window.history.replaceState({}, '', cleanUrl);

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
          console.log('[AUTH] 🍪 document.cookie AFTER token-session:', document.cookie || '(empty — COOKIE BLOCKED!)');

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
    queryFn: async () => {
      console.log('[AUTH] 📤 GET /api/auth/me — credentials:include, cookie:', document.cookie || '(empty)');
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
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