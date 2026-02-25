import { createContext, useContext, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

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
  const { data, isLoading } = useQuery({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 401) {
          return null; // Not authenticated
        }
        throw new Error('Failed to fetch user');
      }
      return response.json();
    },
    retry: false,
  });

  // CRITICAL FIX: API returns { user: {...} }, need to extract the user object
  const user = (data as any)?.user as User | null;
  
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