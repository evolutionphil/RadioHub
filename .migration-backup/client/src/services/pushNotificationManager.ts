export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export class PushNotificationManager {
  private static instance: PushNotificationManager | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private subscription: PushSubscription | null = null;

  private constructor() {}

  static getInstance(): PushNotificationManager {
    if (!PushNotificationManager.instance) {
      PushNotificationManager.instance = new PushNotificationManager();
    }
    return PushNotificationManager.instance;
  }

  /**
   * Initialize the push notification system
   */
  async initialize(): Promise<boolean> {
    try {
      // Check if service workers are supported
      if (!('serviceWorker' in navigator)) {
        // Service workers not supported
        return false;
      }

      // Check if push notifications are supported
      if (!('PushManager' in window)) {
        // Push messaging not supported
        return false;
      }

      // Register service worker
      this.registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      // Service Worker registered

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;

      // Listen for messages from service worker
      this.setupMessageListener();

      return true;
    } catch (error) {
      // Failed to initialize push notifications
      return false;
    }
  }

  /**
   * Request permission for push notifications
   */
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      // Notifications not supported
      return false;
    }

    const permission = await Notification.requestPermission();
    
    if (permission === 'granted') {
      // Notification permission granted
      return true;
    } else if (permission === 'denied') {
      // Notification permission denied
      return false;
    } else {
      // Notification permission default (not granted)
      return false;
    }
  }

  /**
   * Subscribe to push notifications
   */
  async subscribe(): Promise<PushSubscriptionData | null> {
    try {
      if (!this.registration) {
        throw new Error('Service worker not registered');
      }

      // Get VAPID public key from environment or server
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || await this.getVapidPublicKey();
      
      if (!vapidPublicKey) {
        throw new Error('VAPID public key not available');
      }

      // Subscribe to push notifications
      this.subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlB64ToUint8Array(vapidPublicKey)
      });

      const subscriptionData: PushSubscriptionData = {
        endpoint: this.subscription.endpoint,
        keys: {
          p256dh: this.arrayBufferToBase64(this.subscription.getKey('p256dh')!),
          auth: this.arrayBufferToBase64(this.subscription.getKey('auth')!)
        }
      };

      // Push subscription created

      // Send subscription to server
      await this.sendSubscriptionToServer(subscriptionData);

      return subscriptionData;
    } catch (error) {
      // Failed to subscribe to push notifications
      return null;
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  async unsubscribe(): Promise<boolean> {
    try {
      if (!this.subscription) {
        // No active subscription to unsubscribe
        return true;
      }

      const success = await this.subscription.unsubscribe();
      
      if (success) {
        // Successfully unsubscribed from push notifications
        this.subscription = null;
        
        // Notify server about unsubscription
        await this.removeSubscriptionFromServer();
        
        return true;
      } else {
        // Failed to unsubscribe from push notifications
        return false;
      }
    } catch (error) {
      // Error unsubscribing from push notifications
      return false;
    }
  }

  /**
   * Check if user is subscribed to push notifications
   */
  async isSubscribed(): Promise<boolean> {
    try {
      if (!this.registration) {
        return false;
      }

      this.subscription = await this.registration.pushManager.getSubscription();
      return this.subscription !== null;
    } catch (error) {
      // Error checking subscription status
      return false;
    }
  }

  /**
   * Get current subscription data
   */
  async getSubscription(): Promise<PushSubscriptionData | null> {
    try {
      if (!this.registration) {
        return null;
      }

      this.subscription = await this.registration.pushManager.getSubscription();
      
      if (!this.subscription) {
        return null;
      }

      return {
        endpoint: this.subscription.endpoint,
        keys: {
          p256dh: this.arrayBufferToBase64(this.subscription.getKey('p256dh')!),
          auth: this.arrayBufferToBase64(this.subscription.getKey('auth')!)
        }
      };
    } catch (error) {
      // Error getting subscription
      return null;
    }
  }

  /**
   * Check notification permission status
   */
  getPermissionStatus(): NotificationPermission {
    if (!('Notification' in window)) {
      return 'denied';
    }
    return Notification.permission;
  }

  /**
   * Send subscription to server
   */
  private async sendSubscriptionToServer(subscription: PushSubscriptionData): Promise<void> {
    try {
      const response = await fetch('/api/user/push-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(subscription)
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // Subscription sent to server
    } catch (error) {
      // Failed to send subscription to server
      throw error;
    }
  }

  /**
   * Remove subscription from server
   */
  private async removeSubscriptionFromServer(): Promise<void> {
    try {
      const response = await fetch('/api/user/push-subscription', {
        method: 'DELETE'
      });

      if (response.ok) {
        // Subscription removed from server
      } else {
        // Failed to remove subscription from server
      }
    } catch (error) {
      // Error removing subscription from server
    }
  }

  /**
   * Get VAPID public key from server
   */
  private async getVapidPublicKey(): Promise<string | null> {
    try {
      const response = await fetch('/api/push/vapid-public-key');
      const data = await response.json();
      return data.publicKey || null;
    } catch (error) {
      // Failed to get VAPID public key
      return null;
    }
  }

  /**
   * Convert VAPID key to Uint8Array
   */
  private urlB64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  /**
   * Convert ArrayBuffer to Base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * Setup message listener for service worker communication
   */
  private setupMessageListener(): void {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'NOTIFICATION_ACTION') {
        this.handleNotificationAction(event.data.action, event.data.data);
      }
    });
  }

  /**
   * Handle notification actions from service worker
   */
  private handleNotificationAction(action: string, data: any): void {
    // Notification action received

    switch (action) {
      case 'play':
        // Dispatch custom event for play action
        window.dispatchEvent(new CustomEvent('notification-play', { detail: data }));
        break;
      case 'favorite':
        // Dispatch custom event for favorite action
        window.dispatchEvent(new CustomEvent('notification-favorite', { detail: data }));
        break;
      default:
        // Unknown notification action
    }
  }

  /**
   * Test push notification (for development)
   */
  async testNotification(): Promise<void> {
    if (this.getPermissionStatus() !== 'granted') {
      // Notification permission not granted
      return;
    }

    new Notification('🎵 Test Notification', {
      body: 'This is a test notification from Megaradio',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'test'
    });
  }
}