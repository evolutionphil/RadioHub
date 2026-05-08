import type { Express } from "express";
import mongoose from 'mongoose';
import { TvLoginCode, UserDevice, CastCommand, CastNowPlaying, PushToken, AuthToken, User, CastSession, UserFollow, Station, Genre } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';
import { TV_STATION_PROJECTION, tvSlimStation, tvSlimGenre } from './shared-utils';
import { normalizeCountryFilter } from '../utils/normalize-country';
import CacheManager from '../cache';
import { PrecomputedGenresService } from '../services/precomputed-genres';

export function registerMobileTvRoutes(app: Express, deps: any) {
  const { requireAuth, generateAuthToken } = deps;

  // ==================== App Static Pages API (for mobile apps) ====================

  // GET /api/app/pages - Returns all static page content for mobile apps
  app.get("/api/app/pages", (req, res) => {
    const lastUpdated = "2026-03-28";
    
    const aboutContent = `About Mega Radio

Mega Radio is a global radio streaming platform providing access to over 40,000 radio stations from around the world. Our mission is to connect listeners with the best live radio content, wherever they are.

Our Mission
We believe everyone should have easy access to live radio from around the globe. Mega Radio brings together thousands of stations across every genre, language, and country — all in one app.

Features
- Access to 40,000+ radio stations worldwide
- Multi-platform support: Web, iOS, Android, Samsung TV, LG TV
- Personalized recommendations and favorites
- Cast from mobile to TV
- Available in 57 languages
- High-quality audio streaming

Contact
For questions, feedback, or partnerships, reach us at info@themegaradio.com`;

    const termsContent = `Terms and Conditions
Last updated: ${lastUpdated}

1. Acceptance of Terms
By accessing and using Mega Radio's services, you accept and agree to be bound by the terms and provision of this agreement. These Terms of Service govern your use of our radio streaming platform.

2. Description of Service
Mega Radio provides access to a collection of internet radio stations and streaming audio content. Our service allows users to discover, listen to, and enjoy radio stations from around the world.

3. User Accounts
- You must provide accurate and complete information when creating an account
- You are responsible for maintaining the confidentiality of your account credentials
- You must notify us immediately of any unauthorized use of your account
- One person or legal entity may not maintain more than one account

4. Acceptable Use
You agree not to:
- Use the service for any unlawful purposes or activities
- Attempt to gain unauthorized access to our systems or other users' accounts
- Interfere with or disrupt the service or servers connected to the service
- Reproduce, distribute, or create derivative works from our content without permission
- Use automated systems to access the service without our written consent
- Upload or transmit viruses, malware, or other harmful code

5. Intellectual Property
The service and its original content are and will remain the exclusive property of Mega Radio and its licensors. The service is protected by copyright, trademark, and other laws. Our trademarks may not be used without our prior written consent.

6. Content and Radio Stations
We aggregate and provide access to radio stations and content from various sources. We do not own or control the content of these radio stations. Station availability and content quality may vary and are subject to the policies of individual broadcasters.

7. Privacy
Your privacy is important to us. Please review our Privacy Policy, which also governs your use of the service, to understand our practices.

8. Disclaimers
The service is provided "as is" without any representations or warranties, express or implied. We make no representations or warranties in relation to this service or the information and materials provided on this service.

9. Limitation of Liability
In no event shall Mega Radio, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential, or punitive damages arising out of your use of the service.

10. Termination
We may terminate or suspend your account and bar access to the service immediately, without prior notice or liability, under our sole discretion, for any reason whatsoever and without limitation, including but not limited to a breach of the Terms.

11. Changes to Terms
We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days notice prior to any new terms taking effect.

12. Subscriptions & Auto-Renewal

MegaRadio offers the following auto-renewable subscriptions:

MegaRadio Premium (Monthly)
- Price: €3.99/month
- Includes: Ad-free listening, HD audio quality, Spotify/YouTube integration, and all premium features
- Free Trial: 7-day free trial for first-time subscribers
- After the trial period ends, the subscription automatically renews at €3.99/month
- Any unused portion of the free trial period will be forfeited when purchasing a subscription

Remove Ads (Yearly)
- Price: €5.99/year
- Includes: Removes all advertisements from the app
- Auto-renews at €5.99/year

Payment & Cancellation
- Payment will be charged to your Apple ID / Google Play account at the confirmation of purchase
- Subscriptions automatically renew unless auto-renew is turned off at least 24 hours before the end of the current period
- Your account will be charged for renewal within 24 hours prior to the end of the current period
- You can manage and cancel your subscriptions by going to your device's account settings:
  - iOS: Settings > Apple ID > Subscriptions
  - Android: Google Play Store > Subscriptions
- No cancellation of the current subscription is allowed during the active subscription period

13. Contact Information
If you have any questions about these Terms and Conditions, please contact us at legal@themegaradio.com

Links
- Privacy Policy: https://themegaradio.com/en/pages/privacy-policy
- Terms and Conditions: https://themegaradio.com/en/pages/terms-and-conditions`;

    const privacyContent = `Privacy Policy
Last updated: ${lastUpdated}

1. Introduction
At Mega Radio ("we," "our," or "us"), we respect your privacy and are committed to protecting your personal data. This privacy policy explains how we collect, use, and safeguard your information when you use our radio streaming service.

2. Information We Collect

Personal Information
When you create an account or contact us, we may collect:
- Name and email address
- Username and password
- Profile information and preferences
- Communication history with our support team

Usage Information
We automatically collect information about how you use our service:
- Listening history and preferences
- Device information and IP address
- Browser type and operating system
- Time and duration of your sessions

3. How We Use Your Information
- To provide and improve our radio streaming service
- To personalize your listening experience
- To communicate with you about service updates
- To provide customer support
- To analyze usage patterns and improve our platform
- To comply with legal obligations

4. Information Sharing
We do not sell, trade, or rent your personal information. We may share your information only in these circumstances:
- With your explicit consent
- To comply with legal requirements
- To protect our rights and property
- With trusted service providers who assist in our operations
- In connection with a business transfer or merger

5. Data Security
We implement appropriate technical and organizational measures to protect your personal data against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the internet is 100% secure.

6. Your Rights
You have the right to:
- Access your personal data
- Correct inaccurate information
- Delete your account and all associated data (available in app under Profile > Delete Account)
- Export your data
- Opt out of certain communications
- Restrict processing of your data
- Upon account deletion, all personal data is removed within 30 days in compliance with GDPR

7. Cookies and Tracking
We use cookies and similar technologies to enhance your experience, analyze usage, and provide personalized content. You can control cookie settings through your browser preferences.

8. Third-Party Links
Our service may contain links to third-party websites. We are not responsible for the privacy practices of these external sites. We encourage you to review their privacy policies.

9. Changes to This Policy
We may update this privacy policy from time to time. We will notify you of any material changes by posting the new policy on this page and updating the "last updated" date.

10. Contact Us
If you have any questions about this privacy policy or our data practices, please contact us at privacy@themegaradio.com`;

    res.json({
      success: true,
      lastUpdated,
      pages: {
        about: {
          title: "About Mega Radio",
          content: aboutContent,
          lastUpdated
        },
        terms: {
          title: "Terms and Conditions",
          content: termsContent,
          lastUpdated
        },
        privacy: {
          title: "Privacy Policy",
          content: privacyContent,
          lastUpdated
        }
      }
    });
  });

  // GET /api/app/info - Returns basic app info (version, links, social)
  app.get("/api/app/info", (req, res) => {
    res.json({
      success: true,
      app: {
        name: "Mega Radio",
        version: "1.0.0",
        website: "https://themegaradio.com",
        supportEmail: "info@themegaradio.com",
        social: {
          facebook: "https://facebook.com/themegaradio",
          instagram: "https://instagram.com/themegaradio",
          twitter: "https://twitter.com/themegaradio"
        },
        links: {
          terms: "https://themegaradio.com/en/terms-and-conditions",
          privacy: "https://themegaradio.com/en/privacy-policy",
          about: "https://themegaradio.com/en/about-us",
          contact: "https://themegaradio.com/en/contact",
          apiDocs: "https://themegaradio.com/en/api",
          appStore: "",
          playStore: ""
        }
      }
    });
  });

  // ==================== Push Notification Token Management ====================

  app.post("/api/user/push-token", async (req, res) => {
    try {
      const { token, platform, deviceName, country, language, tokenType } = req.body;

      if (!token || !platform) {
        return void res.status(400).json({ success: false, message: "token and platform are required" });
      }

      if (!['ios', 'android'].includes(platform)) {
        return void res.status(400).json({ success: false, message: "platform must be 'ios' or 'android'" });
      }

      let resolvedUserId = null;
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) resolvedUserId = tokenDoc.userId;
      } else if ((req as any).session?.passport?.user) {
        resolvedUserId = (req as any).session.passport.user;
      }

      let detectedTokenType = tokenType || 'expo';
      if (!tokenType) {
        if (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')) {
          detectedTokenType = 'expo';
        } else if (platform === 'ios') {
          detectedTokenType = 'apns';
        } else {
          detectedTokenType = 'fcm';
        }
      }

      await PushToken.findOneAndUpdate(
        { token },
        {
          token,
          userId: resolvedUserId,
          platform,
          tokenType: detectedTokenType,
          deviceName: deviceName || '',
          country: country || '',
          language: language || '',
          isActive: true,
          updatedAt: new Date()
        },
        { upsert: true, returnDocument: 'after' }
      );

      res.json({ success: true, message: "Push token saved successfully" });
    } catch (error) {
      console.error("Error saving push token:", error);
      res.status(500).json({ success: false, message: "Failed to save push token" });
    }
  });

  app.delete("/api/user/push-token", async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return void res.status(400).json({ success: false, message: "token is required" });
      }

      let resolvedUserId = null;
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) resolvedUserId = tokenDoc.userId;
      } else if ((req as any).session?.passport?.user) {
        resolvedUserId = (req as any).session.passport.user;
      }

      const filter: any = { token };
      if (resolvedUserId) {
        filter.$or = [{ userId: resolvedUserId }, { userId: null }];
      }

      const result = await PushToken.findOneAndUpdate(
        filter,
        { isActive: false, updatedAt: new Date() }
      );

      if (!result) {
        return void res.status(404).json({ success: false, message: "Push token not found" });
      }

      res.json({ success: true, message: "Push token deactivated" });
    } catch (error) {
      console.error("Error deactivating push token:", error);
      res.status(500).json({ success: false, message: "Failed to deactivate push token" });
    }
  });

  // MOBILE AUTH: Refresh/validate token
  app.get("/api/auth/mobile/me", async (req, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!token) {
        return void res.json({ authenticated: false, user: null });
      }

      const tokenDoc = await AuthToken.findOne({
        token,
        isRevoked: false,
        expiresAt: { $gt: new Date() }
      });

      if (!tokenDoc) {
        return void res.json({ authenticated: false, user: null });
      }

      tokenDoc.lastUsedAt = new Date();
      await tokenDoc.save();

      const user = await User.findById(tokenDoc.userId)
        .select('-passwordHash -emailVerificationToken -resetPasswordToken')
        .lean() as any;

      if (!user) {
        return void res.json({ authenticated: false, user: null });
      }

      const actualFollowersCount = await UserFollow.countDocuments({ followingUserId: user._id });
      const actualFollowingCount = await UserFollow.countDocuments({ userId: user._id });

      res.json({
        authenticated: true,
        token: { expiresAt: tokenDoc.expiresAt, deviceType: tokenDoc.deviceType },
        user: {
          _id: user._id,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          slug: user.slug,
          avatar: user.avatar,
          role: user.role,
          followersCount: actualFollowersCount,
          followingCount: actualFollowingCount,
          favoriteStationsCount: user.favoriteStationsCount || 0,
          totalListeningTime: user.totalListeningTime || 0,
          isPublicProfile: user.isPublicProfile,
        }
      });
    } catch (error) {
      console.error('Mobile me error:', error);
      res.status(500).json({ error: 'Authentication check failed' });
    }
  });

  // MOBILE AUTH: Logout (revoke token)
  app.post("/api/auth/mobile/logout", async (req, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (token) {
        await AuthToken.findOneAndUpdate({ token }, { isRevoked: true });
      }

      res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      console.error('Mobile logout error:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  // MOBILE AUTH: Logout from all devices
  app.post("/api/auth/mobile/logout-all", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return void res.status(401).json({ error: 'Authentication required' });
      }

      const result = await AuthToken.updateMany(
        { userId: new mongoose.Types.ObjectId(userId), isRevoked: false },
        { isRevoked: true }
      );

      res.json({ success: true, message: 'All devices logged out', revokedCount: result.modifiedCount });
    } catch (error) {
      console.error('Mobile logout-all error:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  // ==================== TV AUTH: Device Code Login Flow ====================

  const tvCodeAttempts = new Map<string, { count: number; resetAt: number }>();
  const TV_CODE_MAX_ATTEMPTS = 10;
  const TV_CODE_WINDOW_MS = 10 * 60 * 1000;
  // Hard-cap to prevent unbounded growth on IP sprays before the cleanup interval runs.
  const TV_CODE_ATTEMPTS_MAX = 50_000;
  const evictOldestTvCode = () => {
    if (tvCodeAttempts.size >= TV_CODE_ATTEMPTS_MAX) {
      const oldest = tvCodeAttempts.keys().next().value;
      if (oldest !== undefined) tvCodeAttempts.delete(oldest);
    }
  };
  // Clean expired entries every 5min instead of 1h to limit memory growth.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of tvCodeAttempts) {
      if (now > data.resetAt) tvCodeAttempts.delete(ip);
    }
  }, 5 * 60 * 1000);

  // 1. TV requests a 6-digit login code
  app.post('/api/auth/tv/code', async (req: any, res) => {
    try {
      const { deviceId, platform = 'other' } = req.body;

      if (!deviceId) {
        return void res.status(400).json({ error: 'deviceId is required' });
      }

      if (!['tizen', 'webos', 'other'].includes(platform)) {
        return void res.status(400).json({ error: 'platform must be tizen, webos, or other' });
      }

      await TvLoginCode.updateMany(
        { deviceId, status: 'pending' },
        { $set: { status: 'expired' } }
      );

      let code: string;
      let attempts = 0;
      do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
        const existing = await TvLoginCode.findOne({ code, status: 'pending', expiresAt: { $gt: new Date() } });
        if (!existing) break;
        attempts++;
      } while (attempts < 10);

      if (attempts >= 10) {
        return void res.status(503).json({ error: 'Unable to generate unique code. Try again.' });
      }

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await TvLoginCode.create({
        code,
        deviceId,
        platform,
        status: 'pending',
        expiresAt,
        createdAt: new Date(),
      });

      logger.info(`[TV AUTH] Code ${code} generated for device ${deviceId} (${platform})`);

      res.json({
        success: true,
        code,
        expiresIn: 600,
      });
    } catch (error: any) {
      console.error('[TV AUTH] Code generation error:', error.message);
      res.status(500).json({ error: 'Failed to generate code' });
    }
  });

  // 2. TV polls for code status
  app.get('/api/auth/tv/code/:code/status', async (req: any, res) => {
    try {
      const { code } = req.params;
      const { deviceId } = req.query;

      if (!deviceId) {
        return void res.status(400).json({ error: 'deviceId query parameter is required' });
      }

      const loginCode = await TvLoginCode.findOne({ code, deviceId });

      if (!loginCode) {
        return void res.status(404).json({ status: 'expired', message: 'Code expired, request a new one' });
      }

      if (loginCode.expiresAt < new Date()) {
        loginCode.status = 'expired';
        await loginCode.save();
        return void res.status(404).json({ status: 'expired', message: 'Code expired, request a new one' });
      }

      if (loginCode.status === 'activated' && loginCode.token && loginCode.userId) {
        const user = await User.findById(loginCode.userId).select('fullName username email avatar slug').lean();

        res.json({
          status: 'activated',
          token: loginCode.token,
          expiresIn: 7776000,
          user: user ? {
            id: (user as any)._id.toString(),
            displayName: (user as any).fullName || (user as any).username,
            email: (user as any).email,
            avatar: (user as any).avatar,
          } : undefined,
        });
      } else {
        res.json({ status: 'pending' });
      }
    } catch (error: any) {
      console.error('[TV AUTH] Code status error:', error.message);
      res.status(500).json({ error: 'Failed to check code status' });
    }
  });

  // 3. Mobile activates a TV code (links TV to user's account)
  app.post('/api/auth/tv/activate', async (req: any, res) => {
    try {
      const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'unknown';
      const now = Date.now();
      const attempts = tvCodeAttempts.get(clientIp);
      if (attempts) {
        if (now > attempts.resetAt) {
          tvCodeAttempts.set(clientIp, { count: 1, resetAt: now + TV_CODE_WINDOW_MS });
        } else if (attempts.count >= TV_CODE_MAX_ATTEMPTS) {
          return void res.status(429).json({ error: 'Too many activation attempts. Try again later.' });
        } else {
          attempts.count++;
        }
      } else {
        evictOldestTvCode();
        tvCodeAttempts.set(clientIp, { count: 1, resetAt: now + TV_CODE_WINDOW_MS });
      }

      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) {
        return void res.status(401).json({ error: 'Authentication required. Please login on mobile first.' });
      }

      const { code } = req.body;
      if (!code) {
        return void res.status(400).json({ error: 'code is required' });
      }

      const loginCode = await TvLoginCode.findOne({
        code,
        status: 'pending',
        expiresAt: { $gt: new Date() },
      });

      if (!loginCode) {
        return void res.status(404).json({ success: false, message: 'Invalid code or code expired' });
      }

      const deviceName = loginCode.platform === 'tizen' ? 'Samsung TV' : loginCode.platform === 'webos' ? 'LG TV' : 'TV';
      const tvToken = await generateAuthToken(userId, 'tv', `${deviceName}-${loginCode.deviceId.slice(-6)}`);

      loginCode.status = 'activated';
      loginCode.userId = new mongoose.Types.ObjectId(userId);
      loginCode.token = tvToken;
      loginCode.activatedAt = new Date();
      await loginCode.save();

      await UserDevice.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId), deviceId: loginCode.deviceId },
        {
          userId: new mongoose.Types.ObjectId(userId),
          deviceId: loginCode.deviceId,
          deviceName,
          platform: loginCode.platform,
          lastSeenAt: new Date(),
          pairedAt: new Date(),
          isActive: true,
        },
        { upsert: true, returnDocument: 'after' }
      );

      const user = await User.findById(userId).select('fullName username').lean();

      logger.info(`[TV AUTH] Code ${code} activated by user ${userId} for ${deviceName} (device permanently saved)`);

      res.json({
        success: true,
        deviceName,
        deviceId: loginCode.deviceId,
        message: `${deviceName} successfully logged in as ${(user as any)?.fullName || (user as any)?.username || 'user'}`,
      });
    } catch (error: any) {
      console.error('[TV AUTH] Activate error:', error.message);
      res.status(500).json({ error: 'Failed to activate code' });
    }
  });

  // 4. TV logout
  app.post('/api/auth/tv/logout', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!bearerToken) {
        return void res.status(401).json({ error: 'TV token required' });
      }

      const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false });
      if (!tokenDoc) {
        return void res.status(401).json({ error: 'Invalid or expired token' });
      }

      tokenDoc.isRevoked = true;
      await tokenDoc.save();

      const userId = tokenDoc.userId.toString();
      await CastSession.updateMany(
        { userId, status: { $in: ['waiting_for_pair', 'paired', 'active'] } },
        { $set: { status: 'expired', isPlaying: false } }
      );

      logger.info(`[TV AUTH] TV token revoked for user ${userId}`);

      res.json({ success: true, message: 'Logged out' });
    } catch (error: any) {
      console.error('[TV AUTH] Logout error:', error.message);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  // 5. TV token verify
  app.get('/api/auth/tv/verify', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!bearerToken) {
        return void res.status(401).json({ valid: false, error: 'Token required' });
      }

      const tokenDoc = await AuthToken.findOne({
        token: bearerToken,
        isRevoked: false,
        expiresAt: { $gt: new Date() },
      });

      if (!tokenDoc) {
        return void res.status(401).json({ valid: false, error: 'Invalid or expired token' });
      }

      tokenDoc.lastUsedAt = new Date();
      await tokenDoc.save();

      const user = await User.findById(tokenDoc.userId).select('fullName username email avatar slug').lean();

      res.json({
        valid: true,
        user: user ? {
          id: (user as any)._id.toString(),
          displayName: (user as any).fullName || (user as any).username,
          email: (user as any).email,
          avatar: (user as any).avatar,
          slug: (user as any).slug,
        } : undefined,
      });
    } catch (error: any) {
      console.error('[TV AUTH] Verify error:', error.message);
      res.status(500).json({ valid: false, error: 'Failed to verify token' });
    }
  });

  // GET /api/user/devices - List user's paired TV devices
  app.get('/api/user/devices', requireAuth, async (req: any, res) => {
    try {
      const userId = (req.session as any).userId;
      const devices = await UserDevice.find({ userId: new mongoose.Types.ObjectId(userId), isActive: true }).sort({ lastSeenAt: -1 }).lean();
      res.json({ success: true, devices });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to get devices' });
    }
  });

  // DELETE /api/user/devices/:deviceId - Unpair a TV device
  app.delete('/api/user/devices/:deviceId', requireAuth, async (req: any, res) => {
    try {
      const userId = (req.session as any).userId;
      const { deviceId } = req.params;

      await UserDevice.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId), deviceId },
        { isActive: false }
      );

      await AuthToken.updateMany(
        { userId: new mongoose.Types.ObjectId(userId), deviceType: 'tv', deviceName: { $regex: new RegExp(`-${deviceId.slice(-6)}$`) } },
        { isRevoked: true }
      );

      res.json({ success: true, message: 'Device unpaired' });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to unpair device' });
    }
  });

  app.get("/api/tv/init", async (req, res) => {
    try {
      const country = (req.query.country as string) || null;
      const countryCode = (req.query.countryCode as string) || (req.query.countrycode as string) || null;
      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 20), 50);
      const genreLimit = Math.min(Math.max(1, parseInt(req.query.genreLimit as string) || 20), 50);

      const cacheKey = `tv:init:${country || countryCode || 'global'}:${limit}:${genreLimit}:v2`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        res.set('Cache-Control', 'public, max-age=600, s-maxage=3600');
        return void res.json(cached);
      }

      let stationFilter: any = { lastCheckOk: true };
      if (country && country !== 'all' && country !== 'null') {
        Object.assign(stationFilter, normalizeCountryFilter(country));
      } else if (countryCode && countryCode !== 'all' && countryCode !== 'null') {
        stationFilter.countrycode = countryCode.toUpperCase();
      }

      const genreIdentifier = country || (countryCode ? countryCode : 'global');

      const [popularStations, trendingStations, genresRaw, countries] = await Promise.all([
        Station.find(stationFilter)
          .sort({ votes: -1, clickCount: -1 })
          .limit(limit * 2)
          .select(TV_STATION_PROJECTION)
          .lean(),

        Station.find({ ...stationFilter, clickTrend: { $gt: 0 } })
          .sort({ clickTrend: -1 })
          .limit(limit)
          .select(TV_STATION_PROJECTION)
          .lean()
          .catch(() => []),

        PrecomputedGenresService.getGenres(genreIdentifier).catch(() => ({ genres: [] })),

        Station.aggregate([
          { $match: { country: { $nin: [null, ''] } } },
          { $group: { _id: '$country', count: { $sum: 1 }, code: { $first: '$countrycode' } } },
          { $sort: { count: -1 } },
          { $limit: 200 }
        ]).catch(() => [])
      ]);

      const seenNames = new Set<string>();
      const dedupedPopular: any[] = [];
      for (const s of popularStations) {
        const key = s.name?.toLowerCase().replace(/\s*(radio|fm|am|online|live)\s*/gi, '').replace(/[^a-z0-9]/gi, '');
        if (key && seenNames.has(key)) continue;
        if (key) seenNames.add(key);
        dedupedPopular.push(tvSlimStation(s));
        if (dedupedPopular.length >= limit) break;
      }

      const genres = (genresRaw.genres || []).slice(0, genreLimit).map((g: any) => ({
        name: g.name,
        slug: g.slug,
        stationCount: g.stationCount || 0,
        posterImage: g.posterImage || g.discoverableImage || ''
      }));

      const countryList = countries.map((c: any) => ({
        name: c._id,
        code: c.code || '',
        stationCount: c.count
      }));

      const result = {
        popularStations: dedupedPopular,
        trendingStations: trendingStations.map(tvSlimStation),
        genres,
        countries: countryList,
        meta: {
          country: country || null,
          countryCode: countryCode || null,
          totalPopular: dedupedPopular.length,
          totalGenres: genres.length,
          totalCountries: countryList.length,
          generatedAt: new Date().toISOString()
        }
      };

      await CacheManager.set(cacheKey, result, { ttl: 3600 });
      res.set('Cache-Control', 'public, max-age=600, s-maxage=3600');
      res.json(result);
    } catch (error: any) {
      logger.error('TV init error:', error);
      res.status(500).json({ error: 'Failed to fetch init data' });
    }
  });
}
