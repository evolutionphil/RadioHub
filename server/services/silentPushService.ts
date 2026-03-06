import http2 from 'http2';
import https from 'https';
import jwt from 'jsonwebtoken';
import { PushToken } from '../../shared/mongo-schemas';
import { logger } from '../utils/logger';

export type SilentPushAction = 'cache_refresh' | 'popular_update' | 'genres_update' | 'favorites_sync' | 'clear_cache';

export interface SilentPushPayload {
  action: SilentPushAction;
  country?: string;
  timestamp?: string;
}

interface SilentPushResult {
  totalDevices: number;
  ios: { sent: number; failed: number };
  android: { sent: number; failed: number };
  expo: { sent: number; failed: number };
}

const APNS_BUNDLE_ID = 'com.visiongo.megaradio';
const EXPO_BATCH_LIMIT = 100;

export class SilentPushService {
  private static apnsJwtToken: string | null = null;
  private static apnsJwtExpiry: number = 0;

  private static getAPNsJWT(): string | null {
    const keyContent = process.env.APNS_AUTH_KEY;
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;

    if (!keyContent || !keyId || !teamId) return null;

    const now = Math.floor(Date.now() / 1000);
    if (this.apnsJwtToken && now < this.apnsJwtExpiry - 60) {
      return this.apnsJwtToken;
    }

    try {
      this.apnsJwtToken = jwt.sign({}, keyContent, {
        algorithm: 'ES256',
        issuer: teamId,
        header: { alg: 'ES256', kid: keyId },
        expiresIn: '1h',
      });
      this.apnsJwtExpiry = now + 3600;
      return this.apnsJwtToken;
    } catch (error) {
      logger.error('Failed to generate APNs JWT:', error);
      return null;
    }
  }

  private static async sendAPNsSilentPush(deviceToken: string, payload: SilentPushPayload): Promise<boolean> {
    const jwtToken = this.getAPNsJWT();
    if (!jwtToken) return false;

    const isProduction = process.env.APNS_ENVIRONMENT !== 'sandbox';
    const hostname = isProduction ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';

    const body = JSON.stringify({
      aps: { 'content-available': 1 },
      action: payload.action,
      ...(payload.country ? { country: payload.country } : {}),
      timestamp: payload.timestamp || new Date().toISOString(),
    });

    return new Promise((resolve) => {
      let client: http2.ClientHttp2Session | null = null;
      const timeout = setTimeout(() => {
        if (client) client.close();
        resolve(false);
      }, 10000);

      try {
        client = http2.connect(`https://${hostname}`);

        client.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });

        const headers: http2.OutgoingHttpHeaders = {
          ':method': 'POST',
          ':path': `/3/device/${deviceToken}`,
          'authorization': `bearer ${jwtToken}`,
          'apns-push-type': 'background',
          'apns-priority': '5',
          'apns-topic': APNS_BUNDLE_ID,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        };

        const req = client.request(headers);

        let responseData = '';
        let statusCode = 0;

        req.on('response', (headers) => {
          statusCode = headers[':status'] as number || 0;
        });

        req.on('data', (chunk) => {
          responseData += chunk;
        });

        req.on('end', () => {
          clearTimeout(timeout);
          if (client) client.close();
          if (statusCode === 200) {
            resolve(true);
          } else {
            logger.warn(`APNs silent push failed (${statusCode}): ${responseData}`);
            resolve(false);
          }
        });

        req.on('error', () => {
          clearTimeout(timeout);
          if (client) client.close();
          resolve(false);
        });

        req.write(body);
        req.end();
      } catch {
        clearTimeout(timeout);
        if (client) client.close();
        resolve(false);
      }
    });
  }

  private static async sendFCMSilentPush(fcmToken: string, payload: SilentPushPayload): Promise<boolean> {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const projectId = process.env.FIREBASE_PROJECT_ID;

    if (!serviceAccountJson || !projectId) return false;

    let accessToken: string;
    try {
      accessToken = await this.getFCMAccessToken();
    } catch {
      return false;
    }

    const body = JSON.stringify({
      message: {
        token: fcmToken,
        data: {
          action: payload.action,
          ...(payload.country ? { country: payload.country } : {}),
          timestamp: payload.timestamp || new Date().toISOString(),
        },
        android: { priority: 'normal' },
      },
    });

    return new Promise((resolve) => {
      const options = {
        hostname: 'fcm.googleapis.com',
        port: 443,
        path: `/v1/projects/${projectId}/messages:send`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            logger.warn(`FCM silent push failed (${res.statusCode}): ${data}`);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        logger.error(`FCM request error: ${err.message}`);
        resolve(false);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        resolve(false);
      });

      req.write(body);
      req.end();
    });
  }

  private static fcmAccessToken: string | null = null;
  private static fcmTokenExpiry: number = 0;

  private static async getFCMAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.fcmAccessToken && now < this.fcmTokenExpiry - 60) {
      return this.fcmAccessToken;
    }

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');

    const serviceAccount = JSON.parse(serviceAccountJson);
    const jwtToken = jwt.sign(
      {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      },
      serviceAccount.private_key,
      { algorithm: 'RS256' }
    );

    return new Promise((resolve, reject) => {
      const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwtToken}`;
      const options = {
        hostname: 'oauth2.googleapis.com',
        port: 443,
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.access_token) {
              this.fcmAccessToken = parsed.access_token;
              this.fcmTokenExpiry = now + (parsed.expires_in || 3600);
              resolve(parsed.access_token);
            } else {
              reject(new Error(`FCM token error: ${data}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private static async sendExpoSilentPush(expoTokens: string[], payload: SilentPushPayload): Promise<number> {
    if (expoTokens.length === 0) return 0;

    let totalSent = 0;

    for (let i = 0; i < expoTokens.length; i += EXPO_BATCH_LIMIT) {
      const batch = expoTokens.slice(i, i + EXPO_BATCH_LIMIT);
      const messages = batch.map((token) => ({
        to: token,
        data: {
          action: payload.action,
          ...(payload.country ? { country: payload.country } : {}),
          timestamp: payload.timestamp || new Date().toISOString(),
        },
        _contentAvailable: true,
        priority: 'normal' as const,
      }));

      const sent = await new Promise<number>((resolve) => {
        const body = JSON.stringify(messages);
        const options = {
          hostname: 'exp.host',
          path: '/--/api/v2/push/send',
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              const successCount = Array.isArray(result.data)
                ? result.data.filter((r: any) => r.status === 'ok').length
                : 0;
              resolve(successCount);
            } catch {
              resolve(0);
            }
          });
        });

        req.on('error', () => resolve(0));
        req.setTimeout(15000, () => { req.destroy(); resolve(0); });
        req.write(body);
        req.end();
      });

      totalSent += sent;

      if (i + EXPO_BATCH_LIMIT < expoTokens.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return totalSent;
  }

  private static resolveTokenType(device: { token: string; platform: string; tokenType?: string }): 'expo' | 'apns' | 'fcm' {
    if (device.tokenType && ['expo', 'apns', 'fcm'].includes(device.tokenType)) {
      return device.tokenType as 'expo' | 'apns' | 'fcm';
    }
    if (device.token.startsWith('ExponentPushToken[') || device.token.startsWith('ExpoPushToken[')) {
      return 'expo';
    }
    return device.platform === 'ios' ? 'apns' : 'fcm';
  }

  static async sendSilentPush(options: {
    action: SilentPushAction;
    country?: string;
    userId?: string;
  }): Promise<SilentPushResult> {
    const { action, country, userId } = options;
    const payload: SilentPushPayload = {
      action,
      country,
      timestamp: new Date().toISOString(),
    };

    const filter: any = { isActive: true };
    if (userId) filter.userId = userId;
    if (country) filter.country = country;

    const devices = await PushToken.find(filter).lean();

    const result: SilentPushResult = {
      totalDevices: devices.length,
      ios: { sent: 0, failed: 0 },
      android: { sent: 0, failed: 0 },
      expo: { sent: 0, failed: 0 },
    };

    if (devices.length === 0) return result;

    const apnsDevices: typeof devices = [];
    const fcmDevices: typeof devices = [];
    const expoDevices: typeof devices = [];

    for (const device of devices) {
      const resolvedType = this.resolveTokenType(device);
      if (resolvedType === 'apns') apnsDevices.push(device);
      else if (resolvedType === 'fcm') fcmDevices.push(device);
      else expoDevices.push(device);
    }

    const BATCH_SIZE = 50;
    for (let i = 0; i < apnsDevices.length; i += BATCH_SIZE) {
      const batch = apnsDevices.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((d) => this.sendAPNsSilentPush(d.token, payload))
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) result.ios.sent++;
        else result.ios.failed++;
      }
    }

    for (let i = 0; i < fcmDevices.length; i += BATCH_SIZE) {
      const batch = fcmDevices.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((d) => this.sendFCMSilentPush(d.token, payload))
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) result.android.sent++;
        else result.android.failed++;
      }
    }

    if (expoDevices.length > 0) {
      const tokens = expoDevices.map((d) => d.token);
      const sent = await this.sendExpoSilentPush(tokens, payload);
      result.expo.sent = sent;
      result.expo.failed = tokens.length - sent;
    }

    logger.log(`📱 Silent push [${action}]: iOS ${result.ios.sent}/${apnsDevices.length}, Android ${result.android.sent}/${fcmDevices.length}, Expo ${result.expo.sent}/${expoDevices.length}`);

    return result;
  }

  static isConfigured(): { apns: boolean; fcm: boolean; expo: boolean } {
    return {
      apns: !!(process.env.APNS_AUTH_KEY && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID),
      fcm: !!(process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_PROJECT_ID),
      expo: true,
    };
  }
}
