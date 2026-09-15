import { useQuery } from "@tanstack/react-query";
import { authQueryOptions } from '@/lib/auth-query';

export interface User {
  _id: string;
  fullName?: string;
  username?: string;
  email: string;
  emailVerified: boolean;
  role: string;
  status: string;
  avatar?: string;
  location?: string;
  followersCount?: number;
  followingCount?: number;
  favoriteStationsCount?: number;
  totalListeningTime?: number;
  lastLoginAt?: Date;
  createdAt: Date;
  // Play at login preferences
  playAtLogin?: 'last-played' | 'favorite' | 'random' | 'disabled';
  autoplay?: boolean;
  preferences?: {
    language?: string;
    autoplay?: boolean;
    playAtLogin?: 'LAST_PLAYED' | 'RANDOM' | 'FAVORITE';
  };
  // Notification preferences
  notificationSettings?: {
    favorites: boolean;
    nowPlaying: boolean;
    newStations: boolean;
    recommendations: boolean;
  };
}

export function useAuth() {
  const { data = {}, isLoading: queryLoading, error } = useQuery(authQueryOptions);

  // While the OAuth token exchange is in flight, initOAuthTokenExchange
  // seeds {_pendingTokenExchange:true}. Treat that as "still loading" so callers
  // (ProtectedRoute, header, etc.) don't briefly render a logged-out UI.
  const isLoading = queryLoading || (data as any)?._pendingTokenExchange === true;

  const user = (data as any)?.user as User | null;
  const isAuthenticated = (data as any)?.authenticated === true;

  return {
    user,
    isAuthenticated,
    isLoading,
    error
  };
}
