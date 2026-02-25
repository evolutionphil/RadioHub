import webpush from 'web-push';
import { User } from '../db-mongo.js';
import { IUser } from '../../shared/mongo-schemas';
import { logger } from '../utils/logger';

// Configure web-push with VAPID keys
webpush.setVapidDetails(
  'mailto:admin@megaradio.com', // Replace with your email
  process.env.VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || ''
);

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  image?: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
  data?: any;
}

export class PushNotificationService {
  /**
   * Send a push notification to a specific user
   */
  static async sendToUser(userId: string, payload: NotificationPayload): Promise<boolean> {
    try {
      const user = await User.findById(userId);
      if (!user?.pushSubscription) {
        // console.log(`No push subscription found for user ${userId}`);
        return false;
      }

      const notificationPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || '/favicon.ico',
        badge: payload.badge || '/favicon.ico',
        image: payload.image,
        url: payload.url || '/',
        tag: payload.tag || 'default',
        requireInteraction: payload.requireInteraction || false,
        actions: payload.actions || [],
        data: payload.data || {},
        timestamp: Date.now()
      });

      await webpush.sendNotification(user.pushSubscription, notificationPayload);
      // console.log(`✅ Push notification sent to user ${userId}`);
      return true;
    } catch (error) {
      // console.error(`❌ Failed to send push notification to user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Send a push notification to multiple users
   */
  static async sendToMultipleUsers(userIds: string[], payload: NotificationPayload): Promise<number> {
    const results = await Promise.allSettled(
      userIds.map(userId => this.sendToUser(userId, payload))
    );

    const successCount = results.filter(result => 
      result.status === 'fulfilled' && result.value === true
    ).length;

    // console.log(`📊 Sent push notifications to ${successCount}/${userIds.length} users`);
    return successCount;
  }

  /**
   * Send a broadcast notification to all users with push subscriptions
   */
  static async broadcast(payload: NotificationPayload): Promise<number> {
    try {
      const users = await User.find({ pushSubscription: { $exists: true, $ne: null } });
      const userIds = users.map((user: IUser) => (user._id as any).toString());
      return await this.sendToMultipleUsers(userIds, payload);
    } catch (error) {
      // console.error('❌ Failed to broadcast push notification:', error);
      return 0;
    }
  }

  /**
   * Send a now playing notification for a radio station
   */
  static async sendNowPlayingNotification(userId: string, stationData: {
    name: string;
    nowPlaying?: string;
    artist?: string;
    title?: string;
    genre?: string;
    favicon?: string;
    homepage?: string;
  }): Promise<boolean> {
    const nowPlaying = stationData.nowPlaying || 
                      (stationData.artist && stationData.title ? 
                        `${stationData.artist} - ${stationData.title}` : 
                        stationData.name);

    const payload: NotificationPayload = {
      title: `🎵 ${stationData.name}`,
      body: `${nowPlaying}${stationData.genre ? ` • ${stationData.genre}` : ''}`,
      icon: stationData.favicon || '/favicon.ico',
      badge: '/favicon.ico',
      url: stationData.homepage || '/',
      tag: 'now-playing',
      requireInteraction: false,
      actions: [
        {
          action: 'play',
          title: '▶️ Play'
        },
        {
          action: 'favorite',
          title: '❤️ Favorite'
        }
      ],
      data: {
        type: 'now-playing',
        stationName: stationData.name,
        nowPlaying: nowPlaying,
        genre: stationData.genre,
        homepage: stationData.homepage
      }
    };

    return await this.sendToUser(userId, payload);
  }

  /**
   * Send a station recommendation notification
   */
  static async sendStationRecommendation(userId: string, stations: Array<{
    name: string;
    genre?: string;
    country?: string;
    favicon?: string;
  }>): Promise<boolean> {
    if (stations.length === 0) return false;

    const firstStation = stations[0];
    const additionalCount = stations.length - 1;

    const payload: NotificationPayload = {
      title: '🎧 New Station Recommendations',
      body: `${firstStation.name}${additionalCount > 0 ? ` and ${additionalCount} more stations` : ''} ${firstStation.genre ? `• ${firstStation.genre}` : ''}`,
      icon: firstStation.favicon || '/favicon.ico',
      badge: '/favicon.ico',
      url: '/',
      tag: 'recommendations',
      requireInteraction: false,
      actions: [
        {
          action: 'explore',
          title: '🔍 Explore'
        }
      ],
      data: {
        type: 'recommendations',
        stations: stations
      }
    };

    return await this.sendToUser(userId, payload);
  }

  /**
   * Clean up invalid push subscriptions
   */
  static async cleanupInvalidSubscriptions(): Promise<number> {
    try {
      const users = await User.find({ pushSubscription: { $exists: true, $ne: null } });
      let removedCount = 0;

      for (const user of users as IUser[]) {
        try {
          // Test the subscription with a minimal payload
          await webpush.sendNotification(user.pushSubscription, JSON.stringify({
            title: 'Test',
            body: 'Connection test',
            silent: true
          }));
        } catch (error: any) {
          // If subscription is invalid (410 Gone or 404 Not Found), remove it
          if (error.statusCode === 410 || error.statusCode === 404) {
            await User.findByIdAndUpdate(user._id, { $unset: { pushSubscription: 1 } });
            removedCount++;
            // console.log(`🧹 Removed invalid push subscription for user ${user._id}`);
          }
        }
      }

      // console.log(`🧹 Cleaned up ${removedCount} invalid push subscriptions`);
      return removedCount;
    } catch (error) {
      // console.error('❌ Failed to cleanup push subscriptions:', error);
      return 0;
    }
  }
}