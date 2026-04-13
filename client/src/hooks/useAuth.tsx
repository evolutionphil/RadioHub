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
    
    if (authToken) {
      params.delete('auth_token');
      const cleanUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
      window.history.replaceState({}, '', cleanUrl);
      
      fetch('/api/auth/token-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: authToken }),
        credentials: 'include',
      })
        .then((res) => {
          if (res.ok) {
            queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
          }
        })
        .catch(() => {})
        .finally(() => setTokenProcessed(true));
    } else {
      setTokenProcessed(true);
    }
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 401) {
          return null;
        }
        throw new Error('Failed to fetch user');
      }
      return response.json();
    },
    retry: false,
    enabled: tokenProcessed,
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