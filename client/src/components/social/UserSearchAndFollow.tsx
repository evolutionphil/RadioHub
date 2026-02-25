import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { 
  Search, 
  UserPlus, 
  UserMinus, 
  Users, 
  TrendingUp, 
  MapPin,
  Calendar,
  Loader2
} from "lucide-react";

interface User {
  _id: string;
  fullName?: string;
  username?: string;
  email: string;
  avatar?: string;
  location?: string;
  followersCount: number;
  followingCount: number;
  createdAt: string;
}

interface SearchUsersResponse {
  users: User[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export default function UserSearchAndFollow() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const { user: currentUser, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Debounce search query
  useState(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  });

  // Search users query
  const { data: searchResults, isLoading: isSearching } = useQuery<SearchUsersResponse>({
    queryKey: ["/api/users/search", { q: debouncedQuery }],
    enabled: debouncedQuery.length >= 2,
    staleTime: 30000, // 30 seconds
  });

  // Follow user mutation
  const followMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest("POST", `/api/user/follow/${userId}`);
    },
    onSuccess: (_, userId) => {
      toast({
        title: "User followed!",
        description: "You are now following this user.",
        variant: "default"
      });
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/users/search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/following"] });
      queryClient.invalidateQueries({ queryKey: [`/api/user/is-following/${userId}`] });
    },
    onError: (error: any) => {
      toast({
        title: "Follow failed",
        description: error.message || "Failed to follow user. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Unfollow user mutation
  const unfollowMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest("DELETE", `/api/user/unfollow/${userId}`);
    },
    onSuccess: (_, userId) => {
      toast({
        title: "User unfollowed",
        description: "You have unfollowed this user.",
        variant: "default"
      });
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/users/search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/following"] });
      queryClient.invalidateQueries({ queryKey: [`/api/user/is-following/${userId}`] });
    },
    onError: (error: any) => {
      toast({
        title: "Unfollow failed",
        description: error.message || "Failed to unfollow user. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Check if following specific users
  const followingQueries = searchResults?.users.map(user => ({
    userId: user._id,
    query: useQuery({
      queryKey: [`/api/user/is-following/${user._id}`],
      enabled: isAuthenticated && !!currentUser,
      staleTime: 60000, // 1 minute
    })
  })) || [];

  const getFollowingStatus = (userId: string) => {
    const query = followingQueries.find(q => q.userId === userId);
    return query?.query.data?.isFollowing || false;
  };

  const handleFollow = (userId: string) => {
    if (!isAuthenticated) {
      toast({
        title: "Authentication required",
        description: "Please log in to follow users.",
        variant: "destructive"
      });
      return;
    }
    followMutation.mutate(userId);
  };

  const handleUnfollow = (userId: string) => {
    unfollowMutation.mutate(userId);
  };

  if (!isAuthenticated) {
    return (
      <Card className="bg-[#151515] border-gray-800">
        <CardHeader className="text-center">
          <Users className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <CardTitle className="text-white">Discover Users</CardTitle>
          <p className="text-gray-400">Log in to search and follow other users</p>
        </CardHeader>
        <CardContent className="text-center">
          <Link href="/auth/login">
            <Button className="bg-blue-600 hover:bg-blue-700">
              Sign In to Continue
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search Header */}
      <Card className="bg-[#151515] border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center">
            <Users className="w-5 h-5 mr-2" />
            Discover Users
          </CardTitle>
          <p className="text-gray-400">Search for users to follow and connect with</p>
        </CardHeader>
        
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, username, or email..."
              className="pl-10 h-11 bg-[#1A1A1A] border-gray-700 text-white placeholder-gray-400 focus:border-blue-500"
            />
          </div>
          
          {searchQuery.length > 0 && searchQuery.length < 2 && (
            <p className="text-sm text-gray-400 mt-2">
              Type at least 2 characters to search
            </p>
          )}
        </CardContent>
      </Card>

      {/* Search Results */}
      {debouncedQuery.length >= 2 && (
        <Card className="bg-[#151515] border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">
              Search Results
              {searchResults && (
                <span className="text-sm font-normal text-gray-400 ml-2">
                  ({searchResults.pagination.total} users found)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          
          <CardContent>
            {isSearching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                <span className="ml-2 text-gray-400">Searching users...</span>
              </div>
            ) : searchResults?.users.length === 0 ? (
              <div className="text-center py-8">
                <Users className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                <p className="text-gray-400">No users found matching your search</p>
              </div>
            ) : (
              <div className="space-y-4">
                {searchResults?.users.map((user) => {
                  const isFollowing = getFollowingStatus(user._id);
                  const isCurrentUser = user._id === currentUser?._id;
                  
                  return (
                    <div
                      key={user._id}
                      className="flex items-center justify-between p-4 bg-[#1A1A1A] rounded-lg hover:bg-[#2A2A2A] transition-colors"
                    >
                      <div className="flex items-center space-x-4">
                        <Avatar className="w-12 h-12">
                          <AvatarImage src={user.avatar} alt={user.fullName || user.username} />
                          <AvatarFallback className="bg-blue-600 text-white">
                            {(user.fullName || user.username || user.email).charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <h3 className="font-medium text-white">
                              {user.fullName || user.username || 'User'}
                            </h3>
                            {isCurrentUser && (
                              <Badge variant="outline" className="text-xs text-blue-400 border-blue-400">
                                You
                              </Badge>
                            )}
                          </div>
                          
                          <p className="text-sm text-gray-400">{user.email}</p>
                          
                          {user.location && (
                            <p className="text-xs text-gray-500 flex items-center mt-1">
                              <MapPin className="w-3 h-3 mr-1" />
                              {user.location}
                            </p>
                          )}
                          
                          <div className="flex items-center space-x-4 mt-2">
                            <span className="text-xs text-gray-500 flex items-center">
                              <TrendingUp className="w-3 h-3 mr-1" />
                              {user.followersCount} followers
                            </span>
                            <span className="text-xs text-gray-500">
                              {user.followingCount} following
                            </span>
                            <span className="text-xs text-gray-500 flex items-center">
                              <Calendar className="w-3 h-3 mr-1" />
                              Joined {new Date(user.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      {!isCurrentUser && (
                        <div>
                          {isFollowing ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleUnfollow(user._id)}
                              disabled={unfollowMutation.isPending}
                              className="border-red-600 text-red-400 hover:bg-red-600 hover:text-white"
                            >
                              <UserMinus className="w-4 h-4 mr-2" />
                              {unfollowMutation.isPending ? "Unfollowing..." : "Unfollow"}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleFollow(user._id)}
                              disabled={followMutation.isPending}
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <UserPlus className="w-4 h-4 mr-2" />
                              {followMutation.isPending ? "Following..." : "Follow"}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}