import { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info, Loader2, Music } from 'lucide-react';
import { Button } from './button';
import { Progress } from './progress';
import { cn } from '@/lib/utils';
import type { Notification, NotificationAction } from '@/hooks/useNotifications';

interface NotificationItemProps {
  notification: Notification;
  onDismiss: (id: string) => void;
  onAction?: (action: NotificationAction) => void;
}

const typeConfig = {
  success: {
    icon: CheckCircle,
    className: 'border-green-500/50 bg-green-950/50',
    iconClassName: 'text-green-400',
    progressClassName: 'bg-green-600'
  },
  error: {
    icon: AlertCircle,
    className: 'border-red-500/50 bg-red-950/50',
    iconClassName: 'text-red-400',
    progressClassName: 'bg-red-600'
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-yellow-500/50 bg-yellow-950/50',
    iconClassName: 'text-yellow-400',
    progressClassName: 'bg-yellow-600'
  },
  info: {
    icon: Info,
    className: 'border-blue-500/50 bg-blue-950/50',
    iconClassName: 'text-blue-400',
    progressClassName: 'bg-blue-600'
  },
  loading: {
    icon: Loader2,
    className: 'border-purple-500/50 bg-purple-950/50',
    iconClassName: 'text-purple-400 animate-spin',
    progressClassName: 'bg-purple-600'
  }
};

export function NotificationItem({ notification, onDismiss, onAction }: NotificationItemProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);

  const config = typeConfig[notification.type];
  const Icon = notification.icon ? () => <>{notification.icon}</> : config.icon;

  useEffect(() => {
    // Animate in
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (notification.persistent || !notification.duration || notification.duration <= 0) {
      return;
    }

    let startTime = Date.now();
    let pausedTime = 0;

    const updateProgress = () => {
      if (isPaused) {
        pausedTime += 50;
        return;
      }

      const elapsed = Date.now() - startTime - pausedTime;
      const remaining = Math.max(0, 100 - (elapsed / notification.duration!) * 100);
      
      setProgress(remaining);
      
      if (remaining <= 0) {
        handleDismiss();
      }
    };

    const interval = setInterval(updateProgress, 50);
    return () => clearInterval(interval);
  }, [notification.persistent, notification.duration, isPaused]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(notification.id);
    }, 300); // Match animation duration
  };

  const handleMouseEnter = () => {
    if (notification.showProgress) {
      setIsPaused(true);
    }
  };

  const handleMouseLeave = () => {
    if (notification.showProgress) {
      setIsPaused(false);
    }
  };

  const handleActionClick = (action: NotificationAction) => {
    if (onAction) {
      onAction(action);
    } else {
      action.onClick();
    }
  };

  return (
    <div
      className={cn(
        'w-full max-w-sm overflow-hidden bg-[#1a1a1a] border rounded-lg shadow-lg pointer-events-auto transition-all duration-300 ease-out transform',
        config.className,
        isVisible && !isExiting ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-95'
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Progress bar */}
      {notification.showProgress && !notification.persistent && notification.duration && notification.duration > 0 && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gray-700/50">
          <div 
            className={cn('h-full transition-all duration-75 ease-linear', config.progressClassName)}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start">
          {/* Icon */}
          <div className="flex-shrink-0">
            <Icon className={cn('w-6 h-6', config.iconClassName)} />
          </div>

          {/* Content */}
          <div className="ml-3 w-0 flex-1">
            <h4 className="text-sm font-semibold text-white">
              {notification.title}
            </h4>
            {notification.message && (
              <p className="mt-1 text-sm text-gray-300">
                {notification.message}
              </p>
            )}
            
            {/* Actions */}
            {notification.actions && notification.actions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {notification.actions.map((action, index) => (
                  <Button
                    key={index}
                    size="sm"
                    variant={action.variant === 'primary' ? 'default' : action.variant === 'destructive' ? 'destructive' : 'secondary'}
                    onClick={() => handleActionClick(action)}
                    className="text-xs"
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Close button */}
          <div className="ml-4 flex-shrink-0">
            <button
              onClick={handleDismiss}
              className="inline-flex text-gray-400 hover:text-white transition-colors bg-transparent hover:bg-white/10 rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-white/20"
              aria-label="Close notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NotificationItem;
