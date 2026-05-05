import { useParams, useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Share2, UserPlus, UserMinus, Music, Clock, Heart, Users, Copy, Mail, MessageCircle, Camera } from "lucide-react";
import { useState, useEffect } from "react";
import StationCard from "@/components/ui/station-card";
import UserAvatar from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import NotFound from "@/pages/not-found";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useTranslation } from "@/hooks/useTranslation";
import AuthModal from "@/components/auth/auth-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UserProfile {
  _id: string;
  email: string;
  fullName?: string;
  name?: string;
  displayName?: string;
  avatar?: string;
  isPublic?: boolean;
  isPublicProfile?: boolean;
  favoriteStations?: any[];
  recentlyPlayedStations?: any[];
  createdAt: string;
  followersCount?: number;
  slug?: string;
  bio?: string;
  isFollowing?: boolean;
  listeningStats?: {
    uniqueStationsListened?: number;
    totalListeningTime?: number;
  };
}

interface Station {
  _id: string;
  name: string;
  url: string;
  country: string;
  genre: string;
  tags: string[];
  votes: number;
  clickCount: number;
  codec: string;
  bitrate: number;
  favicon?: string;
  homepage?: string;
  language: string;
  slug: string;
}

export default function UserProfile() {
  const params = useParams<{ idOrSlug: string }>();
  const [location, setLocation] = useLocation();
  const { cleanPath, navigateWithLanguage } = useSeoRouting();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<'follow' | 'unfollow' | null>(null);
  // Removed activeTab state since we only show favorites now

  // CRITICAL FIX: Extract user ID from cleanPath (reverse-translated English path)
  // This ensures translated URLs like /al/përdoruesit/cun work correctly
  const extractedFromLocation = location.split('/users/')[1]?.split('?')[0]?.split('#')[0];
  const extractedFromCleanPath = cleanPath.startsWith('/users/') ? cleanPath.split('/users/')[1]?.split('?')[0]?.split('#')[0] : null;
  const userIdOrSlug = extractedFromLocation || extractedFromCleanPath || params.idOrSlug;

  // Auto-scroll to top when entering the page
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [userIdOrSlug]);

  if (!userIdOrSlug) {
    return <NotFound />;
  }

  // Check if this is a MongoDB ID (24 hex characters)
  const isMongoId = /^[0-9a-fA-F]{24}$/.test(userIdOrSlug);

  // Fetch current user for authentication state
  const { data: currentUser } = useQuery({
    queryKey: ["/api/auth/me"],
  });

  // Single combined request: profile + favorites + recently-played in ONE round trip.
  // No more waterfall where favorites/recently-played were blocked until profile loaded.
  const { data: fullProfileData, isLoading: isLoadingProfile, error: profileError } = useQuery<{
    profile: UserProfile;
    favorites: Station[];
    recentlyPlayed: Station[];
  }>({
    queryKey: [`/api/user-engagement/profile/${userIdOrSlug}/full`],
    enabled: !!userIdOrSlug,
    retry: false,
    staleTime: 60000,
  });

  const userProfile = fullProfileData?.profile;
  const favoriteStations = fullProfileData?.favorites;
  const recentlyPlayed = fullProfileData?.recentlyPlayed;
  const isLoadingFavorites = isLoadingProfile;
  const isLoadingRecentlyPlayed = isLoadingProfile;

  // CRITICAL FIX: Redirect from MongoDB ID to slug URL for translated routes
  // Use navigateWithLanguage to properly handle translated URLs
  useEffect(() => {
    if (isMongoId && userProfile?.slug && userProfile.slug !== userIdOrSlug) {
      // Only redirect if the slug is not the MongoDB ID itself (real slug exists)
      if (userProfile.slug.length < 24 || !/^[0-9a-fA-F]{24}$/.test(userProfile.slug)) {
        // Navigate to slug URL using the routing system that handles translations
        const newPath = `/users/${userProfile.slug}`;
        navigateWithLanguage(newPath);
      }
    }
  }, [userProfile, userIdOrSlug, isMongoId, navigateWithLanguage]);

  const recentlyPlayedStations: Station[] = recentlyPlayed || [];

  // Check authentication and permissions
  const isAuthenticated = (currentUser as any)?.authenticated;
  const isOwnProfile = (currentUser as any)?.user?._id === userIdOrSlug;
  const favoriteStationsList = favoriteStations || [];

  // Following functionality
  const followMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/user-engagement/follow/${userIdOrSlug}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: [`/api/user-engagement/profile/${userIdOrSlug}/full`] });
      queryClient.refetchQueries({ queryKey: [`/api/user-engagement/profile/${userIdOrSlug}/full`] });
      toast({ title: "Success", description: "User followed successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to follow user", variant: "destructive" });
    },
  });

  const unfollowMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/user-engagement/unfollow/${userIdOrSlug}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: [`/api/user-engagement/profile/${userIdOrSlug}/full`] });
      queryClient.refetchQueries({ queryKey: [`/api/user-engagement/profile/${userIdOrSlug}/full`] });
      toast({ title: "Success", description: "User unfollowed successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to unfollow user", variant: "destructive" });
    },
  });

  const handleFollow = () => {
    if (!isAuthenticated) {
      setPendingAction('follow');
      setShowAuthModal(true);
      return;
    }
    followMutation.mutate();
  };
  
  const handleUnfollow = () => {
    if (!isAuthenticated) {
      setPendingAction('unfollow');
      setShowAuthModal(true);
      return;
    }
    unfollowMutation.mutate();
  };

  const shareUrl = window.location.href;
  const shareTitle = `Check out ${userProfile?.displayName || 'this user'}'s profile on Radio Station Platform`;
  const shareText = `Discover amazing radio stations and music preferences from ${userProfile?.displayName || 'this user'}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: "Success", description: "Profile link copied to clipboard" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to copy link", variant: "destructive" });
    }
  };

  const handleWhatsAppShare = () => {
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
    window.open(whatsappUrl, '_blank');
  };

  const handleFacebookShare = () => {
    const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    window.open(facebookUrl, '_blank');
  };

  const handleTwitterShare = () => {
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(twitterUrl, '_blank');
  };

  const handleLinkedInShare = () => {
    const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
    window.open(linkedinUrl, '_blank');
  };

  const handleEmailShare = () => {
    const emailUrl = `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(`${shareText}\n\n${shareUrl}`)}`;
    window.location.href = emailUrl;
  };

  const handleTelegramShare = () => {
    const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
    window.open(telegramUrl, '_blank');
  };

  const handleNativeShare = () => {
    if (navigator.share) {
      navigator.share({
        title: shareTitle,
        text: shareText,
        url: shareUrl,
      }).catch(() => {
        // Fallback to copy link if native sharing fails
        handleCopyLink();
      });
    } else {
      handleCopyLink();
    }
  };

  // Check if user is following this profile
  const isFollowing = userProfile?.isFollowing || false;

  if (isLoadingProfile) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] text-white">
        <div className="container mx-auto px-4 py-8">
          <div className="animate-pulse space-y-6">
            <div className="flex items-center space-x-4">
              <div className="w-20 h-20 bg-gray-700 rounded-full"></div>
              <div className="space-y-2">
                <div className="h-6 bg-gray-700 rounded w-48"></div>
                <div className="h-4 bg-gray-700 rounded w-32"></div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-32 bg-gray-800 rounded-lg"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (profileError || !userProfile) {
    return <NotFound />;
  }

  // Extract proper display name - use displayName from API response
  const displayName = userProfile.displayName || userProfile.fullName || userProfile.name || userProfile.email?.split('@')[0] || 'User';
  const followersCount = userProfile.followersCount || 0;

  return (
    <div className="min-h-screen bg-[#0E0E0E] text-white">
      {/* EXACT Original Mega Radio Profile Layout */}
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        
        {/* Desktop Profile Header - LARGE HEADER */}
        <div className="hidden md:block mb-8">
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-xl p-8">
            <div className="flex items-center gap-6">
              <div className="relative h-24 w-24 lg:h-32 lg:w-32 flex-shrink-0">
                <UserAvatar 
                  avatar={userProfile.avatar}
                  name={displayName}
                  size="lg"
                  className="h-full w-full border-4 border-white/20"
                />
                <div className="absolute -bottom-1 -right-1 h-6 w-6 lg:h-8 lg:w-8 rounded-full bg-green-500 border-4 border-white"></div>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-3xl lg:text-4xl font-bold text-white mb-2">{displayName}</h1>
                <p className="text-blue-100 text-lg mb-4">{userProfile.bio}</p>
                <div className="flex items-center gap-6 text-blue-100">
                  <div className="flex items-center gap-2">
                    <Music className="w-5 h-5" />
                    <span>{t('profile_radio_enthusiast', 'Radio Enthusiast')}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {!isOwnProfile && (
                  <>
                    {isFollowing ? (
                      <Button 
                        onClick={handleUnfollow}
                        disabled={unfollowMutation.isPending}
                        className="bg-gray-600 hover:bg-gray-700 text-white px-6 py-2 flex items-center gap-2"
                      >
                        <UserMinus className="w-4 h-4" />
                        {t('profile_following', 'Following')}
                      </Button>
                    ) : (
                      <Button 
                        onClick={handleFollow}
                        disabled={followMutation.isPending}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 flex items-center gap-2"
                      >
                        <UserPlus className="w-4 h-4" />
                        {t('profile_follow', 'Follow')}
                      </Button>
                    )}
                  </>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="outline"
                      className="border-white/30 text-white hover:bg-white/10 px-6 py-2 flex items-center gap-2"
                    >
                      <Share2 className="w-4 h-4" />
                      {t('profile_share', 'Share')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 bg-[#1A1A1A] border-[#2F2F2F] text-white">
                    <DropdownMenuItem 
                      className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                      onClick={handleWhatsAppShare}
                    >
                      <MessageCircle className="w-4 h-4 text-green-500" />
                      {t('share_whatsapp', 'WhatsApp')}
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                      onClick={handleFacebookShare}
                    >
                      <div className="w-4 h-4 rounded bg-blue-600 flex items-center justify-center text-white text-xs font-bold">f</div>
                      {t('share_facebook', 'Facebook')}
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                      onClick={handleTwitterShare}
                    >
                      <div className="w-4 h-4 rounded bg-sky-500 flex items-center justify-center text-white text-xs font-bold">X</div>
                      {t('share_twitter', 'Twitter / X')}
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                      onClick={handleLinkedInShare}
                    >
                      <div className="w-4 h-4 rounded bg-blue-700 flex items-center justify-center text-white text-xs font-bold">in</div>
                      {t('share_linkedin', 'LinkedIn')}
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                      onClick={handleTelegramShare}
                    >
                      <div className="w-4 h-4 rounded bg-blue-500 flex items-center justify-center text-white text-xs font-bold">T</div>
                      {t('share_telegram', 'Telegram')}
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                      onClick={handleEmailShare}
                    >
                      <Mail className="w-4 h-4 text-gray-400" />
                      {t('share_email', 'Email')}
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                      onClick={handleCopyLink}
                    >
                      <Copy className="w-4 h-4 text-gray-400" />
                      {t('share_copy_link', 'Copy Link')}
                    </DropdownMenuItem>
                    {'share' in navigator && (
                      <DropdownMenuItem 
                        className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                        onClick={handleNativeShare}
                      >
                        <Share2 className="w-4 h-4 text-gray-400" />
                        {t('share_more_options', 'More Options')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Profile Header */}
        <div className="md:hidden mb-6">
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-xl p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="relative h-16 w-16 flex-shrink-0">
                <UserAvatar 
                  avatar={userProfile.avatar}
                  name={displayName}
                  size="lg"
                  className="h-full w-full border-3 border-white/20"
                />
                <div className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-green-500 border-3 border-white"></div>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-white mb-1">{displayName}</h1>
                <p className="text-blue-100 text-sm">{userProfile.bio}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {!isOwnProfile && (
                <>
                  {isFollowing ? (
                    <Button 
                      onClick={handleUnfollow}
                      disabled={unfollowMutation.isPending}
                      size="sm"
                      className="bg-gray-600 hover:bg-gray-700 text-white flex-1"
                    >
                      <UserMinus className="w-4 h-4 mr-1" />
                      {t('profile_following', 'Following')}
                    </Button>
                  ) : (
                    <Button 
                      onClick={handleFollow}
                      disabled={followMutation.isPending}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white flex-1"
                    >
                      <UserPlus className="w-4 h-4 mr-1" />
                      {t('profile_follow', 'Follow')}
                    </Button>
                  )}
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="outline"
                    size="sm"
                    className="border-white/30 text-white hover:bg-white/10"
                  >
                    <Share2 className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-[#1A1A1A] border-[#2F2F2F] text-white">
                  <DropdownMenuItem 
                    className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                    onClick={handleWhatsAppShare}
                  >
                    <MessageCircle className="w-4 h-4 text-green-500" />
                    {t('share_whatsapp', 'WhatsApp')}
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                    onClick={handleFacebookShare}
                  >
                    <div className="w-4 h-4 rounded bg-blue-600 flex items-center justify-center text-white text-xs font-bold">f</div>
                    {t('share_facebook', 'Facebook')}
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                    onClick={handleTwitterShare}
                  >
                    <div className="w-4 h-4 rounded bg-sky-500 flex items-center justify-center text-white text-xs font-bold">X</div>
                    {t('share_twitter', 'Twitter / X')}
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                    onClick={handleLinkedInShare}
                  >
                    <div className="w-4 h-4 rounded bg-blue-700 flex items-center justify-center text-white text-xs font-bold">in</div>
                    {t('share_linkedin', 'LinkedIn')}
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                    onClick={handleTelegramShare}
                  >
                    <div className="w-4 h-4 rounded bg-blue-500 flex items-center justify-center text-white text-xs font-bold">T</div>
                    {t('share_telegram', 'Telegram')}
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                    onClick={handleEmailShare}
                  >
                    <Mail className="w-4 h-4 text-gray-400" />
                    {t('share_email', 'Email')}
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                    onClick={handleCopyLink}
                  >
                    <Copy className="w-4 h-4 text-gray-400" />
                    {t('share_copy_link', 'Copy Link')}
                  </DropdownMenuItem>
                  {'share' in navigator && (
                    <DropdownMenuItem 
                      className="hover:bg-[#2F2F2F] cursor-pointer flex items-center gap-3"
                      onClick={handleNativeShare}
                    >
                      <Share2 className="w-4 h-4 text-gray-400" />
                      {t('share_more_options', 'More Options')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Stats Cards Row - USING REAL USER DATA */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#1A1A1A] rounded-xl p-4 border border-[#2F2F2F]">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600/20 rounded-lg">
                <Users className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{userProfile.followersCount || '0'}</div>
                <div className="text-xs text-gray-400">{t('profile_total_followers', 'Total Followers')}</div>
              </div>
            </div>
          </div>
          
          <div className="bg-[#1A1A1A] rounded-xl p-4 border border-[#2F2F2F]">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-600/20 rounded-lg">
                <Music className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{userProfile.listeningStats?.uniqueStationsListened || favoriteStationsList.length}</div>
                <div className="text-xs text-gray-400">{t('profile_favorite_stations', 'Favorite Stations')}</div>
              </div>
            </div>
          </div>
          
          <div className="bg-[#1A1A1A] rounded-xl p-4 border border-[#2F2F2F]">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-600/20 rounded-lg">
                <Heart className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{favoriteStationsList.length}</div>
                <div className="text-xs text-gray-400">{t('profile_favorite_stations', 'Favorite Stations')}</div>
              </div>
            </div>
          </div>
          
          <div className="bg-[#1A1A1A] rounded-xl p-4 border border-[#2F2F2F]">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-600/20 rounded-lg">
                <svg className="w-5 h-5 text-orange-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </div>
              <div>
                <div className="text-lg font-bold text-white">
                  {new Date(userProfile.createdAt).toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </div>
                <div className="text-xs text-gray-400">{t('profile_member_since', 'Member Since')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation - SIMPLIFIED TO FAVORITES ONLY */}
        <div className="border-b border-[#2F2F2F] mb-6">
          <div className="flex gap-8">
            <button 
              className="pb-4 px-1 border-b-2 border-blue-500 text-blue-400 font-bold text-lg transition-colors flex items-center gap-2"
            >
              <Heart className="w-5 h-5" fill="currentColor" />
              {t('profile_favorites', 'Favorites')}
            </button>
          </div>
        </div>

        {/* Favorites Content Only */}
        <div className="min-h-[400px]">
          <div>
            {isLoadingFavorites ? (
              <div className="text-center py-12">
                <div className="text-gray-400">{t('profile_loading_favorites') || 'Loading favorite stations...'}</div>
              </div>
            ) : favoriteStationsList.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {favoriteStationsList.map((station) => (
                  <StationCard
                    key={station._id}
                    station={station}
                    showVotes={true}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Heart className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <div className="text-gray-400 text-lg mb-2">{t('profile_no_favorites', 'No favorite stations yet')}</div>
                <p className="text-gray-500">{t('profile_start_exploring', 'Start exploring and add stations to favorites!')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Auth Modal */}
      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => {
          setShowAuthModal(false);
          setPendingAction(null);
        }}
        onSuccess={() => {
          // After successful login, execute pending action
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          setShowAuthModal(false);
          
          // Execute the pending action
          if (pendingAction === 'follow') {
            followMutation.mutate();
          } else if (pendingAction === 'unfollow') {
            unfollowMutation.mutate();
          }
          setPendingAction(null);
        }}
      />
    </div>
  );
}