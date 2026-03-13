import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Share2, UserPlus, UserMinus, Music, Clock, Heart } from "lucide-react";
import { useState, useEffect } from "react";
import StationCard from "@/components/ui/station-card";
import UserAvatar from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import NotFound from "@/pages/not-found";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useTranslation } from "@/hooks/useTranslation";

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
  const params = useParams<{ id: string }>();
  const { cleanPath } = useSeoRouting();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('favorites');

  // Extract user ID from cleanPath for language-aware routing
  const userId = cleanPath.startsWith('/users/') ? cleanPath.split('/users/')[1] : params.id;

  // UserProfile component rendered

  // Auto-scroll to top when entering the page
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [userId]);

  if (!userId) {
    return <NotFound />;
  }

  // Fetch current user for authentication state
  const { data: currentUser } = useQuery({
    queryKey: ["/api/auth/me"],
  });

  // Fetch user profile data using user-engagement API
  const { data: userProfile, isLoading: isLoadingProfile, error: profileError } = useQuery<UserProfile>({
    queryKey: [`/api/user-engagement/profile/${userId}`],
    enabled: !!userId
  });


  // Fetch user's favorite stations using user-engagement API
  const { data: favoriteStationsData, isLoading: isLoadingFavorites } = useQuery<{
    profile: UserProfile;
    favorites: Station[];
  }>({
    queryKey: [`/api/user-engagement/profile/${userId}/favorites`],
    enabled: !!userId && !!userProfile,
    retry: false
  });

  const favoriteStations = favoriteStationsData?.favorites || userProfile?.favoriteStations || [];

  // Fetch user's recently played stations
  const { data: recentlyPlayedData, isLoading: isLoadingRecentlyPlayed } = useQuery<Station[]>({
    queryKey: [`/api/user-engagement/profile/${userId}/recently-played`],
    enabled: !!userId && !!userProfile && activeTab === 'recently-played',
    retry: false
  });

  const recentlyPlayedStations = recentlyPlayedData || userProfile?.recentlyPlayedStations || [];
  

  // Check if current user is following this user
  const isFollowing = (currentUser as any)?.user?.following?.includes(userId) || false;
  
  // Check if user is viewing their own profile
  const isOwnProfile = (currentUser as any)?.user?._id === userId;
  
  // Follow state check

  // Follow mutation
  const followMutation = useMutation({
    mutationFn: async (targetUserId: string) => {
      const response = await fetch(`/api/user/follow/${targetUserId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: async () => {
      toast({
        title: t('profile_followed') || "Followed",
        description: t('profile_now_following') || "You are now following this user.",
      });
      // Force refetch user data after follow
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      await queryClient.invalidateQueries({ queryKey: [`/api/user-profile/${userId}`] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/me"] });
      await queryClient.refetchQueries({ queryKey: [`/api/user-profile/${userId}`] });
    },
    onError: (error: any) => {
      if (error.message.includes('401')) {
        toast({
          title: t('profile_login_required') || "You must be logged in to follow",
          variant: "destructive",
        });
        window.location.href = '/login';
      } else {
        toast({
          title: t('general_error') || "Something went wrong",
          variant: "destructive",
        });
      }
    },
  });

  // Unfollow mutation
  const unfollowMutation = useMutation({
    mutationFn: async (targetUserId: string) => {
      const response = await fetch(`/api/user/unfollow/${targetUserId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: async () => {
      toast({
        title: t('profile_unfollowed') || "Unfollowed",
        description: t('profile_no_longer_following') || "You are no longer following this user.",
      });
      // Force refetch user data after unfollow
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      await queryClient.invalidateQueries({ queryKey: [`/api/user-profile/${userId}`] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/me"] });
      await queryClient.refetchQueries({ queryKey: [`/api/user-profile/${userId}`] });
    },
    onError: () => {
      toast({
        title: t('profile_unfollow_failed') || "Failed to unfollow",
        variant: "destructive",
      });
    },
  });

  const handleFollow = () => {
    if (!(currentUser as any)?.authenticated) {
      toast({
        title: t('profile_login_required') || "You must be logged in to follow",
        variant: "destructive",
      });
      window.location.href = '/login';
      return;
    }
    followMutation.mutate(userId);
  };

  const handleUnfollow = () => {
    unfollowMutation.mutate(userId);
  };

  const handleShare = () => {
    const profileUrl = `${window.location.origin}/users/${userId}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(profileUrl);
      toast({
        title: t('profile_copied') || "Copied to clipboard",
        description: t('profile_link_copied') || "Profile link copied to clipboard.",
      });
    }
  };

  if (isLoadingProfile) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] text-white flex items-center justify-center">
        <div>{t('profile_loading') || 'Loading user profile...'}</div>
      </div>
    );
  }

  if (profileError || !userProfile) {
    return <NotFound />;
  }

  if (!userProfile.isPublic && !userProfile.isPublicProfile) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">{t('profile_private') || 'Private Profile'}</h1>
          <p className="text-white/70">{t('profile_private_message') || "This user's profile is private."}</p>
        </div>
      </div>
    );
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
                  size="xl"
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
                    <span>Radio Enthusiast</span>
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
                        Following
                      </Button>
                    ) : (
                      <Button 
                        onClick={handleFollow}
                        disabled={followMutation.isPending}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 flex items-center gap-2"
                      >
                        <UserPlus className="w-4 h-4" />
                        Follow
                      </Button>
                    )}
                  </>
                )}
                <Button 
                  onClick={handleShare}
                  variant="outline"
                  className="border-white/30 text-white hover:bg-white/10 px-6 py-2 flex items-center gap-2"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </Button>
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
                      Following
                    </Button>
                  ) : (
                    <Button 
                      onClick={handleFollow}
                      disabled={followMutation.isPending}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white flex-1"
                    >
                      <UserPlus className="w-4 h-4 mr-1" />
                      Follow
                    </Button>
                  )}
                </>
              )}
              <Button 
                onClick={handleShare}
                variant="outline"
                size="sm"
                className="border-white/30 text-white hover:bg-white/10"
              >
                <Share2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Stats Cards Row - ORIGINAL DESIGN */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#1A1A1A] rounded-xl p-4 border border-[#2F2F2F]">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600/20 rounded-lg">
                <Clock className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">10.0h</div>
                <div className="text-xs text-gray-400">Total Listen Time</div>
              </div>
            </div>
          </div>
          
          <div className="bg-[#1A1A1A] rounded-xl p-4 border border-[#2F2F2F]">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-600/20 rounded-lg">
                <Music className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{favoriteStations.length}</div>
                <div className="text-xs text-gray-400">Favorite Stations</div>
              </div>
            </div>
          </div>
          
          <div className="bg-[#1A1A1A] rounded-xl p-4 border border-[#2F2F2F]">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-600/20 rounded-lg">
                <Heart className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">August 15, 2025</div>
                <div className="text-xs text-gray-400">Member Since</div>
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
                <div className="text-2xl font-bold text-white">5:00 AM - 8:00 PM</div>
                <div className="text-xs text-gray-400">Peak Hours</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation - ORIGINAL DESIGN */}
        <div className="border-b border-[#2F2F2F] mb-6">
          <div className="flex gap-8">
            <button 
              onClick={() => setActiveTab('favorites')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === 'favorites' 
                  ? 'border-blue-500 text-blue-400' 
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <Heart className="w-4 h-4" fill={activeTab === 'favorites' ? 'currentColor' : 'none'} />
              Favorites
            </button>

            <button 
              onClick={() => setActiveTab('genres')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === 'genres' 
                  ? 'border-blue-500 text-blue-400' 
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <Music className="w-4 h-4" />
              Genres
            </button>

            <button 
              onClick={() => setActiveTab('countries')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === 'countries' 
                  ? 'border-blue-500 text-blue-400' 
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              </svg>
              Countries
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="min-h-[400px]">
          {activeTab === 'favorites' && (
            <div>
              <h2 className="text-xl font-bold text-white mb-6">Favorite Stations</h2>
              {isLoadingFavorites ? (
                <div className="text-center py-12">
                  <div className="text-gray-400">{t('profile_loading_favorites') || 'Loading favorite stations...'}</div>
                </div>
              ) : favoriteStations.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {favoriteStations.map((station) => (
                    <StationCard
                      key={station._id}
                      station={station}
                      showFavorite={false}
                      className="bg-[#1A1A1A] border-[#2F2F2F] hover:bg-[#252525] transition-colors"
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Heart className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                  <div className="text-gray-400 text-lg mb-2">No favorite stations yet</div>
                  <p className="text-gray-500">Start exploring and add stations to favorites!</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'genres' && (
            <div>
              <h2 className="text-xl font-bold text-white mb-6">Preferred Genres</h2>
              <div className="text-center py-12">
                <Music className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <div className="text-gray-400 text-lg mb-2">Genre preferences coming soon</div>
                <p className="text-gray-500">This feature will show your listening preferences by genre.</p>
              </div>
            </div>
          )}

          {activeTab === 'countries' && (
            <div>
              <h2 className="text-xl font-bold text-white mb-6">Favorite Countries</h2>
              <div className="text-center py-12">
                <svg className="w-16 h-16 text-gray-600 mx-auto mb-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                </svg>
                <div className="text-gray-400 text-lg mb-2">Country preferences coming soon</div>
                <p className="text-gray-500">This feature will show your favorite radio countries.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}