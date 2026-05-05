import { useState, useEffect, memo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useNotificationService } from "@/services/NotificationService";
import { apiRequest } from "@/lib/queryClient";
import AuthModal from "@/components/auth/auth-modal";
import { useTranslation } from "@/hooks/useTranslation";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { trackStationFavorite } from "@/lib/analytics";
import fav60Icon from "@assets/fav60.png";

interface FavoriteButtonProps {
  stationId: string;
  className?: string;
  customIcon?: string; // Optional custom icon from Figma design
  size?: 'default' | 'mobile';
  iconSizeOverride?: string; // Override icon size for mini player
  borderWidth?: string; // Override border width
}

const FavoriteButton = memo(function FavoriteButton({ stationId, className = "", customIcon, size = 'default', iconSizeOverride, borderWidth = '1.5px' }: FavoriteButtonProps) {
  // Figma: mobile icon 18.74x18.74, default icon 24x24
  const iconSize = iconSizeOverride || (size === 'mobile' ? '18.74px' : '24px');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingFavorite, setPendingFavorite] = useState<string | null>(null);
  const { toast } = useToast();
  const notificationService = useNotificationService();
  const { sendTestNotification } = usePushNotifications();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  // Check if user is authenticated and get favorites list
  const { data: userResponse } = useQuery({
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

  const user = userResponse?.authenticated ? userResponse.user : null;

  // Get user's favorite stations list
  const { data: favoritesData } = useQuery({
    queryKey: ['/api/user/favorites'],
    queryFn: async () => {
      const response = await fetch('/api/user/favorites', {
        credentials: 'include',
      });
      if (!response.ok) {
        return [];
      }
      const result = await response.json();
      return result;
    },
    enabled: !!user && !!userResponse?.authenticated,
    staleTime: 10 * 60 * 1000, // 10 minutes - prevents repeated refetches
    refetchOnMount: false, // Use cache, don't refetch on every mount
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });

  // Get station information for rich notifications - only when needed for notifications
  const { data: stationData } = useQuery({
    queryKey: ['/api/stations', stationId],
    queryFn: async () => {
      const response = await fetch(`/api/stations/${stationId}`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: false, // Disable automatic fetching - only fetch when needed for notifications
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Check if current station is in favorites - API returns array of stations directly
  const favoriteStationIds = favoritesData?.map((station: any) => station._id) || [];
  const isFavorited = favoriteStationIds.includes(stationId);

  // Add to favorites mutation
  const addToFavoritesMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/user/favorites', { body: { stationId } });
    },
    onSuccess: (data: any) => {
      if (!data.alreadyFavorited) {
        // Show toast for immediate feedback
        toast({
          title: t('favorites_added_to_favorites') || "Added to Favorites",
          description: t('favorites_added_to_favorites_description') || "Station has been added to your favorites!",
        });

        // Show rich notification with station details
        const stationName = stationData?.name || "Unknown Station";
        const stationCountry = stationData?.country || "";
        
        notificationService.addedToFavorites(stationName, stationCountry);
        
        // Track analytics event
        trackStationFavorite(stationName, stationCountry, 'add');
        
        // Send push notification about favorite addition if user has subscribed
        const sendFavoriteNotification = async () => {
          try {
            const response = await fetch('/api/push/favorite-added', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                stationId: stationData?._id,
                stationName: stationName,
                country: stationCountry,
                genre: stationData?.genre,
                favicon: stationData?.favicon
              })
            });
            
            if (response.ok) {
              // Push notification sent for favorite addition
            }
          } catch (error) {
            // Push notification not sent (user may not be subscribed)
          }
        };
        
        sendFavoriteNotification();
      }
      // Invalidate ALL favorites queries (with any parameters)
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === '/api/user/favorites'
      });
    },
    onError: (error: any) => {
      // Don't show error if it's just already favorited
      if (!error.message?.includes('already')) {
        toast({
          title: t('general_error') || "Error",
          description: t('favorites_failed_to_add') || "Failed to add station to favorites",
          variant: "destructive",
        });
      }
    },
  });

  // Remove from favorites mutation
  const removeFromFavoritesMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('DELETE', `/api/user/favorites/${stationId}`);
    },
    onSuccess: () => {
      toast({
        title: t('favorites_removed_from_favorites') || "Removed from Favorites",
        description: t('favorites_removed_from_favorites_description') || "Station has been removed from your favorites",
      });
      
      // Show rich notification for favorite removal
      const stationName = stationData?.name || "Unknown Station";
      notificationService.removedFromFavorites(stationName);
      
      // Track analytics event
      trackStationFavorite(stationName, stationData?.country || "", 'remove');
      
      // Cache will be updated automatically by invalidation
      // Invalidate ALL favorites queries (with any parameters)
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === '/api/user/favorites'
      });
    },
    onError: () => {
      toast({
        title: t('general_error') || "Error",
        description: t('favorites_failed_to_remove') || "Failed to remove station from favorites",
        variant: "destructive",
      });
    },
  });

  // Auto-add to favorites after successful login
  useEffect(() => {
    if (user && pendingFavorite === stationId && !addToFavoritesMutation.isPending && !isFavorited) {
      // User just logged in and this station was pending to be favorited
      setPendingFavorite(null);
      // Add to favorites immediately, but only if not already favorited and not currently adding
      addToFavoritesMutation.mutate();
    }
  }, [user, pendingFavorite, stationId, addToFavoritesMutation, isFavorited]);

  // Close auth modal when user is authenticated
  useEffect(() => {
    if (user && showAuthModal) {
      setShowAuthModal(false);
    }
  }, [user, showAuthModal]);

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Prevent multiple clicks while loading
    if (isLoading) {
      return;
    }

    // Check if user is authenticated
    if (!user) {
      // Store which station should be favorited after login
      setPendingFavorite(stationId);
      setShowAuthModal(true);
      return;
    }

    // Toggle favorite status
    if (isFavorited) {
      removeFromFavoritesMutation.mutate();
    } else {
      addToFavoritesMutation.mutate();
    }
  };

  const isLoading = addToFavoritesMutation.isPending || removeFromFavoritesMutation.isPending;

  return (
    <>
      <button
        onClick={handleFavoriteClick}
        disabled={isLoading}
        className={`relative flex items-center justify-center rounded-full border-black hover:border-[#FF4199] bg-black transition-colors ${className}`}
        style={{ borderWidth, borderStyle: 'solid' }}
        title={isFavorited ? (t('favorites_remove_from_favorites') || "Remove from favorites") : (t('favorites_add_to_favorites') || "Add to favorites")}
      >
        {isLoading ? (
          <div className="w-5 h-5 border-2 border-gray-400 border-t-[#FF4199] rounded-full animate-spin" />
        ) : (
          <img 
            src={customIcon || fav60Icon} 
            alt="Favorite"
            className={`transition-all ${!iconSizeOverride && size === 'default' && customIcon ? 'w-full h-full' : !iconSizeOverride && size === 'default' ? 'w-5 h-5 sm:w-6 sm:h-6' : ''}`}
            style={{
              ...(iconSizeOverride ? { width: iconSizeOverride, height: iconSizeOverride } : size === 'mobile' ? { width: '18.74px', height: '18.74px' } : {}),
              filter: isFavorited ? 'brightness(0) saturate(100%) invert(47%) sepia(95%) saturate(2054%) hue-rotate(310deg) brightness(101%) contrast(101%)' : 'none',
              opacity: isFavorited ? 1 : 0.7
            }}
          />
        )}
      </button>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => {
          setShowAuthModal(false);
          setPendingFavorite(null); // Clear pending if user cancels
        }}
        defaultTab="login"
        onSuccess={() => {
          // Don't close modal here - the auth modal will handle it
          // The useEffect will trigger the favorite addition after login
        }}
      />
    </>
  );
});

export default FavoriteButton;