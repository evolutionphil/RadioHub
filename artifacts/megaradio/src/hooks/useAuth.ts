import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
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

  const { playAtLogin } = useGlobalPlayer();
  const hasTriggeredPlayAtLogin = useRef(false);

  const user = (data as any)?.user as User | null;
  const isAuthenticated = (data as any)?.authenticated === true;

  // Play at Login Integration - Trigger when user first authenticates
  useEffect(() => {
    if (isAuthenticated && user && !hasTriggeredPlayAtLogin.current && !isLoading) {
      hasTriggeredPlayAtLogin.current = true;

      // Trigger play at login with user preferences
      if (user.playAtLogin && user.playAtLogin !== 'disabled') {
        // Triggering play at login
        playAtLogin(user).catch((error: Error) => {
          // Play at login failed (autoplay blocked)
        });
      }
    }
  }, [isAuthenticated, user, playAtLogin, isLoading]);

  return {
    user,
    isAuthenticated,
    isLoading,
    error
  };
}
