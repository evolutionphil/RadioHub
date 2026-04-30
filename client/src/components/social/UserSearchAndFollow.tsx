import { useState, useEffect } from "react";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
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
  Loader2,
  Sparkles,
} from "lucide-react";

interface User {
  _id: string;
  fullName?: string;
  username: string;
  avatar?: string;
  location?: string;
  bio?: string;
  slug?: string;
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
  const [, navigate] = useLocation();

  // Debounce search query — FIXED: was useState (only ran once on mount), now useEffect
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Default community list (newest public users) — shown when search is empty
  const { data: communityResults, isLoading: isLoadingCommunity } = useQuery<SearchUsersResponse>({
    queryKey: ["/api/users/search", { q: "", page: 1, limit: 24 }],
    enabled: debouncedQuery.length < 2,
    staleTime: 60_000,
  });

  // Search results — only when query is 2+ chars
  const { data: searchResults, isLoading: isSearching } = useQuery<SearchUsersResponse>({
    queryKey: ["/api/users/search", { q: debouncedQuery }],
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const isSearchMode = debouncedQuery.length >= 2;
  const displayedData = isSearchMode ? searchResults : communityResults;
  const isLoading = isSearchMode ? isSearching : isLoadingCommunity;

  // Bulk-fetch following status for displayed users (auth-only, single batch hook below)
  const userIds = displayedData?.users?.map(u => u._id) ?? [];

  // Follow / unfollow mutations
  const followMutation = useMutation({
    mutationFn: async (userId: string) => apiRequest("POST", `/api/user/follow/${userId}`),
    onSuccess: (_, userId) => {
      toast({ title: "User followed!", description: "You are now following this user." });
      queryClient.invalidateQueries({ queryKey: ["/api/users/search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/following"] });
      queryClient.invalidateQueries({ queryKey: [`/api/user/is-following/${userId}`] });
    },
    onError: (error: any) => {
      toast({
        title: "Follow failed",
        description: error?.message || "Failed to follow user. Please try again.",
        variant: "destructive",
      });
    },
  });

  const unfollowMutation = useMutation({
    mutationFn: async (userId: string) => apiRequest("DELETE", `/api/user/unfollow/${userId}`),
    onSuccess: (_, userId) => {
      toast({ title: "User unfollowed", description: "You have unfollowed this user." });
      queryClient.invalidateQueries({ queryKey: ["/api/users/search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/following"] });
      queryClient.invalidateQueries({ queryKey: [`/api/user/is-following/${userId}`] });
    },
    onError: (error: any) => {
      toast({
        title: "Unfollow failed",
        description: error?.message || "Failed to unfollow user. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Following lookup — useQueries (single hook call) keeps React hook count stable across renders.
  const followingQueries = useQueries({
    queries: userIds.map(userId => ({
      queryKey: [`/api/user/is-following/${userId}`],
      enabled: isAuthenticated && !!currentUser?._id && userId !== currentUser?._id,
      staleTime: 60_000,
    })),
  });

  const followingByUserId: Record<string, boolean> = {};
  userIds.forEach((userId, idx) => {
    const data = followingQueries[idx]?.data as { isFollowing?: boolean } | undefined;
    followingByUserId[userId] = data?.isFollowing ?? false;
  });

  const getFollowingStatus = (userId: string) => followingByUserId[userId] || false;

  const handleFollow = (userId: string) => {
    if (!isAuthenticated) {
      toast({
        title: "Sign in required",
        description: "Please sign in to follow other users.",
      });
      navigate("/auth/login");
      return;
    }
    followMutation.mutate(userId);
  };

  const handleUnfollow = (userId: string) => {
    if (!isAuthenticated) return;
    unfollowMutation.mutate(userId);
  };

  const renderUserCard = (user: User) => {
    const isFollowing = getFollowingStatus(user._id);
    const isCurrentUser = isAuthenticated && user._id === currentUser?._id;
    const profileHref = `/users/${user.slug || user._id}`;

    return (
      <div
        key={user._id}
        className="flex items-center justify-between p-4 bg-[#1A1A1A] rounded-lg hover:bg-[#2A2A2A] transition-colors"
      >
        <Link href={profileHref} className="flex items-center space-x-4 flex-1 min-w-0">
          <Avatar className="w-12 h-12 flex-shrink-0">
            <AvatarImage src={user.avatar} alt={user.fullName || user.username} />
            <AvatarFallback className="bg-blue-600 text-white">
              {(user.fullName || user.username || "U").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <h3 className="font-medium text-white truncate">
                {user.fullName || user.username || "User"}
              </h3>
              {isCurrentUser && (
                <Badge variant="outline" className="text-xs text-blue-400 border-blue-400">
                  You
                </Badge>
              )}
            </div>

            {user.username && (
              <p className="text-xs text-gray-500 truncate">@{user.username}</p>
            )}

            {user.location && (
              <p className="text-xs text-gray-500 flex items-center mt-1">
                <MapPin className="w-3 h-3 mr-1" />
                {user.location}
              </p>
            )}

            <div className="flex items-center space-x-4 mt-2 flex-wrap gap-y-1">
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
        </Link>

        {!isCurrentUser && (
          <div className="ml-3 flex-shrink-0">
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
  };

  return (
    <div className="space-y-6">
      {/* Search Header */}
      <Card className="bg-[#151515] border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center">
            <Users className="w-5 h-5 mr-2" />
            Discover Users
          </CardTitle>
          <p className="text-gray-400">Search by name, username or email and follow other listeners</p>
        </CardHeader>

        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, username, or email..."
              className="pl-10 h-11 bg-[#1A1A1A] border-gray-700 text-white placeholder-gray-400 focus:border-blue-500"
              data-testid="input-user-search"
            />
          </div>

          {searchQuery.length > 0 && searchQuery.length < 2 && (
            <p className="text-sm text-gray-400 mt-2">Type at least 2 characters to search</p>
          )}
        </CardContent>
      </Card>

      {/* Results: search-mode shows matches, otherwise shows newest community members */}
      <Card className="bg-[#151515] border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center">
            {isSearchMode ? (
              <>
                Search Results
                {displayedData && (
                  <span className="text-sm font-normal text-gray-400 ml-2">
                    ({displayedData.pagination.total} users found)
                  </span>
                )}
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2 text-pink-400" />
                Community Favorites — Newest Members
              </>
            )}
          </CardTitle>
          {!isSearchMode && (
            <p className="text-gray-400 text-sm">Latest public profiles, newest first</p>
          )}
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span className="ml-2 text-gray-400">
                {isSearchMode ? "Searching users..." : "Loading community..."}
              </span>
            </div>
          ) : !displayedData?.users?.length ? (
            <div className="text-center py-8">
              <Users className="w-12 h-12 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400">
                {isSearchMode
                  ? "No users found matching your search"
                  : "No public profiles yet"}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {displayedData.users.map(renderUserCard)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
