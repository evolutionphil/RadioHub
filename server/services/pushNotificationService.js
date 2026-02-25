import webpush from 'web-push';
import { User } from '../db-mongo.js';

// Configure web-push with VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_EMAIL) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  // console.log('✅ VAPID keys configured for push notifications');
} else {
  // console.warn('⚠️ VAPID keys not properly configured for push notifications');
}

export class PushNotificationService {
  /**
   * Send a push notification to a specific user
   * @param {string} userId - The user ID
   * @param {Object} payload - The notification payload
   * @returns {Promise<boolean>} - Success status
   */
  static async sendToUser(userId, payload) {
    try {
      // console.log(`📱 Sending push notification to user ${userId}`);
      
      // Get user's push subscription
      const user = await User.findById(userId).select('pushSubscription');
      
      if (!user || !user.pushSubscription) {
        // console.log(`❌ No push subscription found for user ${userId}`);
        return false;
      }
      
      const subscription = {
        endpoint: user.pushSubscription.endpoint,
        keys: user.pushSubscription.keys
      };
      
      // Send the notification
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      // console.log(`✅ Push notification sent successfully to user ${userId}`);
      return true;
    } catch (error) {
      // console.error(`❌ Failed to send push notification to user ${userId}:`, error);
      
      // If subscription is invalid, remove it from user
      if (error.statusCode === 410 || error.statusCode === 404) {
        try {
          await User.findByIdAndUpdate(userId, {
            $unset: { pushSubscription: 1 }
          });
          // console.log(`🗑️ Removed invalid push subscription for user ${userId}`);
        } catch (cleanupError) {
          // console.error(`Failed to cleanup invalid subscription for user ${userId}:`, cleanupError);
        }
      }
      
      return false;
    }
  }
  
  /**
   * Send a "now playing" notification
   * @param {string} userId - The user ID
   * @param {Object} stationData - Station information
   * @returns {Promise<boolean>} - Success status
   */
  static async sendNowPlayingNotification(userId, stationData) {
    const payload = {
      title: `🎵 Now Playing`,
      body: `${stationData.name}${stationData.nowPlaying ? ` - ${stationData.nowPlaying}` : ''}`,
      icon: stationData.favicon || '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'now-playing',
      data: {
        type: 'now-playing',
        stationName: stationData.name,
        nowPlaying: stationData.nowPlaying,
        artist: stationData.artist,
        title: stationData.title,
        genre: stationData.genre,
        homepage: stationData.homepage
      },
      actions: [
        {
          action: 'open',
          title: 'Open App'
        }
      ],
      requireInteraction: true
    };
    
    return await this.sendToUser(userId, payload);
  }
  
  /**
   * Send a "favorite added" notification
   * @param {string} userId - The user ID
   * @param {Object} stationData - Station information
   * @returns {Promise<boolean>} - Success status
   */
  static async sendFavoriteAddedNotification(userId, stationData) {
    const payload = {
      title: `⭐ Station Added to Favorites`,
      body: `You added "${stationData.name}" to your favorites`,
      icon: stationData.favicon || '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'favorite-added',
      data: {
        type: 'favorite-added',
        stationId: stationData.stationId,
        stationName: stationData.name,
        country: stationData.country,
        genre: stationData.genre
      },
      actions: [
        {
          action: 'open',
          title: 'View Favorites'
        }
      ],
      requireInteraction: false
    };
    
    return await this.sendToUser(userId, payload);
  }
  
  /**
   * Send notifications to multiple users
   * @param {string[]} userIds - Array of user IDs
   * @param {Object} payload - The notification payload
   * @returns {Promise<{sent: number, failed: number}>} - Results summary
   */
  static async sendToMultipleUsers(userIds, payload) {
    let sent = 0;
    let failed = 0;
    
    const promises = userIds.map(async (userId) => {
      const success = await this.sendToUser(userId, payload);
      if (success) {
        sent++;
      } else {
        failed++;
      }
    });
    
    await Promise.all(promises);
    
    // console.log(`📊 Bulk notification results: ${sent} sent, ${failed} failed`);
    return { sent, failed };
  }
  
  /**
   * Send a broadcast notification to all subscribed users
   * @param {Object} payload - The notification payload
   * @param {Object} filter - MongoDB filter for users (optional)
   * @returns {Promise<{sent: number, failed: number}>} - Results summary
   */
  static async broadcastToAllUsers(payload, filter = {}) {
    try {
      // console.log('📡 Broadcasting notification to all subscribed users...');
      
      // Get all users with push subscriptions
      const users = await User.find({
        ...filter,
        pushSubscription: { $exists: true, $ne: null }
      }).select('_id');
      
      const userIds = users.map(user => user._id.toString());
      
      // console.log(`📱 Found ${userIds.length} subscribed users`);
      
      if (userIds.length === 0) {
        return { sent: 0, failed: 0 };
      }
      
      return await this.sendToMultipleUsers(userIds, payload);
    } catch (error) {
      // console.error('❌ Failed to broadcast notifications:', error);
      return { sent: 0, failed: 0 };
    }
  }
}