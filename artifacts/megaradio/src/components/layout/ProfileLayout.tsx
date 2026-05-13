import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { useState, useEffect, startTransition } from "react";
import { Menu, X, Heart, Compass, User as UserIcon, MessageCircle, MessageSquareWarning, LogOut } from "lucide-react";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useQuery } from "@tanstack/react-query";

function NavLink({ href, children, isActive }: { href: string; children: React.ReactNode; isActive: boolean }) {
  const [, navigate] = useLocation();
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        startTransition(() => { navigate(href); });
      }}
      className={`flex cursor-pointer items-center rounded px-5 py-3 ${isActive ? 'bg-[#2D2D2D]' : ''}`}
    >
      {children}
    </a>
  );
}

interface ProfileLayoutProps {
  children: React.ReactNode;
}

export default function ProfileLayout({ children }: ProfileLayoutProps) {
  const { user } = useAuth();
  const { getLocalizedUrl } = useSeoRouting();
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Preload all profile sub-pages when ProfileLayout first mounts.
  // This prevents the React 18 "suspended during synchronous input" warning
  // that occurs when lazy-loaded components haven't been fetched yet at click time.
  useEffect(() => {
    Promise.allSettled([
      import("@/pages/messages"),
      import("@/pages/favorites"),
      import("@/pages/profile-discover"),
      import("@/pages/profile-settings"),
      import("@/pages/notifications-view"),
    ]);
  }, []);

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-count"],
    enabled: !!user,
    refetchInterval: 15000,
  });
  const unreadCount = unreadData?.count ?? 0;
  
  // Get clean path for comparison
  const isActive = (path: string) => {
    const currentPath = location.split('?')[0]; // Remove query params
    return currentPath === path;
  };

  return (
    <div data-layout="user" className="text-white bg-[#0E0E0E] min-h-screen">
      {/* NO HEADER HERE - RadioHeader is provided by PlayerWrapper in App.tsx for ALL pages */}

      <div className="text-white">
        {/* Sidebar Navigation - fixed full-width layout */}
        <div className="
          hidden
          md:fixed md:inset-y-0 md:left-0 md:top-[70px] md:z-10 md:w-64 md:flex-col md:bg-[#151515] md:pt-10
          lg:top-[90px] lg:flex
        ">
          <div className="flex h-full flex-col justify-between px-5">
            {/* Main Navigation Links - Reference: space-y-5 */}
            <div className="space-y-5 pt-10">
              <NavLink href={getLocalizedUrl("/profile/favorites")} isActive={isActive(getLocalizedUrl("/profile/favorites"))}>
                <div className="mr-5"><Heart className="w-6 h-6 text-[#FF4199]" /></div>
                <div className="text-base font-bold">Your Favorites</div>
              </NavLink>

              <NavLink href={getLocalizedUrl("/profile/discover")} isActive={isActive(getLocalizedUrl("/profile/discover"))}>
                <div className="mr-5"><Compass className="w-6 h-6 text-[#FF4199]" /></div>
                <div className="text-base font-bold">Discover</div>
              </NavLink>

              <NavLink href={getLocalizedUrl("/profile/settings")} isActive={isActive(getLocalizedUrl("/profile/settings"))}>
                <div className="mr-5"><UserIcon className="w-6 h-6 text-[#FF4199]" /></div>
                <div className="text-base font-bold">Profile</div>
              </NavLink>

              <NavLink href={getLocalizedUrl("/profile/messages")} isActive={isActive(getLocalizedUrl("/profile/messages"))}>
                <div className="mr-5"><MessageCircle className="w-6 h-6 text-[#FF4199]" /></div>
                <div className="text-base font-bold flex-1">Messages</div>
                {unreadCount > 0 && (
                  <span className="bg-[#FF4199] text-white text-[12px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </NavLink>
            </div>

            {/* Bottom Navigation Links */}
            <div className="mb-4 space-y-5">
              <NavLink href={getLocalizedUrl("/feedback")} isActive={isActive(getLocalizedUrl("/feedback"))}>
                <div className="mr-5"><MessageSquareWarning className="w-6 h-6 text-[#FF4199]" /></div>
                <div className="text-base font-bold">Feedback</div>
              </NavLink>

              <div
                onClick={() => {
                  fetch('/api/auth/logout', { method: 'POST' })
                    .then(() => {
                      window.location.href = '/';
                    })
                    .catch(() => {
                      window.location.href = '/';
                    });
                }}
                className="flex cursor-pointer items-center rounded px-5 py-3"
              >
                <div className="mr-5">
                  <LogOut className="w-6 h-6 text-[#FF4199]" />
                </div>
                <div className="text-base font-bold">Logout</div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area - full width with sidebar offset */}
        <div className="relative w-full">
          <div className="w-full bg-[#0E0E0E] lg:pl-64">
            <div className="px-2 py-8 md:px-8">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}