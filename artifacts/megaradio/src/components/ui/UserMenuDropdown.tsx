import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Link } from 'wouter';
import { useNotificationService } from '@/services/NotificationService';
import { useTranslation } from '@/hooks/useTranslation';
import { getAvatarUrl } from '@/lib/utils';
import {
  buildDropdownKeyHandler,
  focusFirstInside,
} from '@/lib/dropdown-keyboard';

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

export function UserMenuDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const notificationService = useNotificationService();
  const { t } = useTranslation();

  // Get current user data
  const { data: user, isLoading } = useQuery<User>({
    queryKey: ['/api/auth/me'],
    retry: false,
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/auth/logout'),
    onSuccess: () => {
      // Show logout notification
      const userName = user?.fullName || user?.username || "User";
      notificationService.logoutSuccess(userName);
      
      // Clear all cached data
      queryClient.clear();
      // Delay redirect to allow notification to show
      setTimeout(() => {
        // Preserve language after logout
        const currentPath = window.location.pathname;
        const segments = currentPath.split('/').filter(Boolean);
        const countryCode = segments.length > 0 && segments[0].length === 2 ? segments[0] : '';
        window.location.href = countryCode ? `/${countryCode}` : '/';
      }, 1000);
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

  // Move focus to the first menu item when the dropdown opens.
  useEffect(() => {
    if (!isOpen) return;
    const id = window.requestAnimationFrame(() => {
      focusFirstInside(menuRef.current);
    });
    return () => window.cancelAnimationFrame(id);
  }, [isOpen]);

  // Don't render if not authenticated or loading
  if (isLoading || !user) return null;

  const closeAndRestoreFocus = () => {
    setIsOpen(false);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        triggerButtonRef.current?.focus();
      });
    }
  };

  const handleLogout = () => {
    logoutMutation.mutate();
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block text-left ml-0 lg:ml-5 z-10" ref={dropdownRef}>
      {/* Menu Button */}
      <div>
        <div className="flex items-center">
          <button
            ref={triggerButtonRef}
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center focus:outline-none"
            aria-expanded={isOpen}
            aria-haspopup="menu"
          >
            {/* User name - hidden on mobile, shown on desktop - EXACT from original */}
            <div className="hidden xl:flex items-center pr-4">
              <p className="cursor-pointer truncate text-base text-white font-medium relative after:absolute after:bottom-0 after:left-0 after:h-1.5 after:w-2/5 after:bg-[#FF4199] hover:after:w-full after:transition-all">
                {user.fullName || user.username || 'User'}
              </p>
            </div>
            
            {/* Avatar - EXACT from original LayoutHeader.vue */}
            <div className="relative">
              <img
                className="h-10 w-10 rounded-full object-cover border-2 border-[#FF4199]/20 hover:border-[#FF4199]/40 transition-colors"
                src={getAvatarUrl(user)}
                alt={user.fullName || user.username || "User Avatar"}
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  img.style.display = 'none';
                  const parent = img.parentElement;
                  if (parent) {
                    parent.innerHTML = `<div class="h-10 w-10 rounded-full bg-[#FF4199] flex items-center justify-center text-white font-bold text-sm border-2 border-[#FF4199]/20 hover:border-[#FF4199]/40 transition-colors">${(user.fullName || user.username || 'U').charAt(0).toUpperCase()}</div>`;
                  }
                }}
              />
              {/* Online indicator */}
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-[#0E0E0E]"></div>
            </div>
          </button>
        </div>
      </div>

      {/* Dropdown Menu - EXACT from original LayoutHeader.vue */}
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('user_menu_label', 'User menu')}
          tabIndex={-1}
          onKeyDown={buildDropdownKeyHandler(menuRef, closeAndRestoreFocus)}
          className="absolute right-0 mt-2 w-56 origin-top-right divide-y divide-[#2F2F2F] rounded-md bg-[#1D1D1D] border border-[#2F2F2F] text-white shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none z-50"
        >
          {/* User Info Section */}
          <div className="px-4 py-3">
            <p className="text-sm text-gray-300">{t('user_menu_signed_in_as')}</p>
            <p className="truncate text-sm font-medium text-white">
              {user.fullName || user.username || 'User'}
            </p>
            <p className="truncate text-xs text-gray-400 mt-1">
              {user.email}
            </p>
          </div>

          {/* Navigation Links */}
          <div className="py-1">
            <Link
              href="/profile/favorites"
              className="block px-4 py-2 text-sm text-gray-200 hover:bg-[#2F2F2F] hover:text-white transition-colors"
              onClick={() => setIsOpen(false)}
            >
              {t('user_menu_your_favorites', 'Your Favorites')}
            </Link>
            <Link
              href="/profile/discover"
              className="block px-4 py-2 text-sm text-gray-200 hover:bg-[#2F2F2F] hover:text-white transition-colors"
              onClick={() => setIsOpen(false)}
            >
              {t('user_menu_discover', 'Discover')}
            </Link>
            <Link
              href="/profile/settings"
              className="block px-4 py-2 text-sm text-gray-200 hover:bg-[#2F2F2F] hover:text-white transition-colors"
              onClick={() => setIsOpen(false)}
            >
              {t('user_menu_profile', 'Profile')}
            </Link>
          </div>

          {/* Logout Section */}
          <div className="py-1">
            <button
              onClick={handleLogout}
              disabled={logoutMutation.isPending}
              className="block w-full px-4 py-2 text-left text-sm text-gray-200 hover:bg-[#2F2F2F] hover:text-white transition-colors disabled:opacity-50"
            >
              {logoutMutation.isPending ? t('user_menu_logging_out', 'Logging out...') : t('user_menu_logout', 'Logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
