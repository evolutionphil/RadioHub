import { useAuth } from "@/hooks/useAuth";
import { Link, useLocation } from "wouter";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useSeoRouting } from "@/hooks/useSeoRouting";

interface ProfileLayoutProps {
  children: React.ReactNode;
}

export default function ProfileLayout({ children }: ProfileLayoutProps) {
  const { user } = useAuth();
  const { getLocalizedUrl } = useSeoRouting();
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
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
              <Link href={getLocalizedUrl("/profile/favorites")}>
                <div 
                  className={`flex cursor-pointer items-center rounded px-5 py-3 ${isActive(getLocalizedUrl("/profile/favorites")) ? 'bg-[#2D2D2D]' : ''}`}
                >
                  <div className="mr-5">
                    <img src="/favorites.png" alt="Favorites" className="w-6 h-6" />
                  </div>
                  <div className="text-base font-bold">Your Favorites</div>
                </div>
              </Link>

              <Link href={getLocalizedUrl("/profile/discover")}>
                <div 
                  className={`flex cursor-pointer items-center rounded px-5 py-3 ${isActive(getLocalizedUrl("/profile/discover")) ? 'bg-[#2D2D2D]' : ''}`}
                >
                  <div className="mr-5">
                    <img src="/discovery.png" alt="Discover" className="w-6 h-6" />
                  </div>
                  <div className="text-base font-bold">Discover</div>
                </div>
              </Link>

              <Link href={getLocalizedUrl("/profile/settings")}>
                <div 
                  className={`flex cursor-pointer items-center rounded px-5 py-3 ${isActive(getLocalizedUrl("/profile/settings")) ? 'bg-[#2D2D2D]' : ''}`}
                >
                  <div className="mr-5">
                    <img src="/profile.png" alt="Profile" className="w-6 h-6" />
                  </div>
                  <div className="text-base font-bold">Profile</div>
                </div>
              </Link>

              <Link href={getLocalizedUrl("/profile/messages")}>
                <div 
                  className={`flex cursor-pointer items-center rounded px-5 py-3 ${isActive(getLocalizedUrl("/profile/messages")) ? 'bg-[#2D2D2D]' : ''}`}
                >
                  <div className="mr-5">
                    <img src="/sms.png" alt="Messages" className="w-6 h-6" />
                  </div>
                  <div className="text-base font-bold">Messages</div>
                </div>
              </Link>

              <Link href={getLocalizedUrl("/profile/records")}>
                <div 
                  className={`flex cursor-pointer items-center rounded px-5 py-3 ${isActive(getLocalizedUrl("/profile/records")) ? 'bg-[#2D2D2D]' : ''}`}
                >
                  <div className="mr-5">
                    <img src="/rec.png" alt="Records" className="w-6 h-6" />
                  </div>
                  <div className="text-base font-bold">Records</div>
                </div>
              </Link>
            </div>

            {/* Bottom Navigation Links */}
            <div className="mb-4 space-y-5">
              <Link href={getLocalizedUrl("/feedback")}>
                <div 
                  className={`flex cursor-pointer items-center rounded px-5 py-3 ${isActive(getLocalizedUrl("/feedback")) ? 'bg-[#2D2D2D]' : ''}`}
                >
                  <div className="mr-5">
                    <img src="/feedback.png" alt="Feedback" className="w-6 h-6" />
                  </div>
                  <div className="text-base font-bold">Feedback</div>
                </div>
              </Link>

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
                  <img src="/logout.png" alt="Logout" className="w-6 h-6" />
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