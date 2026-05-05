import { useState, useCallback, useRef } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'loading';
export type NotificationPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';

export interface NotificationAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'destructive';
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number; // in milliseconds, 0 for persistent
  position?: NotificationPosition;
  actions?: NotificationAction[];
  persistent?: boolean;
  showProgress?: boolean;
  icon?: React.ReactNode;
  onDismiss?: () => void;
  createdAt: number;
}

export interface NotificationOptions {
  type?: NotificationType;
  title: string;
  message?: string;
  duration?: number;
  position?: NotificationPosition;
  actions?: NotificationAction[];
  persistent?: boolean;
  showProgress?: boolean;
  icon?: React.ReactNode;
  onDismiss?: () => void;
}

// Global notification store
let globalNotifications: Notification[] = [];
let notificationListeners: Set<(notifications: Notification[]) => void> = new Set();

const generateId = () => Math.random().toString(36).substr(2, 9);

// Global notification manager
export const notificationManager = {
  add: (options: NotificationOptions): string => {
    const id = generateId();
    const notification: Notification = {
      id,
      type: options.type || 'info',
      title: options.title,
      message: options.message,
      duration: options.duration !== undefined ? options.duration : 5000,
      position: options.position || 'top-right',
      actions: options.actions,
      persistent: options.persistent || false,
      showProgress: options.showProgress !== undefined ? options.showProgress : true,
      icon: options.icon,
      onDismiss: options.onDismiss,
      createdAt: Date.now()
    };

    globalNotifications = [...globalNotifications, notification];
    notificationListeners.forEach(listener => listener(globalNotifications));

    // Auto-dismiss if not persistent and has duration
    if (!notification.persistent && notification.duration && notification.duration > 0) {
      setTimeout(() => {
        notificationManager.dismiss(id);
      }, notification.duration);
    }

    return id;
  },

  dismiss: (id: string): void => {
    const notification = globalNotifications.find(n => n.id === id);
    if (notification?.onDismiss) {
      notification.onDismiss();
    }
    globalNotifications = globalNotifications.filter(n => n.id !== id);
    notificationListeners.forEach(listener => listener(globalNotifications));
  },

  dismissAll: (): void => {
    globalNotifications.forEach(notification => {
      if (notification.onDismiss) {
        notification.onDismiss();
      }
    });
    globalNotifications = [];
    notificationListeners.forEach(listener => listener(globalNotifications));
  },

  update: (id: string, updates: Partial<Notification>): void => {
    globalNotifications = globalNotifications.map(notification => 
      notification.id === id ? { ...notification, ...updates } : notification
    );
    notificationListeners.forEach(listener => listener(globalNotifications));
  },

  getAll: (): Notification[] => globalNotifications,

  subscribe: (listener: (notifications: Notification[]) => void): (() => void) => {
    notificationListeners.add(listener);
    return () => notificationListeners.delete(listener);
  }
};

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>(globalNotifications);
  const timeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Subscribe to global notifications
  useState(() => {
    const unsubscribe = notificationManager.subscribe(setNotifications);
    return unsubscribe;
  });

  const notify = useCallback((options: NotificationOptions): string => {
    return notificationManager.add(options);
  }, []);

  // Convenience methods
  const success = useCallback((title: string, message?: string, options?: Partial<NotificationOptions>): string => {
    return notify({ ...options, type: 'success', title, message });
  }, [notify]);

  const error = useCallback((title: string, message?: string, options?: Partial<NotificationOptions>): string => {
    return notify({ ...options, type: 'error', title, message });
  }, [notify]);

  const warning = useCallback((title: string, message?: string, options?: Partial<NotificationOptions>): string => {
    return notify({ ...options, type: 'warning', title, message });
  }, [notify]);

  const info = useCallback((title: string, message?: string, options?: Partial<NotificationOptions>): string => {
    return notify({ ...options, type: 'info', title, message });
  }, [notify]);

  const loading = useCallback((title: string, message?: string, options?: Partial<NotificationOptions>): string => {
    return notify({ 
      ...options, 
      type: 'loading', 
      title, 
      message, 
      persistent: true,
      showProgress: false
    });
  }, [notify]);

  const dismiss = useCallback((id: string): void => {
    const timeout = timeoutRefs.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeoutRefs.current.delete(id);
    }
    notificationManager.dismiss(id);
  }, []);

  const dismissAll = useCallback((): void => {
    timeoutRefs.current.forEach(timeout => clearTimeout(timeout));
    timeoutRefs.current.clear();
    notificationManager.dismissAll();
  }, []);

  const update = useCallback((id: string, updates: Partial<Notification>): void => {
    notificationManager.update(id, updates);
  }, []);

  return {
    notifications,
    notify,
    success,
    error,
    warning,
    info,
    loading,
    dismiss,
    dismissAll,
    update
  };
}

// Global notification methods for use outside React components
export const toast = {
  success: (title: string, message?: string, options?: Partial<NotificationOptions>) => 
    notificationManager.add({ ...options, type: 'success', title, message }),
  
  error: (title: string, message?: string, options?: Partial<NotificationOptions>) => 
    notificationManager.add({ ...options, type: 'error', title, message }),
  
  warning: (title: string, message?: string, options?: Partial<NotificationOptions>) => 
    notificationManager.add({ ...options, type: 'warning', title, message }),
  
  info: (title: string, message?: string, options?: Partial<NotificationOptions>) => 
    notificationManager.add({ ...options, type: 'info', title, message }),
  
  loading: (title: string, message?: string, options?: Partial<NotificationOptions>) => 
    notificationManager.add({ 
      ...options, 
      type: 'loading', 
      title, 
      message, 
      persistent: true,
      showProgress: false
    }),
  
  dismiss: notificationManager.dismiss,
  dismissAll: notificationManager.dismissAll,
  update: notificationManager.update
};
