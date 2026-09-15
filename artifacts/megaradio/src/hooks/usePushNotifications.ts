import { useState, useEffect, useCallback } from 'react';
import { PushNotificationManager } from '@/services/pushNotificationManager';
import { useNotifications } from './useNotifications';

export interface UsePushNotificationsResult {
  isSupported: boolean;
  isSubscribed: boolean;
  permission: NotificationPermission;
  isLoading: boolean;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  requestPermission: () => Promise<boolean>;
  sendTestNotification: () => Promise<void>;
  sendNowPlayingNotification: (stationData: {
    stationName: string;
    nowPlaying?: string;
    artist?: string;
    title?: string;
    genre?: string;
    favicon?: string;
    homepage?: string;
  }) => Promise<void>;
}

export interface PushNotificationMessages {
  successTitle: string;
  errorTitle: string;
  unsupported: string;
  blocked: string;
  permissionGranted: string;
  permissionDismissed: string;
  subscribed: string;
  unsubscribed: string;
  testSent: string;
  failed: string;
  notSubscribed: string;
}

/** Callers may supply their current locale without changing legacy consumers. */
export function usePushNotifications(messages?: PushNotificationMessages): UsePushNotificationsResult {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isLoading, setIsLoading] = useState(false);
  const { success, error } = useNotifications();

  const pushManager = PushNotificationManager.getInstance();

  // Initialize push notification support
  useEffect(() => {
    const checkSupport = async () => {
      const initialized = await pushManager.initialize();
      setIsSupported(initialized);
      
      if (initialized) {
        const subscribed = await pushManager.isSubscribed();
        setIsSubscribed(subscribed);
        setPermission(pushManager.getPermissionStatus());
      }
    };

    checkSupport();
  }, []);

  // Listen for permission changes
  useEffect(() => {
    if (!isSupported) return;

    const handlePermissionChange = () => {
      setPermission(pushManager.getPermissionStatus());
    };

    // Check for permission changes periodically
    const interval = setInterval(handlePermissionChange, 1000);

    return () => clearInterval(interval);
  }, [isSupported]);

  // Listen for notification actions from service worker
  useEffect(() => {
    const handleNotificationPlay = (event: CustomEvent) => {
      // Handle play action from notification
      // You can dispatch custom events or call functions here
      // For example, start playing the station
    };

    const handleNotificationFavorite = (event: CustomEvent) => {
      // Handle favorite action from notification
      // You can call your favorite station API here
    };

    window.addEventListener('notification-play', handleNotificationPlay as EventListener);
    window.addEventListener('notification-favorite', handleNotificationFavorite as EventListener);

    return () => {
      window.removeEventListener('notification-play', handleNotificationPlay as EventListener);
      window.removeEventListener('notification-favorite', handleNotificationFavorite as EventListener);
    };
  }, []);

  const requestPermission = useCallback(async (announceSuccess = true): Promise<boolean> => {
    if (!isSupported) {
      error(messages?.errorTitle || 'Push notifications not supported', messages?.unsupported || 'Your browser does not support push notifications.');
      return false;
    }

    // Browsers refuse to re-prompt once the user has hard-denied. Calling
    // Notification.requestPermission() in that state silently returns
    // 'denied' without surfacing any UI, so the toast we used to show was
    // confusing ("I clicked enable and got Denied without seeing a prompt").
    // Detect this up front and route the user to the per-browser unblock
    // instructions instead.
    const currentPerm =
      typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : 'denied';
    if (currentPerm === 'denied') {
      setPermission('denied');
      const isChromium = /Chrome|Edg|Brave|Opera/.test(navigator.userAgent);
      const isFirefox = /Firefox/.test(navigator.userAgent);
      const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Edg/.test(navigator.userAgent);
      const detail = isChromium
        ? 'In Chrome/Edge: click the lock icon in the address bar → Site settings → Notifications → Allow → reload.'
        : isFirefox
          ? 'In Firefox: click the lock icon → Connection secure → More information → Permissions → Send notifications → Allow.'
          : isSafari
            ? 'In Safari: Settings → Websites → Notifications → find this site → Allow.'
            : 'Open your browser settings, find this site under Notifications, set it to Allow, then reload.';
      error(messages?.errorTitle || 'Notifications Blocked by Browser', messages?.blocked || detail);
      return false;
    }

    setIsLoading(true);
    try {
      const granted = await pushManager.requestPermission();
      const nextPermission = pushManager.getPermissionStatus();
      setPermission(nextPermission);

      if (granted) {
        if (announceSuccess) success(messages?.successTitle || 'Permission Granted', messages?.permissionGranted || 'You can now receive push notifications!');
      } else {
        // 'default' here means the user dismissed the prompt without choosing.
        error(messages?.errorTitle || 'Permission Not Granted', (nextPermission === 'denied' ? messages?.blocked : messages?.permissionDismissed) || 'You closed the prompt. Click Enable again and choose Allow.');
      }

      return granted;
    } catch (err) {
      error(messages?.errorTitle || 'Permission Error', messages?.failed || 'Failed to request notification permission.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, success, error, messages]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      error(messages?.errorTitle || 'Not Supported', messages?.unsupported || 'Push notifications are not supported in your browser.');
      return false;
    }

    if (permission !== 'granted') {
      // Settings reports the final subscription outcome once. Permission errors
      // remain visible; existing consumers retain their permission success toast.
      const granted = await requestPermission(!messages);
      if (!granted) return false;
    }

    setIsLoading(true);
    try {
      const subscriptionData = await pushManager.subscribe();
      
      if (subscriptionData) {
        setIsSubscribed(true);
        success(messages?.successTitle || 'Subscribed Successfully', messages?.subscribed || 'You will now receive push notifications!');
        return true;
      } else {
        error(messages?.errorTitle || 'Subscription Failed', messages?.failed || 'Failed to subscribe to push notifications.');
        return false;
      }
    } catch (err) {
      error(messages?.errorTitle || 'Subscription Error', messages?.failed || 'An error occurred while subscribing to notifications.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, permission, requestPermission, success, error, messages]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      error(messages?.errorTitle || 'Not Supported', messages?.unsupported || 'Push notifications are not supported in your browser.');
      return false;
    }

    setIsLoading(true);
    try {
      const unsubscribed = await pushManager.unsubscribe();
      
      if (unsubscribed) {
        setIsSubscribed(false);
        success(messages?.successTitle || 'Unsubscribed', messages?.unsubscribed || 'You will no longer receive push notifications.');
        return true;
      } else {
        error(messages?.errorTitle || 'Unsubscribe Failed', messages?.failed || 'Failed to unsubscribe from push notifications.');
        return false;
      }
    } catch (err) {
      error(messages?.errorTitle || 'Unsubscribe Error', messages?.failed || 'An error occurred while unsubscribing from notifications.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, success, error, messages]);

  const sendTestNotification = useCallback(async (): Promise<void> => {
    if (!isSubscribed) {
      error(messages?.errorTitle || 'Not Subscribed', messages?.notSubscribed || 'Please subscribe to push notifications first.');
      return;
    }

    try {
      const response = await fetch('/api/push/send-test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();
      
      if (response.ok && result.success) {
        success(messages?.successTitle || 'Test Sent', messages?.testSent || 'A test notification has been sent!');
      } else {
        error(messages?.errorTitle || 'Send Failed', messages?.failed || result.message || 'Failed to send test notification.');
      }
    } catch (err) {
      error(messages?.errorTitle || 'Send Error', messages?.failed || 'An error occurred while sending the test notification.');
    }
  }, [isSubscribed, success, error, messages]);

  const sendNowPlayingNotification = useCallback(async (stationData: {
    stationName: string;
    nowPlaying?: string;
    artist?: string;
    title?: string;
    genre?: string;
    favicon?: string;
    homepage?: string;
  }): Promise<void> => {
    if (!isSubscribed) {
      return; // Silently fail if not subscribed
    }

    try {
      const response = await fetch('/api/push/now-playing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(stationData)
      });

      const result = await response.json();
      
      if (!result.success) {
        // Failed to send now playing notification
      }
    } catch (err) {
      // Error sending now playing notification
    }
  }, [isSubscribed]);

  return {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    subscribe,
    unsubscribe,
    requestPermission,
    sendTestNotification,
    sendNowPlayingNotification
  };
}
