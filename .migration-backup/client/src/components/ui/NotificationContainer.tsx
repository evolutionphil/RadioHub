import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNotifications } from '@/hooks/useNotifications';
import NotificationItem from './NotificationItem';
import { cn } from '@/lib/utils';
import type { NotificationPosition } from '@/hooks/useNotifications';

interface NotificationContainerProps {
  position?: NotificationPosition;
  maxNotifications?: number;
}

const positionClasses = {
  'top-right': 'top-0 right-0',
  'top-left': 'top-0 left-0',
  'top-center': 'top-0 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-0 right-0',
  'bottom-left': 'bottom-0 left-0',
  'bottom-center': 'bottom-0 left-1/2 -translate-x-1/2'
};

const getAnimationClasses = (position: NotificationPosition, isStackReverse: boolean) => {
  const isBottom = position.includes('bottom');
  const isTop = position.includes('top');
  
  if (isBottom) {
    return isStackReverse ? 'flex-col-reverse' : 'flex-col';
  } else {
    return isStackReverse ? 'flex-col' : 'flex-col';
  }
};

export function NotificationContainer({ 
  position = 'top-right', 
  maxNotifications = 5 
}: NotificationContainerProps) {
  const { notifications, dismiss } = useNotifications();
  
  // Group notifications by position
  const notificationsForPosition = notifications
    .filter(n => (n.position || 'top-right') === position)
    .slice(0, maxNotifications); // Limit number of notifications

  // Create portal root if it doesn't exist
  useEffect(() => {
    const portalId = `notification-portal-${position}`;
    let portalRoot = document.getElementById(portalId);
    
    if (!portalRoot) {
      portalRoot = document.createElement('div');
      portalRoot.id = portalId;
      document.body.appendChild(portalRoot);
    }

    return () => {
      // Cleanup portal when component unmounts
      const existingPortal = document.getElementById(portalId);
      if (existingPortal && existingPortal.children.length === 0) {
        document.body.removeChild(existingPortal);
      }
    };
  }, [position]);

  if (notificationsForPosition.length === 0) {
    return null;
  }

  const portalRoot = document.getElementById(`notification-portal-${position}`);
  
  if (!portalRoot) {
    return null;
  }

  const isBottom = position.includes('bottom');
  const isStackReverse = isBottom;

  return createPortal(
    <div
      className={cn(
        'fixed z-[9999] pointer-events-none p-4 sm:p-6',
        positionClasses[position]
      )}
      aria-live="polite"
      aria-atomic="false"
    >
      <div 
        className={cn(
          'flex gap-3 transition-all duration-300 ease-out',
          getAnimationClasses(position, isStackReverse)
        )}
      >
        {notificationsForPosition.map((notification, index) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onDismiss={dismiss}
            onAction={(action) => {
              action.onClick();
              // Optionally dismiss notification after action
              if (action.variant === 'primary') {
                dismiss(notification.id);
              }
            }}
          />
        ))}
      </div>
    </div>,
    portalRoot
  );
}

export default NotificationContainer;
