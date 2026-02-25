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

export function usePushNotifications(): UsePushNotificationsResult {
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

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      error('Push notifications not supported', 'Your browser does not support push notifications.');
      return false;
    }

    setIsLoading(true);
    try {
      const granted = await pushManager.requestPermission();
      setPermission(pushManager.getPermissionStatus());
      
      if (granted) {
        success('Permission Granted', 'You can now receive push notifications!');
      } else {
        error('Permission Denied', 'Push notifications are blocked. Please enable them in your browser settings.');
      }
      
      return granted;
    } catch (err) {
      error('Permission Error', 'Failed to request notification permission.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, success, error]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      error('Not Supported', 'Push notifications are not supported in your browser.');
      return false;
    }

    if (permission !== 'granted') {
      const granted = await requestPermission();
      if (!granted) return false;
    }

    setIsLoading(true);
    try {
      const subscriptionData = await pushManager.subscribe();
      
      if (subscriptionData) {
        setIsSubscribed(true);
        success('Subscribed Successfully', 'You will now receive push notifications!');
        return true;
      } else {
        error('Subscription Failed', 'Failed to subscribe to push notifications.');
        return false;
      }
    } catch (err) {
      error('Subscription Error', 'An error occurred while subscribing to notifications.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, permission, requestPermission, success, error]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      error('Not Supported', 'Push notifications are not supported in your browser.');
      return false;
    }

    setIsLoading(true);
    try {
      const unsubscribed = await pushManager.unsubscribe();
      
      if (unsubscribed) {
        setIsSubscribed(false);
        success('Unsubscribed', 'You will no longer receive push notifications.');
        return true;
      } else {
        error('Unsubscribe Failed', 'Failed to unsubscribe from push notifications.');
        return false;
      }
    } catch (err) {
      error('Unsubscribe Error', 'An error occurred while unsubscribing from notifications.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, success, error]);

  const sendTestNotification = useCallback(async (): Promise<void> => {
    if (!isSubscribed) {
      error('Not Subscribed', 'Please subscribe to push notifications first.');
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
      
      if (result.success) {
        success('Test Sent', 'A test notification has been sent!');
      } else {
        error('Send Failed', result.message || 'Failed to send test notification.');
      }
    } catch (err) {
      error('Send Error', 'An error occurred while sending the test notification.');
    }
  }, [isSubscribed, success, error]);

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