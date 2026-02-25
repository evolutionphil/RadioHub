import { useQuery } from "@tanstack/react-query";
import { logger } from '@/lib/logger';

interface AdminUser {
  username: string;
  role: string;
}

interface AdminAuthResponse {
  user: AdminUser | null;
  authenticated: boolean;
}

export function useAdminAuth() {
  const { data: authData, isLoading, error, refetch } = useQuery<AdminAuthResponse>({
    queryKey: ["/api/admin/auth/me"],
    retry: false,
    refetchOnWindowFocus: true, // Enable refetch on window focus
    staleTime: 0, // Always fetch fresh data for admin auth
    gcTime: 0, // Don't cache admin auth data
  });

  // Admin auth state tracking
  logger.log('🔍 Admin auth hook - Data:', authData);
  logger.log('🔍 Admin auth hook - Loading:', isLoading);
  logger.log('🔍 Admin auth hook - Error:', error);

  return {
    user: authData?.user || null,
    isAuthenticated: authData?.authenticated || false,
    isLoading,
    isAdmin: authData?.user?.role === 'admin',
    error,
    refetch // Expose refetch function
  };
}