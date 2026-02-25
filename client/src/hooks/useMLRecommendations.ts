import { useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { logger } from '@/lib/logger';

interface UserInteraction {
  sessionId: string;
  stationId: string;
  listenDuration: number;
  interactionType: 'play' | 'skip' | 'favorite' | 'share' | 'seek' | 'volume_change';
  deviceType?: 'mobile' | 'desktop' | 'tablet';
  location?: { country: string; region?: string };
  skipReason?: 'bad_quality' | 'wrong_genre' | 'language' | 'ads' | 'other';
}

interface RecommendationData {
  score: number;
  reasons: string[];
  confidence: number;
  type: 'content_based' | 'collaborative' | 'hybrid' | 'popularity';
}

interface StationWithRecommendation {
  _id: string;
  name: string;
  country: string;
  tags?: string;
  genre?: string;
  favicon?: string;
  localImagePath?: string;
  _recommendation?: RecommendationData;
}

interface UserProfile {
  profileStrength: number;
  preferredGenres: Array<{ genre: string; weight: number; confidence: number }>;
  preferredCountries: Array<{ country: string; weight: number; confidence: number }>;
  averageListenDuration: number;
  totalStationsListened: number;
  uniqueStationsCount: number;
  peakListeningHours: number[];
  message?: string;
}

// Generate or get session ID for anonymous user tracking
function getSessionId(): string {
  // Get or create a unique session ID for this user
  let sessionId = localStorage.getItem('ml_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('ml_session_id', sessionId);
  }
  return sessionId;
}

// Detect device type
function getDeviceType(): 'mobile' | 'desktop' | 'tablet' {
  const userAgent = navigator.userAgent.toLowerCase();
  if (/tablet|ipad|playbook|silk/.test(userAgent)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera|mini|windows\sce|palm|smartphone|iemobile/.test(userAgent)) return 'mobile';
  return 'desktop';
}

export function useMLRecommendations() {
  const queryClient = useQueryClient();
  const sessionId = getSessionId();

  // Track user interaction
  const trackInteractionMutation = useMutation({
    mutationFn: async (interaction: Omit<UserInteraction, 'sessionId'>) => {
      const response = await fetch('/api/ml/track-interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...interaction,
          sessionId,
          deviceType: getDeviceType()
        })
      });
      if (!response.ok) throw new Error('Failed to track interaction');
      return response.json();
    },
    onSuccess: () => {
      // Invalidate user profile and recommendations cache to reflect new data
      queryClient.invalidateQueries({ queryKey: ['/api/ml/user-profile', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['/api/ml/recommendations', sessionId] });
    }
  });

  // Get user profile
  const { data: userProfile, isLoading: profileLoading } = useQuery<UserProfile>({
    queryKey: ['/api/ml/user-profile', sessionId],
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1
  });

  // Get personalized recommendations for homepage
  const { data: recommendations, isLoading: recommendationsLoading } = useQuery<StationWithRecommendation[]>({
    queryKey: ['/api/ml/recommendations', sessionId],
    enabled: true, // Always enabled - backend provides starter recommendations for new users
    staleTime: 2 * 60 * 1000, // 2 minutes (reduced from 10 minutes for faster updates)
    retry: 1
  });

  // Get personalized similar stations
  const getSimilarStations = useCallback(async (stationId: string, limit = 10): Promise<StationWithRecommendation[]> => {
    try {
      const response = await fetch(`/api/stations/similar/${stationId}?sessionId=${sessionId}&limit=${limit}`);
      if (!response.ok) throw new Error('Failed to get similar stations');
      return await response.json();
    } catch (error) {
      console.error('Failed to get similar stations:', error);
      return [];
    }
  }, [sessionId]);

  // Convenience functions for tracking different interaction types
  const trackPlay = useCallback((stationId: string) => {
    trackInteractionMutation.mutate({
      stationId,
      listenDuration: 0, // Will be updated when stop is called
      interactionType: 'play'
    });
  }, [trackInteractionMutation]);

  const trackListenDuration = useCallback((stationId: string, duration: number) => {
    logger.log('💾 ML Tracking: Saving listen duration', { stationId, duration });
    trackInteractionMutation.mutate({
      stationId,
      listenDuration: duration,
      interactionType: 'play'
    });
  }, [trackInteractionMutation]);

  const trackSkip = useCallback((stationId: string, duration: number, reason?: string) => {
    trackInteractionMutation.mutate({
      stationId,
      listenDuration: duration,
      interactionType: 'skip',
      skipReason: reason as any
    });
  }, [trackInteractionMutation]);

  const trackFavorite = useCallback((stationId: string) => {
    trackInteractionMutation.mutate({
      stationId,
      listenDuration: 0,
      interactionType: 'favorite'
    });
  }, [trackInteractionMutation]);

  const trackShare = useCallback((stationId: string) => {
    trackInteractionMutation.mutate({
      stationId,
      listenDuration: 0,
      interactionType: 'share'
    });
  }, [trackInteractionMutation]);

  // Auto-track page visibility changes to calculate listen duration
  useEffect(() => {
    let startTime: number | null = null;
    let currentStationId: string | null = null;

    const handleVisibilityChange = () => {
      if (document.hidden && startTime && currentStationId) {
        // Page became hidden, track listen duration
        const duration = (Date.now() - startTime) / 1000; // Convert to seconds
        if (duration > 5) { // Only track if listened for more than 5 seconds
          trackListenDuration(currentStationId, duration);
        }
        startTime = null;
        currentStationId = null;
      } else if (!document.hidden && currentStationId) {
        // Page became visible again
        startTime = Date.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for custom events from the audio player
    const handleStationPlay = (event: CustomEvent) => {
      startTime = Date.now();
      currentStationId = event.detail.stationId;
      logger.log('🎵 ML Tracking: Station play started', event.detail.stationId);
      trackPlay(event.detail.stationId);
    };

    const handleStationStop = (event: CustomEvent) => {
      const stationId = event.detail?.stationId || currentStationId;
      const actualDuration = event.detail?.duration || 0;
      
      logger.log('⏹️ ML Tracking: Station stop', { stationId, actualDuration, currentStationId, startTime });
      
      // Use the actual duration from the audio player if provided
      if (actualDuration > 0) {
        logger.log('📊 ML Tracking: Using actual duration', actualDuration, 'seconds');
        trackListenDuration(stationId, actualDuration);
      } else if (startTime && currentStationId) {
        const duration = (Date.now() - startTime) / 1000;
        logger.log('📊 ML Tracking: Calculated duration', duration, 'seconds');
        if (duration > 5) { // Only track meaningful listen durations
          trackListenDuration(currentStationId, duration);
        }
      }
      startTime = null;
      currentStationId = null;
    };

    const handleStationSkip = (event: CustomEvent) => {
      if (startTime && currentStationId) {
        const duration = (Date.now() - startTime) / 1000;
        trackSkip(currentStationId, duration, event.detail.reason);
      }
      startTime = null;
      currentStationId = null;
    };

    // Listen for global player events
    window.addEventListener('ml:station:play', handleStationPlay as EventListener);
    window.addEventListener('ml:station:stop', handleStationStop as EventListener);
    window.addEventListener('ml:station:skip', handleStationSkip as EventListener);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('ml:station:play', handleStationPlay as EventListener);
      window.removeEventListener('ml:station:stop', handleStationStop as EventListener);
      window.removeEventListener('ml:station:skip', handleStationSkip as EventListener);
    };
  }, [trackPlay, trackListenDuration, trackSkip]);

  return {
    sessionId,
    userProfile,
    profileLoading,
    recommendations,
    recommendationsLoading,
    getSimilarStations,
    // Tracking functions
    trackPlay,
    trackListenDuration,
    trackSkip,
    trackFavorite,
    trackShare,
    // Computed properties
    hasPersonalizedData: userProfile && userProfile.profileStrength > 0.1,
    profileStrength: userProfile?.profileStrength || 0,
    topGenres: userProfile?.preferredGenres?.slice(0, 3) || [],
    topCountries: userProfile?.preferredCountries?.slice(0, 2) || [],
    isLearning: !userProfile || userProfile.profileStrength < 0.3
  };
}

// Helper hook for components that need ML-enhanced similar stations
export function useMLSimilarStations(stationId: string, enabled = true) {
  const { getSimilarStations, sessionId } = useMLRecommendations();

  return useQuery<StationWithRecommendation[]>({
    queryKey: ['/api/stations/similar', stationId, sessionId],
    queryFn: () => getSimilarStations(stationId),
    enabled: enabled && !!stationId,
    staleTime: 15 * 60 * 1000, // 15 minutes
    retry: 1
  });
}