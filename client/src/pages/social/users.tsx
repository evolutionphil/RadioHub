import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import UserSearchAndFollow from "@/components/social/UserSearchAndFollow";
import { 
  Users, 
  TrendingUp, 
  UserPlus, 
  Bell,
  MapPin,
  Calendar,
  Heart,
  Headphones
} from "lucide-react";

interface FollowUser {
  user: {
    _id: string;
    fullName?: string;
    username?: string;
    avatar?: string;
    location?: string;
    followersCount: number;
    followingCount: number;
    createdAt: string;
  };
  followedAt: string;
}

interface FollowResponse {
  followers?: FollowUser[];
  following?: FollowUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

interface Notification {
  _id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  fromUserId?: {
    fullName?: string;
    username?: string;
    avatar?: string;
  };
}

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export default function UsersPage() {
  const [activeTab, setActiveTab] = useState("discover");
  const { user, isAuthenticated } = useAuth();

  // Get user's followers
  const { data: followersData } = useQuery<FollowResponse>({
    queryKey: [`/api/user/followers/${user?._id}`],
    enabled: isAuthenticated && !!user?._id,
    staleTime: 2 * 60 * 1000,
  });

  // Get user's following
  const { data: followingData } = useQuery<FollowResponse>({
    queryKey: [`/api/user/following/${user?._id}`],
    enabled: isAuthenticated && !!user?._id,
    staleTime: 2 * 60 * 1000,
  });

  // Get user notifications
  const { data: notificationsData } = useQuery<NotificationsResponse>({
    queryKey: ["/api/user/notifications"],
    enabled: isAuthenticated,
    staleTime: 30000,
  });

  // Discover tab is PUBLIC; followers/following/notifications require auth.
  // We render the page for everyone and gate per-tab content below.
  const tabCount = isAuthenticated ? 4 : 1;

  return (
    <div className="min-h-screen bg-[#0E0E0E]">
      {/* Header */}
      <div className="bg-[#151515] py-7">
        <div className="container mx-auto px-4">
          <h1 className="text-2xl font-bold text-white md:text-3xl">Social</h1>
          <p className="text-gray-400 mt-2">Connect with other radio enthusiasts</p>
        </div>
      </div>

      <div className="container mx-auto p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList
            className={`grid w-full ${tabCount === 4 ? 'grid-cols-4' : 'grid-cols-1'} bg-[#151515] border border-gray-800`}
          >
            <TabsTrigger 
              value="discover" 
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
            >
              <Users className="w-4 h-4 mr-2" />
              Discover
            </TabsTrigger>
            {isAuthenticated && (
              <>
                <TabsTrigger
                  value="followers"
                  className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                >
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Followers ({followersData?.pagination.total || 0})
                </TabsTrigger>
                <TabsTrigger
                  value="following"
                  className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Following ({followingData?.pagination.total || 0})
                </TabsTrigger>
                <TabsTrigger
                  value="notifications"
                  className="data-[state=active]:bg-blue-600 data-[state=active]:text-white relative"
                >
                  <Bell className="w-4 h-4 mr-2" />
                  Notifications
                  {notificationsData && notificationsData.unreadCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="absolute -top-2 -right-2 h-5 w-5 text-xs p-0 flex items-center justify-center"
                    >
                      {notificationsData.unreadCount}
                    </Badge>
                  )}
                </TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="discover" className="space-y-6">
            <UserSearchAndFollow />
          </TabsContent>

          <TabsContent value="followers" className="space-y-6">
            <Card className="bg-[#151515] border-gray-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center">
                  <TrendingUp className="w-5 h-5 mr-2" />
                  Your Followers ({followersData?.pagination.total || 0})
                </CardTitle>
                <p className="text-gray-400">People who follow you</p>
              </CardHeader>
              
              <CardContent>
                {followersData?.followers && followersData.followers.length > 0 ? (
                  <div className="space-y-4">
                    {followersData.followers.map((follower) => (
                      <div
                        key={follower.user._id}
                        className="flex items-center justify-between p-4 bg-[#1A1A1A] rounded-lg"
                      >
                        <div className="flex items-center space-x-4">
                          <Avatar className="w-12 h-12">
                            <AvatarImage src={follower.user.avatar} />
                            <AvatarFallback className="bg-blue-600 text-white">
                              {(follower.user.fullName || follower.user.username || 'U').charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          
                          <div>
                            <h3 className="font-medium text-white">
                              {follower.user.fullName || follower.user.username || 'User'}
                            </h3>
                            {follower.user.username && (
                              <p className="text-sm text-gray-400">@{follower.user.username}</p>
                            )}
                            <div className="flex items-center space-x-4 mt-1">
                              <span className="text-xs text-gray-500">
                                {follower.user.followersCount} followers
                              </span>
                              <span className="text-xs text-gray-500 flex items-center">
                                <Calendar className="w-3 h-3 mr-1" />
                                Followed {new Date(follower.followedAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <TrendingUp className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                    <p className="text-gray-400">No followers yet</p>
                    <p className="text-sm text-gray-500 mt-2">
                      Share your profile to get followers!
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="following" className="space-y-6">
            <Card className="bg-[#151515] border-gray-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center">
                  <UserPlus className="w-5 h-5 mr-2" />
                  Following ({followingData?.pagination.total || 0})
                </CardTitle>
                <p className="text-gray-400">People you follow</p>
              </CardHeader>
              
              <CardContent>
                {followingData?.following && followingData.following.length > 0 ? (
                  <div className="space-y-4">
                    {followingData.following.map((following) => (
                      <div
                        key={following.user._id}
                        className="flex items-center justify-between p-4 bg-[#1A1A1A] rounded-lg"
                      >
                        <div className="flex items-center space-x-4">
                          <Avatar className="w-12 h-12">
                            <AvatarImage src={following.user.avatar} />
                            <AvatarFallback className="bg-blue-600 text-white">
                              {(following.user.fullName || following.user.username || 'U').charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          
                          <div>
                            <h3 className="font-medium text-white">
                              {following.user.fullName || following.user.username || 'User'}
                            </h3>
                            {following.user.username && (
                              <p className="text-sm text-gray-400">@{following.user.username}</p>
                            )}
                            <div className="flex items-center space-x-4 mt-1">
                              <span className="text-xs text-gray-500">
                                {following.user.followersCount} followers
                              </span>
                              <span className="text-xs text-gray-500 flex items-center">
                                <Calendar className="w-3 h-3 mr-1" />
                                Following since {new Date(following.followedAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <UserPlus className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                    <p className="text-gray-400">You're not following anyone yet</p>
                    <p className="text-sm text-gray-500 mt-2">
                      Discover users in the search tab!
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-6">
            <Card className="bg-[#151515] border-gray-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center justify-between">
                  <div className="flex items-center">
                    <Bell className="w-5 h-5 mr-2" />
                    Recent Notifications
                  </div>
                  {notificationsData && notificationsData.unreadCount > 0 && (
                    <Badge variant="destructive">
                      {notificationsData.unreadCount} unread
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              
              <CardContent>
                {notificationsData?.notifications && notificationsData.notifications.length > 0 ? (
                  <div className="space-y-4">
                    {notificationsData.notifications.map((notification) => (
                      <div
                        key={notification._id}
                        className={`p-4 rounded-lg border-l-4 ${
                          notification.isRead 
                            ? 'bg-[#1A1A1A] border-gray-600' 
                            : 'bg-[#1A2332] border-blue-500'
                        }`}
                      >
                        <div className="flex items-start space-x-3">
                          {notification.fromUserId && (
                            <Avatar className="w-8 h-8">
                              <AvatarImage src={notification.fromUserId.avatar} />
                              <AvatarFallback className="bg-blue-600 text-white text-xs">
                                {(notification.fromUserId.fullName || notification.fromUserId.username || 'U').charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          
                          <div className="flex-1">
                            <h4 className="font-medium text-white">{notification.title}</h4>
                            <p className="text-sm text-gray-400 mt-1">{notification.message}</p>
                            <p className="text-xs text-gray-500 mt-2">
                              {new Date(notification.createdAt).toLocaleString()}
                            </p>
                          </div>
                          
                          {!notification.isRead && (
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Bell className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                    <p className="text-gray-400">No notifications yet</p>
                    <p className="text-sm text-gray-500 mt-2">
                      You'll see notifications when users follow you or interact with your content
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}