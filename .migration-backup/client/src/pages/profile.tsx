import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useNotificationService } from "@/services/NotificationService";
import { useNotifications } from "@/hooks/useNotifications";
import { apiRequest } from "@/lib/queryClient";
import { getAvatarUrl } from "@/lib/utils";
import { 
  User, 
  Settings, 
  Heart,
  Headphones,
  Clock,
  MapPin,
  Mail,
  Calendar,
  Music,
  Star,
  TrendingUp,
  Shield,
  UserMinus,
  UserPlus,
  Activity,
  Radio
} from "lucide-react";
import StationCard from "@/components/ui/station-card";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useTranslation } from "@/hooks/useTranslation";

function ProfileContent() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const { toast } = useToast();
  const notificationService = useNotificationService();
  const { notify } = useNotifications();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  // Get global player to access favorites management
  const { playStation, currentStation, isPlaying, toggleFavorite } = useGlobalPlayer();

  // Refresh user data periodically to get updated listening time
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const refreshInterval = setInterval(() => {
      // Force refetch user data to get fresh listening time from database
      queryClient.invalidateQueries({ queryKey: ['user'] });
    }, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(refreshInterval);
  }, [isAuthenticated, queryClient]);

  // Fetch user favorites with loading state
  const { data: favorites = [], isLoading: favoritesLoading } = useQuery({
    queryKey: ['/api/user/favorites'],
    enabled: !!user?.email,
  });

  // Use client-side recently played stations from localStorage
  const [lastPlayed, setLastPlayed] = useState<any[]>([]);
  const lastPlayedLoading = false;
  
  // Load recently played from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('recentlyPlayed') || '[]';
      setLastPlayed(JSON.parse(stored));
    } catch {
      setLastPlayed([]);
    }
    
    // Listen for updates
    const handleUpdate = () => {
      try {
        const stored = localStorage.getItem('recentlyPlayed') || '[]';
        setLastPlayed(JSON.parse(stored));
      } catch {
        setLastPlayed([]);
      }
    };
    window.addEventListener('recentlyPlayedUpdated', handleUpdate);
    return () => window.removeEventListener('recentlyPlayedUpdated', handleUpdate);
  }, []);

  // Fetch user's social connections
  const { data: socialData = { followers: [], following: [] }, isLoading: socialLoading } = useQuery<{followers: any[], following: any[]}>({
    queryKey: ['/api/user/social', user?.email],
    enabled: !!user?.email,
    staleTime: 2 * 60 * 1000,
  });

  // Format listening time as "Xh YMi Zs"
  const formatListeningTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours === 0 && minutes === 0) return `${seconds}s`;
    if (hours === 0) return `${minutes}mi ${seconds}s`;
    return `${hours}h ${minutes}mi ${seconds}s`;
  };

  // Memoized stats for performance
  const userStats = useMemo(() => ({
    favorites: Array.isArray(favorites) ? favorites.length : (user?.favoriteStationsCount || 0),
    followers: Array.isArray(socialData?.followers) ? socialData.followers.length : (user?.followersCount || 0),
    following: Array.isArray(socialData?.following) ? socialData.following.length : (user?.followingCount || 0),
    listeningTime: formatListeningTime(user?.totalListeningTime || 0)
  }), [favorites, socialData, user]);

  // Follow/Unfollow mutations
  const followMutation = useMutation({
    mutationFn: (targetUserId: string) => apiRequest(`/api/user/follow/${targetUserId}`, 'POST'),
    onSuccess: (data, targetUserId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/social'] });
      toast({ title: t('general_success', 'Success'), description: t('success_user_followed', 'User followed successfully') });
      
      // Show rich notification for new follow
      notificationService.newFollower("New Friend"); // In a real app, you'd get the user's name from the response
    },
    onError: () => {
      toast({ title: t('general_error', 'Error'), description: t('error_failed_to_follow', 'Failed to follow user'), variant: "destructive" });
    }
  });

  const unfollowMutation = useMutation({
    mutationFn: (targetUserId: string) => apiRequest(`/api/user/unfollow/${targetUserId}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/social'] });
      toast({ title: t('general_success', 'Success'), description: t('success_user_unfollowed', 'User unfollowed successfully') });
      
      // Show simple info notification for unfollow
      notify({
        type: 'info',
        title: 'Unfollowed',
        message: 'You have unfollowed this user',
        duration: 2000
      });
    },
    onError: () => {
      toast({ title: t('general_error', 'Error'), description: t('error_failed_to_unfollow', 'Failed to unfollow user'), variant: "destructive" });
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-gray-400">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center">
        <Card className="w-full max-w-md bg-[#151515] border-gray-800">
          <CardHeader className="text-center">
            <Shield className="w-12 h-12 text-blue-500 mx-auto mb-4" />
            <CardTitle className="text-white">Authentication Required</CardTitle>
            <CardDescription className="text-gray-400">
              Please log in to view your profile
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button 
              onClick={() => window.location.href = '/auth/login'}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#151515]">
      {/* Profile Heading - aligned with sidebar first item */}
      <h1 className="text-[24px] font-bold font-ubuntu text-white mb-6" style={{ letterSpacing: '0%' }}>
        Profile
      </h1>

      {/* Content - ProfileLayout already provides max-w-[1512px] mx-auto wrapper */}
      <div className="text-white">

        {/* User Profile Card */}
        <Card className="bg-[#151515] border-gray-800 mb-6">
          <CardHeader>
            <div className="flex items-center space-x-4">
              <Avatar className="w-20 h-20">
                <AvatarImage src={getAvatarUrl(user)} alt={user.fullName || user.username} />
                <AvatarFallback className="bg-blue-600 text-white text-xl">
                  {(user.fullName || user.username || user.email || 'U').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-white">
                  {user.fullName || user.username || 'User'}
                </h2>
                <p className="text-gray-400 flex items-center mt-1">
                  <Mail className="w-4 h-4 mr-2" />
                  {user.email}
                </p>
                {user.location && (
                  <p className="text-gray-400 flex items-center mt-1">
                    <MapPin className="w-4 h-4 mr-2" />
                    {user.location}
                  </p>
                )}
                <div className="flex items-center space-x-2 mt-2">
                  <Badge variant={user.emailVerified ? "default" : "destructive"} className="text-xs">
                    {user.emailVerified ? t('status_verified', 'Verified') : t('status_unverified', 'Unverified')}
                  </Badge>
                  <Badge variant="outline" className="text-xs text-gray-300">
                    {user.role}
                  </Badge>
                </div>
              </div>
            </div>
          </CardHeader>
          
          <CardContent>
            {/* Stats Grid with Loading States */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-4 bg-[#1A1A1A] rounded-lg">
                <Heart className="w-6 h-6 text-red-500 mx-auto mb-2" />
                {favoritesLoading ? (
                  <Skeleton className="h-6 w-12 mx-auto mb-1 bg-gray-700" />
                ) : (
                  <div className="text-xl font-bold text-white">
                    {userStats.favorites}
                  </div>
                )}
                <div className="text-sm text-gray-400">Favorites</div>
              </div>
              
              <div className="text-center p-4 bg-[#1A1A1A] rounded-lg">
                <TrendingUp className="w-6 h-6 text-green-500 mx-auto mb-2" />
                {socialLoading ? (
                  <Skeleton className="h-6 w-12 mx-auto mb-1 bg-gray-700" />
                ) : (
                  <div className="text-xl font-bold text-white">
                    {userStats.followers}
                  </div>
                )}
                <div className="text-sm text-gray-400">Followers</div>
              </div>
              
              <div className="text-center p-4 bg-[#1A1A1A] rounded-lg">
                <User className="w-6 h-6 text-blue-500 mx-auto mb-2" />
                {socialLoading ? (
                  <Skeleton className="h-6 w-12 mx-auto mb-1 bg-gray-700" />
                ) : (
                  <div className="text-xl font-bold text-white">
                    {userStats.following}
                  </div>
                )}
                <div className="text-sm text-gray-400">Following</div>
              </div>
              
              <div className="text-center p-4 bg-[#1A1A1A] rounded-lg">
                <Radio className="w-6 h-6 text-purple-500 mx-auto mb-2" />
                <div className="text-xl font-bold text-white">
                  {userStats.listeningTime}
                </div>
                <div className="text-sm text-gray-400">Listening</div>
              </div>
            </div>

            {/* Account Info */}
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 flex items-center">
                  <Calendar className="w-4 h-4 mr-2" />
                  Member since
                </span>
                <span className="text-white">
                  {new Date(user.createdAt).toLocaleDateString()}
                </span>
              </div>
              
              {user.lastLoginAt && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 flex items-center">
                    <Clock className="w-4 h-4 mr-2" />
                    Last login
                  </span>
                  <span className="text-white">
                    {new Date(user.lastLoginAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        {/* Enhanced Tab Navigation */}
        <div className="flex space-x-4 p-1 mb-4">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium transition-colors focus:outline-none border-b-2 ${
              activeTab === 'overview' 
                ? 'border-[#FF4199] text-white' 
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Activity className="w-4 h-4 inline mr-2" />
            Overview
          </button>
          <button
            onClick={() => setActiveTab('favorites')}
            className={`px-4 py-2 text-sm font-medium transition-colors focus:outline-none border-b-2 ${
              activeTab === 'favorites' 
                ? 'border-[#FF4199] text-white' 
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Heart className="w-4 h-4 inline mr-2" />
            Favorites ({userStats.favorites})
          </button>
          <button
            onClick={() => setActiveTab('social')}
            className={`px-4 py-2 text-sm font-medium transition-colors focus:outline-none border-b-2 ${
              activeTab === 'social' 
                ? 'border-[#FF4199] text-white' 
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <User className="w-4 h-4 inline mr-2" />
            Social
          </button>
        </div>

        {/* Enhanced Tab Content */}
        <div className="mt-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Recent Activity */}
              <Card className="bg-[#151515] border-gray-800">
                <CardHeader>
                  <CardTitle className="text-white flex items-center">
                    <Activity className="w-5 h-5 mr-2" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {lastPlayedLoading ? (
                    <div className="space-y-3">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center space-x-3">
                          <Skeleton className="h-12 w-12 rounded bg-gray-700" />
                          <div className="space-y-2">
                            <Skeleton className="h-4 w-40 bg-gray-700" />
                            <Skeleton className="h-3 w-24 bg-gray-700" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : !Array.isArray(lastPlayed) || lastPlayed.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <Radio className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                      <p>No listening history yet</p>
                      <p className="text-sm mt-2">Start listening to stations to see your activity here</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(lastPlayed as any[]).slice(0, 5).map((station: any, i: number) => (
                        <div key={i} className="flex items-center space-x-3 p-3 bg-[#1A1A1A] rounded-lg">
                          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                            <Radio className="w-6 h-6 text-white" />
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium text-white">{station.name}</h4>
                            <p className="text-sm text-gray-400">{station.country}</p>
                          </div>
                          <span className="text-xs text-gray-500">
                            {new Date(station.lastPlayedAt || Date.now()).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quick Stats */}
              <Card className="bg-[#151515] border-gray-800">
                <CardHeader>
                  <CardTitle className="text-white">This Week</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-[#1A1A1A] rounded-lg">
                      <Music className="w-6 h-6 text-blue-500 mx-auto mb-2" />
                      <div className="text-lg font-bold text-white">{Array.isArray(lastPlayed) ? lastPlayed.length : 0}</div>
                      <div className="text-sm text-gray-400">Stations Played</div>
                    </div>
                    <div className="text-center p-4 bg-[#1A1A1A] rounded-lg">
                      <Star className="w-6 h-6 text-yellow-500 mx-auto mb-2" />
                      <div className="text-lg font-bold text-white">{Math.max(0, userStats.favorites - 5)}</div>
                      <div className="text-sm text-gray-400">New Favorites</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'favorites' && (
            <Card className="bg-[#151515] border-gray-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center">
                  <Heart className="w-5 h-5 mr-2 text-red-500" />
                  Favorite Stations ({userStats.favorites})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {favoritesLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="p-4 bg-[#1A1A1A] rounded-lg">
                        <Skeleton className="h-16 w-16 rounded bg-gray-700 mx-auto mb-3" />
                        <Skeleton className="h-4 w-32 bg-gray-700 mx-auto mb-2" />
                        <Skeleton className="h-3 w-24 bg-gray-700 mx-auto" />
                      </div>
                    ))}
                  </div>
                ) : !Array.isArray(favorites) || favorites.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Heart className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                    <p className="text-lg mb-2">No favorite stations yet</p>
                    <p className="text-sm">Click the heart icon on any station to add it to your favorites</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(favorites as any[]).map((station: any, i: number) => (
                      <StationCard 
                        key={station._id || i} 
                        station={station}
                        showVotes={true}
                        onPlay={(playedStation) => playStation(playedStation)}
                        onToggleFavorite={(stationId, isFavorite) => {
                          if (!isFavorite) {
                            // Remove from favorites
                            toggleFavorite(stationId);
                          }
                        }}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === 'social' && (
            <div className="space-y-6">
              <Card className="bg-[#151515] border-gray-800">
                <CardHeader>
                  <CardTitle className="text-white flex items-center">
                    <TrendingUp className="w-5 h-5 mr-2 text-green-500" />
                    Followers ({userStats.followers})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {socialLoading ? (
                    <div className="space-y-3">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center space-x-3">
                          <Skeleton className="h-12 w-12 rounded-full bg-gray-700" />
                          <div className="space-y-2 flex-1">
                            <Skeleton className="h-4 w-32 bg-gray-700" />
                            <Skeleton className="h-3 w-48 bg-gray-700" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : !Array.isArray(socialData?.followers) || !socialData?.followers?.length ? (
                    <div className="text-center py-8 text-gray-400">
                      <User className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                      <p>No followers yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(socialData?.followers || []).map((follower: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg">
                          <div className="flex items-center space-x-3">
                            <Avatar className="w-12 h-12">
                              <AvatarImage src={follower.avatar} />
                              <AvatarFallback className="bg-blue-600 text-white">
                                {(follower.name || follower.email || 'U').charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <h4 className="font-medium text-white">{follower.name || 'User'}</h4>
                              <p className="text-sm text-gray-400">{follower.email}</p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => unfollowMutation.mutate(follower._id)}
                            disabled={unfollowMutation.isPending}
                          >
                            <UserMinus className="w-4 h-4 mr-1" />
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-[#151515] border-gray-800">
                <CardHeader>
                  <CardTitle className="text-white flex items-center">
                    <User className="w-5 h-5 mr-2 text-blue-500" />
                    Following ({userStats.following})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {socialLoading ? (
                    <div className="space-y-3">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center space-x-3">
                          <Skeleton className="h-12 w-12 rounded-full bg-gray-700" />
                          <div className="space-y-2 flex-1">
                            <Skeleton className="h-4 w-32 bg-gray-700" />
                            <Skeleton className="h-3 w-48 bg-gray-700" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : !Array.isArray(socialData?.following) || !socialData?.following?.length ? (
                    <div className="text-center py-8 text-gray-400">
                      <UserPlus className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                      <p>Not following anyone yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(socialData?.following || []).map((following: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg">
                          <div className="flex items-center space-x-3">
                            <Avatar className="w-12 h-12">
                              <AvatarImage src={following.avatar} />
                              <AvatarFallback className="bg-green-600 text-white">
                                {(following.name || following.email || 'U').charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <h4 className="font-medium text-white">{following.name || 'User'}</h4>
                              <p className="text-sm text-gray-400">{following.email}</p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => unfollowMutation.mutate(following._id)}
                            disabled={unfollowMutation.isPending}
                          >
                            <UserMinus className="w-4 h-4 mr-1" />
                            Unfollow
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Profile() {
  return (
    <ProtectedRoute>
      <ProfileContent />
    </ProtectedRoute>
  );
}