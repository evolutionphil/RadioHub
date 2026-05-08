import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Bell, CheckCircle, User, Heart, Radio, Calendar, MessageSquare, Settings } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface UserNotification {
  _id: string;
  type: 'new_station' | 'favorite_update' | 'favorite_station' | 'comment_reply' | 'system' | 'promotional' | 'follow' | 'unfollow';
  title: string;
  message: string;
  data?: Record<string, any>;
  isRead: boolean;
  createdAt: string;
  fromUserId?: {
    _id: string;
    fullName?: string;
    username?: string;
    avatar?: string;
  };
}

interface NotificationsResponse {
  notifications: UserNotification[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  unreadCount: number;
}

export default function NotificationsView() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const [selectedTab, setSelectedTab] = useState<string>('all');
  const limit = 20;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/api/user/notifications', page, limit],
    queryFn: async () => {
      const response = await fetch(`/api/user/notifications?page=${page}&limit=${limit}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }
      return response.json() as Promise<NotificationsResponse>;
    },
    staleTime: 30000,
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await fetch(`/api/user/notifications/${notificationId}/read`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to mark notification as read');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/notifications'] });
      // Also invalidate header notification count
      queryClient.invalidateQueries({ queryKey: ['/api/user/notifications', 1, 10] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to mark notification as read",
        variant: "destructive"
      });
    }
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/user/notifications/read-all', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to mark all notifications as read');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/notifications'] });
      toast({
        title: "Success",
        description: "All notifications marked as read",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to mark all notifications as read",
        variant: "destructive"
      });
    }
  });

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'follow':
        return <User className="h-5 w-5 text-blue-400" />;
      case 'favorite_update':
        return <Heart className="h-5 w-5 text-red-400" />;
      case 'new_station':
        return <Radio className="h-5 w-5 text-green-400" />;
      case 'comment_reply':
        return <MessageSquare className="h-5 w-5 text-purple-400" />;
      case 'system':
        return <Settings className="h-5 w-5 text-gray-400" />;
      case 'promotional':
        return <Bell className="h-5 w-5 text-yellow-400" />;
      default:
        return <Bell className="h-5 w-5 text-blue-400" />;
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));

    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else {
      return 'Just now';
    }
  };

  const handleNotificationClick = (notification: UserNotification) => {
    // Mark as read if unread
    if (!notification.isRead) {
      markAsReadMutation.mutate(notification._id);
    }

    // Navigate based on notification type
    switch (notification.type) {
      case 'follow':
      case 'unfollow':
        // Navigate to the user's profile page
        if (notification.fromUserId?.username) {
          setLocation(`/u/${notification.fromUserId.username}`);
        }
        break;
        
      case 'favorite_station':
      case 'new_station':
        // Navigate to station detail page
        if (notification.data?.stationId) {
          setLocation(`/station/${notification.data.stationId}`);
        } else if (notification.data?.stationSlug) {
          setLocation(`/station/${notification.data.stationSlug}`);
        }
        break;
        
      case 'system':
      case 'promotional':
        // For system notifications, maybe navigate to settings or stay on notifications
        // Could add specific navigation based on notification.data if needed
        break;
        
      default:
        // For other types, just mark as read (already handled above)
        break;
    }
  };

  const allNotifications = data?.notifications || [];
  const pagination = data?.pagination;
  const unreadCount = data?.unreadCount || 0;

  // Filter notifications based on selected tab
  const notifications = selectedTab === 'all' 
    ? allNotifications
    : allNotifications.filter(n => {
        switch (selectedTab) {
          case 'social':
            return ['follow', 'unfollow'].includes(n.type);
          case 'stations':
            return ['favorite_station', 'favorite_update', 'new_station'].includes(n.type);
          case 'system':
            return ['system', 'promotional', 'comment_reply'].includes(n.type);
          default:
            return true;
        }
      });

  const tabs = [
    { id: 'all', label: 'All', count: allNotifications.length },
    { id: 'social', label: 'Followers', count: allNotifications.filter(n => ['follow', 'unfollow'].includes(n.type)).length },
    { id: 'stations', label: 'Stations', count: allNotifications.filter(n => ['favorite_station', 'favorite_update', 'new_station'].includes(n.type)).length },
    { id: 'system', label: 'System', count: allNotifications.filter(n => ['system', 'promotional', 'comment_reply'].includes(n.type)).length },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {t('notifications_title', 'Notifications')}
          </h1>
          <p className="text-gray-400 mt-1">
            {unreadCount > 0 
              ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
              : 'All notifications read'
            }
          </p>
        </div>
        
        {unreadCount > 0 && (
          <Button
            onClick={() => markAllAsReadMutation.mutate()}
            disabled={markAllAsReadMutation.isPending}
            variant="outline"
            size="sm"
            className="bg-[#1D1D1D] border-[#2F2F2F] text-white hover:bg-[#2A2A2A]"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Mark All Read
          </Button>
        )}
      </div>

      {/* Notification Tabs */}
      <div className="flex space-x-1 bg-[#1A1A1A] rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setSelectedTab(tab.id);
              setPage(1); // Reset to first page when changing tabs
            }}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              selectedTab === tab.id
                ? 'bg-blue-500 text-white shadow-sm'
                : 'text-gray-400 hover:text-white hover:bg-[#2A2A2A]'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-xs ${
                selectedTab === tab.id
                  ? 'bg-blue-400 text-white'
                  : 'bg-gray-600 text-gray-300'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <Card className="bg-[#1D1D1D] border-[#2F2F2F]">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-4 p-6">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex space-x-4">
                  <Skeleton className="h-10 w-10 rounded-full bg-[#2A2A2A]" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-1/3 bg-[#2A2A2A]" />
                    <Skeleton className="h-3 w-2/3 bg-[#2A2A2A]" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">
                {selectedTab === 'all' 
                  ? 'No notifications yet'
                  : `No ${tabs.find(tab => tab.id === selectedTab)?.label.toLowerCase()} notifications`
                }
              </h3>
              <p className="text-gray-400">
                {selectedTab === 'all' 
                  ? 'When you get notifications, they\'ll appear here.'
                  : `When you get ${tabs.find(tab => tab.id === selectedTab)?.label.toLowerCase()} notifications, they'll appear here.`
                }
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#2F2F2F]">
              {notifications.map((notification) => (
                <div
                  key={notification._id}
                  className={`p-4 cursor-pointer transition-colors ${
                    notification.isRead 
                      ? 'hover:bg-[#1A1A1A]' 
                      : 'bg-[#0F1419] hover:bg-[#14191F] border-l-4 border-[#FF4199]'
                  }`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex space-x-3">
                    <div className="flex-shrink-0">
                      {notification.fromUserId?.avatar ? (
                        <img
                          src={notification.fromUserId.avatar}
                          alt={`${notification.fromUserId.fullName || 'User'} avatar`}
                          className="h-10 w-10 rounded-full object-cover"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            img.style.display = 'none';
                            const parent = img.parentElement;
                            if (parent) {
                              const letter = (notification.fromUserId!.fullName || notification.fromUserId!.username || 'U').charAt(0).toUpperCase();
                              parent.innerHTML = `<div class="h-10 w-10 rounded-full bg-[#2A2A2A] flex items-center justify-center text-white text-sm font-medium">${letter}</div>`;
                            }
                          }}
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-[#2A2A2A] flex items-center justify-center">
                          {getNotificationIcon(notification.type)}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white">
                            {notification.title}
                          </p>
                          <p className="text-sm text-gray-400 mt-1">
                            {notification.message}
                          </p>
                          <div className="flex items-center space-x-3 mt-2">
                            <p className="text-xs text-gray-500">
                              {formatTimeAgo(notification.createdAt)}
                            </p>
                            <Badge 
                              variant="secondary" 
                              className="text-xs bg-[#2A2A2A] text-gray-300"
                            >
                              {notification.type.replace('_', ' ')}
                            </Badge>
                          </div>
                        </div>
                        
                        {!notification.isRead && (
                          <div className="h-2 w-2 bg-[#FF4199] rounded-full ml-2 mt-1 flex-shrink-0" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-center space-x-2">
          <Button
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            variant="outline"
            size="sm"
            className="bg-[#1D1D1D] border-[#2F2F2F] text-white hover:bg-[#2A2A2A]"
          >
            Previous
          </Button>
          
          <span className="text-sm text-gray-400 px-4">
            Page {page} of {pagination.pages}
          </span>
          
          <Button
            onClick={() => setPage(page + 1)}
            disabled={page >= pagination.pages}
            variant="outline"
            size="sm"
            className="bg-[#1D1D1D] border-[#2F2F2F] text-white hover:bg-[#2A2A2A]"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}