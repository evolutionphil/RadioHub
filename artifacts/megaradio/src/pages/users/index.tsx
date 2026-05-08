import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Search, ArrowRight, Filter, ChevronDown } from "lucide-react";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAvatarUrl } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface User {
  _id: string;
  fullName?: string;
  username: string;
  avatar?: string;
  followersCount?: number;
  favoriteStationsCount?: number;
  slug?: string;
}

export default function UsersIndex() {
  const { getLocalizedUrl } = useSeoRouting();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("newest"); // newest, oldest, most_radios, least_radios
  const limit = 20;

  // Auto-scroll to top when entering the page
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Debounce search input → only fire request after typing stops (400ms)
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch users from PUBLIC discovery endpoint (no auth required, isPublicProfile filter, newest first by default)
  const { data: usersData, isLoading } = useQuery({
    queryKey: ["/api/users/search", { q: debouncedSearch, page, limit, sortBy }],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sortBy: sortBy,
        ...(debouncedSearch && { q: debouncedSearch })
      });
      const response = await fetch(`/api/users/search?${params}`);
      if (!response.ok) throw new Error(`Failed to load users (${response.status})`);
      return response.json();
    },
    staleTime: 30_000,
  });

  const users = usersData?.users || [];
  const hasMore = usersData?.pagination?.page < usersData?.pagination?.pages;

  const handleLoadMore = () => {
    setPage(prev => prev + 1);
  };

  const displayName = (user: User) => {
    return user.fullName || user.username || "User";
  };

  return (
    <div className="min-h-screen bg-[#0E0E0E] text-white pb-16">
      <div className="container mx-auto px-4 py-4">
        {/* Header */}
        <div className="py-8">
          <h1 className="text-2xl font-bold text-white mb-2">{t('users_discover_users', 'Discover Users')}</h1>
          <p className="text-neutral-400 mb-6">{t('users_subtitle', 'Find and connect with other radio enthusiasts')}</p>
          
          {/* Search and Filters - RESPONSIVE DESIGN */}
          <div className="bg-[#2F2F2F] p-5 rounded-lg mb-8">
            <div className="flex flex-col space-y-4 md:flex-row md:space-y-0 md:space-x-4 md:items-center">
              {/* Search - RESPONSIVE WIDTH */}
              <div className="relative flex-1 md:max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  type="text"
                  placeholder={t('users_search_placeholder', 'Search user')}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1); // Reset to first page on search
                  }}
                  className="pl-10 w-full bg-[#454545] border-0 text-white text-lg font-medium placeholder-[#FFFFFF70] focus:ring-0 focus:outline-none py-3 px-6 rounded"
                />
              </div>
              
              {/* Sort Dropdown - RESPONSIVE */}
              <div className="flex-shrink-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="outline" 
                      className="bg-[#454545] border-gray-600 text-white hover:bg-[#555555] w-full md:w-auto justify-between min-w-[140px]"
                    >
                      <div className="flex items-center space-x-2">
                        <Filter className="w-4 h-4" />
                        <span className="hidden sm:inline">
                          {sortBy === "newest" ? t('users_newest', 'Newest') : 
                           sortBy === "oldest" ? t('users_oldest', 'Oldest') : 
                           sortBy === "most_radios" ? t('users_most_radios', 'Most Radios') : t('users_least_radios', 'Least Radios')}
                        </span>
                        <span className="sm:hidden">
                          {sortBy === "newest" ? t('users_new', 'New') : 
                           sortBy === "oldest" ? t('users_old', 'Old') : 
                           sortBy === "most_radios" ? t('users_most', 'Most') : t('users_least', 'Least')}
                        </span>
                      </div>
                      <ChevronDown className="w-4 h-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-[#2F2F2F] border-gray-600">
                    <DropdownMenuItem 
                      onClick={() => { setSortBy("newest"); setPage(1); }}
                      className="text-white hover:bg-[#404040] cursor-pointer"
                    >
                      {t('users_newest_first', 'Newest First')}
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => { setSortBy("oldest"); setPage(1); }}
                      className="text-white hover:bg-[#404040] cursor-pointer"
                    >
                      {t('users_oldest_first', 'Oldest First')}
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => { setSortBy("most_radios"); setPage(1); }}
                      className="text-white hover:bg-[#404040] cursor-pointer"
                    >
                      {t('users_most_radios', 'Most Radios')}
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => { setSortBy("least_radios"); setPage(1); }}
                      className="text-white hover:bg-[#404040] cursor-pointer"
                    >
                      {t('users_least_radios', 'Least Radios')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>

        {/* Users Grid - RESPONSIVE DESIGN (1 col mobile, 2 tablet, 3 desktop) */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
          {users
            .filter((user: User) => (user as any).isPublicProfile !== false) // Only show public profiles
            .map((user: User) => (
            <div key={user._id} className="flex items-center rounded-md bg-[#2F2F2F] px-4 py-6 md:py-6">
              {/* Avatar */}
              <div className="h-16 w-16 rounded-full md:h-20 md:w-20">
                <img 
                  className="h-16 w-16 rounded-full md:h-20 md:w-20 object-cover" 
                  src={getAvatarUrl(user)}
                  alt={displayName(user)} 
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.style.display = 'none';
                    const parent = img.parentElement;
                    if (parent) {
                      parent.innerHTML = `<div class="h-16 w-16 rounded-full md:h-20 md:w-20 bg-[#FF4199] flex items-center justify-center text-white font-bold text-xl">${displayName(user).charAt(0).toUpperCase()}</div>`;
                    }
                  }}
                />
              </div>
              
              {/* User Info */}
              <div className="pl-4 md:pl-6 flex-1">
                <Link href={getLocalizedUrl(`/users/${user._id}`)}>
                  <h3 className="text-xl font-medium text-white hover:text-accent transition-colors">
                    {displayName(user)}
                  </h3>
                </Link>
                <p className="text-sm font-medium text-gray-400">
                  {user.favoriteStationsCount || 0} {t('users_radios', 'radios')}
                </p>
              </div>
              
              {/* Discover Button */}
              <div className="ml-auto">
                <Link href={getLocalizedUrl(`/users/${user._id}`)}>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="text-white hover:text-accent hover:bg-white/5 p-2"
                  >
                    <span className="sr-only">{t('users_discover', 'Discover')}</span>
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Loading State - RESPONSIVE DESIGN */}
        {isLoading && page === 1 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="flex items-center rounded-md bg-[#2F2F2F] px-4 py-6 md:py-6">
                  <div className="h-16 w-16 rounded-full md:h-20 md:w-20 bg-gray-600"></div>
                  <div className="pl-4 md:pl-6 flex-1">
                    <div className="h-5 bg-gray-600 rounded mb-2 w-3/4"></div>
                    <div className="h-4 bg-gray-600 rounded w-1/2"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load More Button */}
        {hasMore && !isLoading && (
          <div className="text-center mt-8">
            <Button
              onClick={handleLoadMore}
              variant="outline"
              className="border-gray-600 text-white hover:bg-white/5"
            >
              {t('users_load_more', 'Load More Users')}
            </Button>
          </div>
        )}

        {/* No Users Found */}
        {!isLoading && users.length === 0 && (
          <div className="text-center text-gray-400 py-12">
            <p>{t('users_no_users_found', 'No users found matching your search.')}</p>
          </div>
        )}
      </div>
    </div>
  );
}