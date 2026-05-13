import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";

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

// Read once at module load: if the page was opened with `?auth_token=...`
// (the OAuth callback redirect from the API server), the AuthProvider in
// useAuth.tsx is going to POST /api/auth/token-session and hydrate the
// `/api/auth/me` query cache directly. We MUST NOT race-fire our own
// /me request from the legacy hook before the cookie is set, otherwise
// a late response can clobber the hydrated user object. Once the URL has
// been cleaned by the AuthProvider, this flag stays true for the lifetime
// of this page load — but every consumer of `useAuth()` will still see
// the user as soon as setQueryData runs, because useQuery observers are
// notified regardless of `enabled`.
const hadAuthTokenOnLoad: boolean =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('auth_token');

export function useAuth() {
  const { data = {}, isLoading: queryLoading, error } = useQuery({
    queryKey: ["/api/auth/me"],
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    // Skip the auto-fetch while the AuthProvider is exchanging an OAuth
    // token. setQueryData from the AuthProvider will still wake observers.
    enabled: !hadAuthTokenOnLoad,
  });

  // While the OAuth token exchange is in flight, the AuthProvider seeds
  // {_pendingTokenExchange:true}. Treat that as "still loading" so callers
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