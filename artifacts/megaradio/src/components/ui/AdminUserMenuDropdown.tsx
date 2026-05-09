import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { User, LogOut, Settings } from "lucide-react";
import { useLocation } from "wouter";

interface User {
  _id: string;
  username: string;
  email: string;
  fullName: string;
  avatar?: string;
  role: string;
  status: string;
  preferences: {
    theme: string;
    language: string;
    autoplay: boolean;
    volume: number;
    notificationsEnabled: boolean;
  };
  permissions: {
    canManageStations: boolean;
    canManageUsers: boolean;
    canRunSync: boolean;
    canViewAnalytics: boolean;
    canExportData: boolean;
  };
}

export function AdminUserMenuDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  // Get current user data
  const { data: user, isLoading } = useQuery<User>({
    queryKey: ['/api/auth/me'],
    retry: false,
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/auth/logout'),
    onSuccess: () => {
      // Clear all cached data
      queryClient.clear();
      // CRITICAL: Use wouter navigation to prevent audio interruption
      setLocation('/');
    },
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Don't render if not authenticated or loading
  if (isLoading || !user) return null;

  const handleLogout = () => {
    logoutMutation.mutate();
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Menu Button - Mobile responsive */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center text-sm rounded-full bg-gray-200 p-3 sm:p-3 min-h-[48px] min-w-[48px] hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="User menu"
      >
        {user.avatar ? (
          <img
            className="h-5 w-5 sm:h-6 sm:w-6 rounded-full object-cover"
            src={user.avatar}
            alt={user.fullName || user.username || "User Avatar"}
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              const parent = img.parentElement;
              if (parent) {
                parent.innerHTML = `<div class="h-5 w-5 sm:h-6 sm:w-6 rounded-full bg-gray-500 flex items-center justify-center text-white font-bold text-xs">${(user.fullName || user.username || 'U').charAt(0).toUpperCase()}</div>`;
              }
            }}
          />
        ) : (
          <div className="h-5 w-5 sm:h-6 sm:w-6 rounded-full bg-gray-500 flex items-center justify-center text-white font-bold text-xs">
            {(user.fullName || user.username || 'U').charAt(0).toUpperCase()}
          </div>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 origin-top-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
          {/* User Info Section */}
          <div className="px-4 py-3">
            <p className="text-sm text-gray-500">Signed in as</p>
            <p className="truncate text-sm font-medium text-gray-900">
              {user.email}
            </p>
            <p className="text-xs text-gray-500 mt-1 capitalize">
              {user.role} • {user.status}
            </p>
          </div>

          {/* Navigation Links */}
          <div className="py-1">
            <a
              href="/admin/settings"
              className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              onClick={() => setIsOpen(false)}
            >
              <Settings className="mr-3 h-4 w-4 text-gray-400" />
              Settings
            </a>
          </div>

          {/* Logout Section */}
          <div className="py-1">
            <button
              onClick={handleLogout}
              disabled={logoutMutation.isPending}
              className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogOut className="mr-3 h-4 w-4 text-gray-400" />
              {logoutMutation.isPending ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}