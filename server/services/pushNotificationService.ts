import webpush from 'web-push';
import { User } from '../db-mongo.js';
import { PushToken, IUser } from '../../shared/mongo-schemas';
import https from 'https';

// Configure web-push with VAPID keys (for browser/web push)
// Only configure if keys are present (not available in all environments)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:admin@megaradio.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

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

// Send to Expo push tokens (React Native with expo-notifications)
async function sendExpoNotifications(tokens: string[], payload: NotificationPayload): Promise<number> {
  const expoTokens = tokens.filter(t => t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken['));
  if (expoTokens.length === 0) return 0;

  const messages = expoTokens.map(token => ({
    to: token,
    title: payload.title,
    body: payload.body,
    data: { ...(payload.data || {}), url: payload.url, tag: payload.tag },
    sound: 'default',
    badge: 1,
    channelId: 'default',
  }));

  return new Promise((resolve) => {
    const body = JSON.stringify(messages);
    const options = {
      hostname: 'exp.host',
      path: '/--/api/v2/push/send',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const MAX_RESPONSE_BYTES = 256 * 1024; // 256KB cap on response body
    const REQUEST_TIMEOUT_MS = 10_000;
    const req = https.request({ ...options, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let data = '';
      let total = 0;
      let aborted = false;
      res.on('data', chunk => {
        if (aborted) return;
        total += chunk.length;
        if (total > MAX_RESPONSE_BYTES) {
          aborted = true;
          try { res.destroy(); } catch {}
          return resolve(0);
        }
        data += chunk;
      });
      res.on('end', () => {
        if (aborted) return;
        try {
          const result = JSON.parse(data);
          const successCount = Array.isArray(result.data)
            ? result.data.filter((r: any) => r.status === 'ok').length
            : expoTokens.length;
          resolve(successCount);
        } catch {
          resolve(0);
        }
      });
      res.on('error', () => { if (!aborted) resolve(0); });
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(0); });
    req.write(body);
    req.end();
  });
}

export class PushNotificationService {
  /**
   * Send push notification to a user via their stored mobile push tokens (iOS/Android)
   */
  static async sendToMobileUser(userId: string, payload: NotificationPayload): Promise<boolean> {
    try {
      const pushTokens = await PushToken.find({ userId, isActive: true }).lean();
      if (pushTokens.length === 0) return false;

      const tokens = pushTokens.map(t => t.token);
      const sent = await sendExpoNotifications(tokens, payload);
      return sent > 0;
    } catch {
      return false;
    }
  }

  /**
   * Send a push notification to a specific user (web/browser push via VAPID)
   */
  static async sendToUser(userId: string, payload: NotificationPayload): Promise<boolean> {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
    try {
      const user = await User.findById(userId);
      if (!user?.pushSubscription) return false;

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
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send to user via ALL channels: web push + mobile push tokens
   */
  static async sendToUserAllChannels(userId: string, payload: NotificationPayload): Promise<boolean> {
    const [web, mobile] = await Promise.allSettled([
      this.sendToUser(userId, payload),
      this.sendToMobileUser(userId, payload),
    ]);
    const webOk = web.status === 'fulfilled' && web.value;
    const mobileOk = mobile.status === 'fulfilled' && mobile.value;
    return webOk || mobileOk;
  }

  /**
   * Send a push notification to multiple users
   */
  static async sendToMultipleUsers(userIds: string[], payload: NotificationPayload): Promise<number> {
    // Fan-out concurrency cap. A broadcast to 50k subscribers without a cap
    // creates 50k concurrent fetch promises against Web-Push and Expo APIs:
    // socket descriptor exhaustion, RSS spike from buffered request bodies,
    // and rate-limit bans from upstream. Cap at 25 in-flight workers and
    // stream the work through; total memory is O(concurrency), not O(N).
    const CONCURRENCY = 25;
    let succeeded = 0;
    let cursor = 0;
    const total = userIds.length;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(CONCURRENCY, total); w++) {
      workers.push((async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= total) return;
          try {
            const ok = await this.sendToUserAllChannels(userIds[idx], payload);
            if (ok) succeeded++;
          } catch {}
        }
      })());
    }
    await Promise.all(workers);
    return succeeded;
  }

  /**
   * Send a broadcast notification to all users with push subscriptions
   */
  static async broadcast(payload: NotificationPayload): Promise<number> {
    try {
      const users = await User.find({ pushSubscription: { $exists: true, $ne: null } });
      const userIds = users.map((user: IUser) => (user._id as any).toString());
      return await this.sendToMultipleUsers(userIds, payload);
    } catch {
      return 0;
    }
  }

  /**
   * Send a follow notification to the followed user (both web + mobile)
   */
  static async sendFollowNotification(
    followedUserId: string,
    followerName: string,
    followerSlug?: string
  ): Promise<boolean> {
    const payload: NotificationPayload = {
      title: 'New Follower',
      body: `${followerName} started following you`,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      url: followerSlug ? `/community/profile/${followerSlug}` : '/community',
      tag: 'follow',
      requireInteraction: false,
      data: {
        type: 'follow',
        followerName,
        followerSlug,
        screen: 'Community',
      }
    };

    return await this.sendToUserAllChannels(followedUserId, payload);
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
        { action: 'play', title: '▶️ Play' },
        { action: 'favorite', title: '❤️ Favorite' }
      ],
      data: {
        type: 'now-playing',
        stationName: stationData.name,
        nowPlaying,
        genre: stationData.genre,
        homepage: stationData.homepage
      }
    };

    return await this.sendToUser(userId, payload);
  }

  /**
   * Send a favorite added notification
   */
  static async sendFavoriteAddedNotification(userId: string, stationData: {
    stationId: string;
    name: string;
    country?: string;
    genre?: string;
    favicon?: string;
  }): Promise<boolean> {
    const payload: NotificationPayload = {
      title: '❤️ Station Added to Favorites',
      body: `${stationData.name}${stationData.genre ? ` • ${stationData.genre}` : ''}${stationData.country ? ` • ${stationData.country}` : ''}`,
      icon: stationData.favicon || '/favicon.ico',
      badge: '/favicon.ico',
      url: '/',
      tag: 'favorite-added',
      requireInteraction: false,
      actions: [
        { action: 'view', title: '🎵 Listen Now' }
      ],
      data: {
        type: 'favorite-added',
        stationId: stationData.stationId,
        stationName: stationData.name
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
        { action: 'explore', title: '🔍 Explore' }
      ],
      data: {
        type: 'recommendations',
        stations
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
          await webpush.sendNotification(user.pushSubscription, JSON.stringify({
            title: 'Test',
            body: 'Connection test',
            silent: true
          }));
        } catch (error: any) {
          if (error.statusCode === 410 || error.statusCode === 404) {
            await User.findByIdAndUpdate(user._id, { $unset: { pushSubscription: 1 } });
            removedCount++;
          }
        }
      }

      return removedCount;
    } catch {
      return 0;
    }
  }
}
