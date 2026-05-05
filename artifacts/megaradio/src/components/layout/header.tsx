import { Button } from "@/components/ui/button";
import { Menu, Circle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AdminUserMenuDropdown } from "@/components/ui/AdminUserMenuDropdown";

interface HeaderProps {
  onMobileMenuToggle: () => void;
}

export default function Header({ onMobileMenuToggle }: HeaderProps) {
  const { data: stats } = useQuery({
    queryKey: ['/api/dashboard/stats'],
    queryFn: () => api.getDashboardStats(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const formatLastSync = (lastSync: string | Date | null) => {
    if (!lastSync) return "Never";
    const date = new Date(lastSync);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    
    if (hours < 1) return "Less than 1 hour ago";
    if (hours === 1) return "1 hour ago";
    return `${hours} hours ago`;
  };

  return (
    <div className="bg-white shadow-sm border-b border-gray-200">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onMobileMenuToggle}
              className="md:hidden inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
            >
              <Menu className="w-5 h-5" />
            </Button>
            
            {/* Page title */}
            <h2 className="ml-4 md:ml-0 text-base sm:text-lg font-semibold text-gray-900 truncate">
              Radio Station Management
            </h2>
          </div>
          
          {/* Header actions */}
          <div className="flex items-center space-x-2 sm:space-x-4">
            {/* Sync status indicator - hide text on mobile */}
            <div className="flex items-center text-sm text-gray-500">
              <Circle 
                className={`w-2 h-2 mr-1 sm:mr-2 ${
                  stats?.syncStatus.isRunning 
                    ? 'text-warning fill-current' 
                    : 'text-accent fill-current'
                }`} 
              />
              <span className="hidden sm:inline">
                {stats?.syncStatus.isRunning 
                  ? 'Sync in progress...' 
                  : `Last sync: ${formatLastSync(stats?.syncStatus.lastFullSync || null)}`
                }
              </span>
              <span className="sm:hidden">
                {stats?.syncStatus.isRunning ? 'Syncing...' : 'Synced'}
              </span>
            </div>
            
            {/* User profile dropdown */}
            <AdminUserMenuDropdown />
          </div>
        </div>
      </div>
    </div>
  );
}
