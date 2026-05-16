import type { Express } from "express";
import { Advertisement, FooterSocialMedia, SeoMetadata, User, UserFavorite, AppLog, UserListeningHistory, AuthToken, ApiKey as ApiKeyModel, Feedback } from '@workspace/db-shared/mongo-schemas';
import { logger } from "../utils/logger";
import crypto from 'crypto';
import { isQuotaExceeded, safeWrite, handleQuotaError, isQuotaError } from "../utils/quota-guard";
import {
  PRODUCT_TO_PLAN as IAP_PRODUCT_TO_PLAN,
  PLAN_FEATURES as IAP_PLAN_FEATURES,
  APPLE_PLATFORMS as IAP_APPLE_PLATFORMS,
  normalizePlatform as iapNormalizePlatform,
  verifyAppleReceipt as iapVerifyAppleReceipt,
  verifyGoogleReceipt as iapVerifyGoogleReceipt,
  type Platform as IapPlatform,
} from "../services/iap-verify";

// Escape regex meta-chars so user input cannot trigger NoSQL ReDoS / regex
// injection on $regex queries. See OWASP "ReDoS" + Mongo $regex docs.
function escapeRegex(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function registerMiscRoutes(app: Express, deps: any, options?: { apiOnly?: boolean }) {
  const { requireAdmin, requireAuth, apiKeyMiddleware, seedDemoApiKey } = deps;

  // ADMIN ADVERTISEMENT MANAGEMENT API
  const setupMulter = async () => {
    const multer = (await import('multer')).default;
    const path = (await import('path')).default;
    const fs = (await import('fs')).promises;
    const { nanoid } = await import('nanoid');
    const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
    try { await fs.mkdir(uploadsDir, { recursive: true }); } catch (err) {}
    const express = await import('express');
    app.use('/uploads', express.default.static(uploadsDir));
    const storage = multer.diskStorage({
      destination: uploadsDir,
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `ad-${nanoid(10)}${ext}`);
      }
    });
    return multer({
      storage,
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|webp|gif/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        if (ext && mime) cb(null, true);
        else cb(new Error('Only images are allowed'));
      }
    });
  };

  setupMulter().then(upload => {
    app.post("/api/admin/advertisements/upload", requireAdmin, upload.single('image'), (req, res) => {
      if (!req.file) return void res.status(400).json({ error: 'No file uploaded' });
      const imageUrl = `/uploads/${req.file.filename}`;
      res.json({ imageUrl });
    });
  });

  // PUBLIC: only active ads, projection-limited (no admin-only fields).
  // Cached at the CDN edge for 5 minutes to keep the API server cool.
  app.get("/api/advertisements", async (_req, res) => {
    try {
      const ads = await Advertisement.find(
        { isActive: true },
        { title: 1, imageUrl: 1, altText: 1, seoDescription: 1, url: 1, position: 1 }
      )
        .sort({ position: 1, createdAt: -1 })
        .limit(50)
        .lean();
      res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
      res.json(ads);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch advertisements' });
    }
  });

  app.get("/api/admin/advertisements", requireAdmin, async (req, res) => {
    try {
      const ads = await Advertisement.find().sort({ position: 1, createdAt: -1 });
      res.json(ads);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch advertisements' });
    }
  });

  app.post("/api/admin/advertisements", requireAdmin, async (req, res) => {
    try {
      const { title, imageUrl, altText, seoDescription, url, position, isActive } = req.body;
      if (!title || !imageUrl || !url) {
        return void res.status(400).json({ error: 'Title, Image URL, and Target URL are required' });
      }
      const ad = new Advertisement({ title, imageUrl, altText, seoDescription, url, position: position || 0, isActive: isActive !== false });
      await ad.save();
      res.status(201).json(ad);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create advertisement' });
    }
  });

  app.patch("/api/admin/advertisements/:id", requireAdmin, async (req, res) => {
    try {
      const ad = await Advertisement.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { returnDocument: 'after' });
      if (!ad) return void res.status(404).json({ error: 'Advertisement not found' });
      res.json(ad);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update advertisement' });
    }
  });

  app.delete("/api/admin/advertisements/:id", requireAdmin, async (req, res) => {
    try {
      const ad = await Advertisement.findByIdAndDelete(req.params.id);
      if (!ad) return void res.status(404).json({ error: 'Advertisement not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete advertisement' });
    }
  });

  app.get("/api/footer-social-media", async (req, res) => {
    try {
      const socialLinks = await FooterSocialMedia.find({ isActive: true }).sort({ position: 1 });
      res.json(socialLinks);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch footer social media' });
    }
  });

  app.get("/api/admin/footer-social-media", requireAdmin, async (req, res) => {
    try {
      const socialLinks = await FooterSocialMedia.find().sort({ position: 1 });
      res.json(socialLinks);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch footer social media' });
    }
  });

  app.post("/api/admin/footer-social-media", requireAdmin, async (req, res) => {
    try {
      const { platform, url, isActive, position } = req.body;
      if (!platform || !url) return void res.status(400).json({ error: 'Platform and URL are required' });
      const socialLink = new FooterSocialMedia({ platform, url, isActive: isActive !== false, position: position || 0 });
      await socialLink.save();
      res.status(201).json(socialLink);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create footer social media' });
    }
  });

  app.patch("/api/admin/footer-social-media/:id", requireAdmin, async (req, res) => {
    try {
      const socialLink = await FooterSocialMedia.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { returnDocument: 'after' });
      if (!socialLink) return void res.status(404).json({ error: 'Social media link not found' });
      res.json(socialLink);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update footer social media' });
    }
  });

  app.delete("/api/admin/footer-social-media/:id", requireAdmin, async (req, res) => {
    try {
      const socialLink = await FooterSocialMedia.findByIdAndDelete(req.params.id);
      if (!socialLink) return void res.status(404).json({ error: 'Social media link not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete footer social media' });
    }
  });

  // Streaming CSV export of all users matching the same filters as the
  // admin list query. Uses a Mongoose cursor so we never load the full set
  // into memory — important once the user base grows past the in-browser
  // build's practical limit (tens of thousands of rows).
  app.get("/api/admin/users/export.csv", requireAdmin, async (req, res) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const planRaw = typeof req.query.plan === 'string' ? req.query.plan : 'all';
      const authRaw = typeof req.query.authMethod === 'string' ? req.query.authMethod : 'all';
      const PLAN_VALUES = new Set([
        'all', 'none', 'remove_ads', 'any_premium',
        'premium_monthly', 'premium_yearly', 'premium_lifetime',
      ]);
      const AUTH_VALUES = new Set(['all', 'email', 'google', 'facebook', 'apple']);
      const planFilter = PLAN_VALUES.has(planRaw) ? planRaw : 'all';
      const authFilter = AUTH_VALUES.has(authRaw) ? authRaw : 'all';

      const filter: any = {};
      if (search) {
        const safe = escapeRegex(search);
        filter.$or = [
          { email: { $regex: safe, $options: 'i' } },
          { fullName: { $regex: safe, $options: 'i' } },
        ];
      }
      if (planFilter === 'none') {
        filter.$and = (filter.$and || []).concat([{
          $or: [
            { subscription: { $exists: false } },
            { subscription: null },
            { 'subscription.isActive': { $ne: true } },
            { 'subscription.plan': 'none' },
          ],
        }]);
      } else if (planFilter === 'any_premium') {
        filter['subscription.isActive'] = true;
        filter['subscription.plan'] = { $in: ['premium_monthly', 'premium_yearly', 'premium_lifetime'] };
      } else if (planFilter !== 'all') {
        filter['subscription.isActive'] = true;
        filter['subscription.plan'] = planFilter;
      }
      if (authFilter === 'email') {
        filter.$and = (filter.$and || []).concat([{
          $or: [
            { authProvider: { $exists: false } },
            { authProvider: null },
            { authProvider: '' },
            { authProvider: { $regex: '^email$', $options: 'i' } },
          ],
        }]);
      } else if (authFilter !== 'all') {
        filter.authProvider = { $regex: `^${authFilter}$`, $options: 'i' };
      }

      const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .replace('Z', '');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="megaradio-users-${ts}.csv"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      const csvField = (value: unknown): string => {
        if (value === null || value === undefined) return '""';
        let str = String(value);
        if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
        return `"${str.replace(/"/g, '""')}"`;
      };
      const csvDate = (s?: Date | string | null): string => {
        if (!s) return '';
        const d = s instanceof Date ? s : new Date(s);
        return Number.isFinite(d.getTime()) ? d.toISOString() : '';
      };

      const headers = [
        'id', 'name', 'email', 'auth_method', 'plan', 'plan_active',
        'expires_at', 'followers', 'favorites', 'created_at', 'updated_at',
      ];
      // BOM so Excel opens UTF-8 names/emails correctly.
      res.write('\uFEFF' + headers.map(csvField).join(',') + '\r\n');

      const BATCH = 500;
      const cursor = User.find(filter)
        .select('_id email fullName authProvider followersCount createdAt updatedAt subscription')
        .sort({ createdAt: -1 })
        .lean()
        .cursor({ batchSize: BATCH });

      let buffer: any[] = [];
      let aborted = false;
      req.on('close', () => { aborted = true; });

      const flush = async () => {
        if (buffer.length === 0) return;
        const ids = buffer.map((u) => u._id.toString());
        let favoriteMap: Record<string, number> = {};
        try {
          const favoriteCounts = await UserFavorite.aggregate([
            { $match: { userId: { $in: ids } } },
            { $group: { _id: '$userId', count: { $sum: 1 } } },
          ]).option({ maxTimeMS: 15000 });
          for (const doc of favoriteCounts) favoriteMap[doc._id] = doc.count;
        } catch (favErr: any) {
          logger.error('Admin users export: favorite count query failed (non-fatal):', favErr.message);
        }
        let chunk = '';
        for (const u of buffer) {
          const sub = u.subscription;
          const plan = sub?.plan ?? 'none';
          const planActive = sub?.isActive === true;
          const row = [
            u._id,
            u.fullName || '',
            u.email,
            (u.authProvider || 'email').toLowerCase(),
            plan,
            planActive ? 'true' : 'false',
            csvDate(sub?.expiresAt ?? undefined),
            u.followersCount ?? 0,
            favoriteMap[u._id.toString()] ?? 0,
            csvDate(u.createdAt),
            csvDate(u.updatedAt),
          ];
          chunk += row.map(csvField).join(',') + '\r\n';
        }
        buffer = [];
        if (!res.write(chunk)) {
          await new Promise<void>((resolve) => res.once('drain', () => resolve()));
        }
      };

      try {
        for await (const user of cursor as any) {
          if (aborted) break;
          buffer.push(user);
          if (buffer.length >= BATCH) await flush();
        }
        if (!aborted) await flush();
      } finally {
        try { await cursor.close(); } catch {}
      }
      res.end();
    } catch (error: any) {
      logger.error('Admin users export error:', error.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to export users', details: error.message });
      } else {
        try { res.end(); } catch {}
      }
    }
  });

  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
      const skip = (page - 1) * limit;
      const search = req.query.search as string;

      const filter: any = {};
      if (search) {
        const safe = escapeRegex(search);
        filter.$or = [
          { email: { $regex: safe, $options: 'i' } },
          { fullName: { $regex: safe, $options: 'i' } }
        ];
      }

      const [users, totalCount] = await Promise.all([
        User.find(filter).select('_id email fullName avatar profilePicture authProvider googleId followers followersCount createdAt updatedAt isActive subscription').skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
        User.countDocuments(filter)
      ]);

      let favoriteMap: Record<string, number> = {};
      try {
        const userIds = users.map(u => u._id.toString());
        if (userIds.length > 0) {
          const favoriteCounts = await UserFavorite.aggregate([
            { $match: { userId: { $in: userIds } } },
            { $group: { _id: '$userId', count: { $sum: 1 } } }
          ]).option({ maxTimeMS: 10000 });
          favoriteCounts.forEach(doc => { favoriteMap[doc._id] = doc.count; });
        }
      } catch (favErr: any) {
        console.error('Admin users: favorite count query failed (non-fatal):', favErr.message);
      }

      const usersWithDetails = users.map(user => {
        const fullNameParts = (user.fullName || 'User').split(' ');
        return {
          _id: user._id,
          email: user.email,
          fullName: user.fullName || '',
          firstName: fullNameParts[0] || '',
          lastName: fullNameParts.slice(1).join(' ') || '',
          avatar: user.avatar || '',
          profilePicture: user.profilePicture || '',
          authProvider: user.authProvider || 'email',
          googleId: user.googleId || '',
          followers: user.followersCount || 0,
          favorites: favoriteMap[user._id.toString()] || 0,
          subscription: (user as any).subscription || null,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          isActive: user.isActive !== false
        };
      });
      res.json({ users: usersWithDetails, total: totalCount, page, limit, totalPages: Math.ceil(totalCount / limit) });
    } catch (error: any) {
      console.error('Admin users fetch error:', error.message || error);
      res.status(500).json({ error: 'Failed to fetch users', details: error.message });
    }
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const { email, firstName, lastName, profilePicture, isActive, fullName } = req.body;
      const updateData: any = {};
      if (email) updateData.email = email;
      if (fullName) updateData.fullName = fullName;
      else if (firstName || lastName) {
        const user = await User.findById(req.params.id);
        if (user) {
          updateData.fullName = [firstName || user.fullName?.split(' ')[0], lastName || user.fullName?.split(' ').slice(1).join(' ')].filter(Boolean).join(' ');
        }
      }
      if (profilePicture) updateData.profilePicture = profilePicture;
      if (isActive !== undefined) updateData.isActive = isActive;
      updateData.updatedAt = new Date();
      const user = await User.findByIdAndUpdate(req.params.id, updateData, { returnDocument: 'after' }).select('_id email fullName profilePicture authProvider googleId followers followersCount createdAt updatedAt isActive');
      if (!user) return void res.status(404).json({ error: 'User not found' });
      const favoriteCount = await UserFavorite.countDocuments({ userId: user._id.toString() });
      res.json({
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        firstName: (user.fullName || 'User').split(' ')[0],
        lastName: (user.fullName || 'User').split(' ').slice(1).join(' '),
        profilePicture: user.profilePicture,
        authProvider: user.authProvider,
        googleId: user.googleId,
        followers: user.followersCount || 0,
        favorites: favoriteCount || 0,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        isActive: user.isActive !== false
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      const user = await User.findByIdAndDelete(userId);
      if (!user) return void res.status(404).json({ error: 'User not found' });

      const deletedFavs = await UserFavorite.deleteMany({ userId });
      console.log(`Deleted user ${userId} and ${deletedFavs.deletedCount} associated favorites`);

      res.json({ success: true, deletedFavorites: deletedFavs.deletedCount });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  // ===== SUBSCRIPTION MANAGEMENT =====

  const VALID_PLANS = ['none', 'remove_ads', 'premium_monthly', 'premium_yearly', 'premium_lifetime'] as const;
  type PremiumPlan = typeof VALID_PLANS[number];

  const PRODUCT_TO_PLAN: Record<string, PremiumPlan> = {
    'megaradio_remove_ads_yearly1': 'remove_ads',
    'megaradio_premium_monthly1': 'premium_monthly',
    'megaradio_premium_yearly': 'premium_yearly',
    'megaradio_premium_lifetime': 'premium_lifetime',
  };

  const PLAN_FEATURES: Record<PremiumPlan, string[]> = {
    'none': [],
    'remove_ads': ['remove_ads'],
    'premium_monthly': ['remove_ads', 'song_info', 'spotify_link', 'youtube_link', 'hd_stream', 'song_history', 'stream_record'],
    'premium_yearly': ['remove_ads', 'song_info', 'spotify_link', 'youtube_link', 'hd_stream', 'song_history', 'stream_record'],
    'premium_lifetime': ['remove_ads', 'song_info', 'spotify_link', 'youtube_link', 'hd_stream', 'song_history', 'stream_record'],
  };

  const PLAN_RANK: Record<PremiumPlan, number> = {
    'none': 0, 'remove_ads': 1, 'premium_monthly': 2, 'premium_yearly': 3, 'premium_lifetime': 4,
  };

  function getExpiryForPlan(plan: PremiumPlan): Date | null {
    const now = new Date();
    switch (plan) {
      case 'remove_ads':
      case 'premium_yearly':
        return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      case 'premium_monthly':
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      case 'premium_lifetime':
        return null;
      default:
        return null;
    }
  }

  // SECURITY: This endpoint USED to accept any client-provided receipt and
  // grant premium without contacting Apple/Google — a critical broken access
  // control bug exploitable with a single curl. It now defers entirely to the
  // same Apple verifyReceipt / Google Play Developer API path used by
  // POST /api/iap/validate, ignores client-provided plan/expiresAt/transactionId,
  // and rejects unknown platforms. `mac`/`macos`/`tvos` are accepted as Apple
  // (Universal Purchase: Mac App Store receipts use the same bundle_id and
  // verifyReceipt endpoint as iOS).
  app.post("/api/user/subscription", requireAuth, async (req, res) => {
    try {
      const userId = req.session?.user?.userId || (req.session as any)?.userId;
      if (!userId) return void res.status(401).json({ error: 'Not authenticated' });

      const { platform: rawPlatform, productId, receipt, purchaseToken } = req.body || {};

      const platform = iapNormalizePlatform(rawPlatform);
      if (!platform) {
        return void res.status(400).json({
          error: 'platform must be one of: ios, android, mac, macos, tvos',
        });
      }
      if (!productId || typeof productId !== 'string') {
        return void res.status(400).json({ error: 'productId is required' });
      }
      const plan = IAP_PRODUCT_TO_PLAN[productId];
      if (!plan || plan === 'none') {
        return void res.status(400).json({
          error: `Unknown productId: ${productId}. Valid: ${Object.keys(IAP_PRODUCT_TO_PLAN).join(', ')}`,
        });
      }

      // Apple uses `receipt` (base64), Android uses `purchaseToken`. Accept either
      // field name for backwards compatibility with older mobile clients.
      const isAndroid = platform === 'android';
      const credential = isAndroid
        ? (typeof purchaseToken === 'string' && purchaseToken) || (typeof receipt === 'string' && receipt)
        : (typeof receipt === 'string' && receipt) || (typeof purchaseToken === 'string' && purchaseToken);
      if (!credential || typeof credential !== 'string') {
        return void res.status(400).json({
          error: isAndroid
            ? 'purchaseToken is required for android'
            : 'receipt (base64 receipt-data) is required for ios/mac/tvos',
        });
      }

      const result = IAP_APPLE_PLATFORMS.includes(platform)
        ? await iapVerifyAppleReceipt(credential, productId)
        : await iapVerifyGoogleReceipt(credential, productId);

      if (!result.valid) {
        logger.log(`[IAP] /api/user/subscription rejected: ${result.code} — ${result.error}`);
        return void res.status(400).json({ error: result.error, code: String(result.code ?? 'invalid_receipt') });
      }

      // Same global replay-guard as /api/iap/validate: a single transaction may
      // only be attached to one user, otherwise an attacker who lapses their
      // sub could re-attach the same receipt to a fresh account.
      const replayQuery: any = {
        _id: { $ne: userId },
        $or: [{ 'subscription.originalTransactionId': result.originalTransactionId }],
      };
      if (isAndroid) replayQuery.$or.push({ 'subscription.purchaseToken': credential });
      const conflict = await User.findOne(replayQuery).select('_id').lean();
      if (conflict) {
        logger.log(`[IAP] Replay blocked at /api/user/subscription: txn=${result.originalTransactionId} requested by user=${userId}, owned by user=${(conflict as any)._id}`);
        return void res.status(409).json({
          error: 'Receipt is already attached to another account',
          code: 'receipt_replay',
        });
      }

      const expiresAtDate = result.isLifetime ? null : (result.expiresAt ? new Date(result.expiresAt) : null);

      const existing = await User.findById(userId).select('subscription').lean();
      const existingSub: any = (existing as any)?.subscription;
      const isSameTxn =
        existingSub?.originalTransactionId === result.originalTransactionId && existingSub?.isActive;

      const setFields: any = {
        'subscription.plan': plan,
        'subscription.platform': platform,
        'subscription.productId': result.productId,
        'subscription.transactionId': result.originalTransactionId,
        'subscription.originalTransactionId': result.originalTransactionId,
        'subscription.isActive': true,
        'subscription.lastVerifiedAt': new Date(),
        'subscription.expiresAt': expiresAtDate,
      };
      const unsetFields: any = {};
      if (isAndroid) {
        setFields['subscription.purchaseToken'] = credential;
        unsetFields['subscription.receipt'] = '';
      } else {
        setFields['subscription.receipt'] = credential;
      }
      if (!isSameTxn && !existingSub?.startedAt) setFields['subscription.startedAt'] = new Date();

      const op: any = { $set: setFields };
      if (Object.keys(unsetFields).length) op.$unset = unsetFields;

      const user = await User.findByIdAndUpdate(userId, op, { returnDocument: 'after', runValidators: true })
        .select('subscription');
      if (!user) return void res.status(404).json({ error: 'User not found' });

      res.json({
        success: true,
        plan,
        expiryDate: expiresAtDate,
        isActive: true,
        features: IAP_PLAN_FEATURES[plan],
        ...(result.environment ? { environment: result.environment } : {}),
      });
    } catch (error: any) {
      logger.error('[IAP] /api/user/subscription update error:', error?.message || error);
      res.status(500).json({ error: 'Failed to update subscription' });
    }
  });

  app.get("/api/user/subscription", requireAuth, async (req, res) => {
    try {
      const userId = req.session?.user?.userId || (req.session as any)?.userId;
      if (!userId) return void res.status(401).json({ error: 'Not authenticated' });

      const user = await User.findById(userId).select('subscription').lean();
      if (!user) return void res.status(404).json({ error: 'User not found' });

      const sub = (user as any).subscription;
      if (!sub || sub.plan === 'none') {
        return void res.json({ plan: 'none', expiryDate: null, isActive: false, features: [] });
      }

      if (sub.plan !== 'premium_lifetime' && sub.expiresAt && new Date(sub.expiresAt) < new Date() && sub.isActive) {
        await User.findByIdAndUpdate(userId, {
          $set: { 'subscription.isActive': false, 'subscription.plan': 'none' }
        });
        return void res.json({ plan: 'none', expiryDate: null, isActive: false, features: [], expired: true });
      }

      res.json({
        plan: sub.plan,
        expiryDate: sub.expiresAt || null,
        isActive: sub.isActive,
        features: PLAN_FEATURES[sub.plan as PremiumPlan] || [],
      });
    } catch (error: any) {
      console.error('Subscription fetch error:', error.message);
      res.status(500).json({ error: 'Failed to fetch subscription' });
    }
  });

  // SECURITY/UX: Store-billed subscriptions (Apple/Google) MUST be cancelled
  // through the user's App Store / Play Store account — flipping isActive=false
  // here would silently downgrade entitlements while the store keeps charging.
  // For those platforms we return 409 with an actionRequired hint so the
  // mobile client can deep-link into the store's manage-subscription screen.
  // Lifetime, admin-granted, and web-billed plans (none of which exist yet
  // but are reserved) can still be cancelled locally.
  app.post("/api/user/subscription/cancel", requireAuth, async (req, res) => {
    try {
      const userId = req.session?.user?.userId || (req.session as any)?.userId;
      if (!userId) return void res.status(401).json({ error: 'Not authenticated' });

      const existing = await User.findById(userId).select('subscription').lean();
      if (!existing) return void res.status(404).json({ error: 'User not found' });
      const sub: any = (existing as any).subscription;
      const platform = sub?.platform;
      const isStoreBilled = platform === 'ios' || platform === 'macos' || platform === 'tvos' || platform === 'android';
      const isLifetime = sub?.plan === 'premium_lifetime';

      if (isStoreBilled && !isLifetime) {
        const manageUrl = (platform === 'android')
          ? 'https://play.google.com/store/account/subscriptions'
          : 'https://apps.apple.com/account/subscriptions';
        return void res.status(409).json({
          error: 'Subscriptions purchased through the App Store / Play Store must be cancelled there.',
          code: 'manage_in_store',
          actionRequired: 'open_store_subscriptions',
          platform,
          manageUrl,
        });
      }

      const user = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            'subscription.isActive': false,
            'subscription.plan': 'none',
            'subscription.cancelledAt': new Date(),
          }
        },
        { returnDocument: 'after' }
      ).select('subscription');

      if (!user) return void res.status(404).json({ error: 'User not found' });

      logger.log(`[IAP] /cancel local-cancel user=${userId} previousPlatform=${platform || 'none'}`);
      res.json({ success: true, plan: 'none', isActive: false, features: [] });
    } catch (error: any) {
      logger.error('[IAP] /cancel error:', error?.message || error);
      res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  });

  app.patch("/api/admin/users/:id/subscription", requireAdmin, async (req, res) => {
    try {
      const { plan, isActive, expiresAt } = req.body;
      const updateData: any = { 'subscription.lastVerifiedAt': new Date(), 'subscription.platform': 'admin' };

      if (plan) {
        if (!VALID_PLANS.includes(plan)) {
          return void res.status(400).json({ error: `plan must be one of: ${VALID_PLANS.join(', ')}` });
        }
        updateData['subscription.plan'] = plan;
        updateData['subscription.isActive'] = plan !== 'none';
      }
      if (typeof isActive === 'boolean') updateData['subscription.isActive'] = isActive;
      if (expiresAt !== undefined) {
        if (expiresAt === null) {
          updateData['subscription.expiresAt'] = null;
        } else {
          const parsed = new Date(expiresAt);
          if (isNaN(parsed.getTime())) {
            return void res.status(400).json({ error: 'expiresAt must be a valid date or null' });
          }
          updateData['subscription.expiresAt'] = parsed;
        }
      }
      if (!expiresAt && plan) updateData['subscription.startedAt'] = new Date();

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { $set: updateData },
        { returnDocument: 'after', runValidators: true }
      ).select('subscription fullName email');

      if (!user) return void res.status(404).json({ error: 'User not found' });

      const activePlan = user.subscription?.plan as PremiumPlan || 'none';
      res.json({
        success: true,
        user: {
          _id: user._id,
          fullName: user.fullName,
          email: user.email,
          subscription: user.subscription,
          features: PLAN_FEATURES[activePlan] || [],
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to update subscription', details: error.message });
    }
  });

  if (!options?.apiOnly) {
    app.get("/ads.txt", (req, res) => {
      const adsTxt = `google.com, pub-8771434485570434, DIRECT, f08c47fec0942fa0`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(adsTxt);
    });

    app.get("/app-ads.txt", (req, res) => {
      const appAdsTxt = `google.com, pub-8771434485570434, DIRECT, f08c47fec0942fa0`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(appAdsTxt);
    });
  }

  // api-keys, user-engagement, and apiKeyMiddleware are registered by the thin routes.ts orchestrator

  app.post('/api/logs/remote', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) return void res.status(401).json({ error: 'X-API-Key header required' });
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

      const apiKeyDoc = await ApiKeyModel.findOne({ keyHash });
      if (!apiKeyDoc || apiKeyDoc.status !== 'active') return void res.status(401).json({ error: 'Invalid or inactive API key' });
      const { logs, deviceId, platform } = req.body;
      if (!logs || !Array.isArray(logs) || !deviceId || !platform) return void res.status(400).json({ error: 'logs, deviceId, and platform are required' });
      res.json({ success: true, received: Math.min(logs.length, 100), note: 'db_logging_disabled' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process logs' });
    }
  });

  app.get('/api/logs/remote', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) return void res.status(401).json({ error: 'X-API-Key header required' });
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const apiKeyDoc = await ApiKeyModel.findOne({ keyHash });
      if (!apiKeyDoc || apiKeyDoc.status !== 'active') return void res.status(401).json({ error: 'Invalid or inactive API key' });
      const { limit = '50', platform, level, search, deviceId, from, to } = req.query;
      const maxLimit = Math.min(parseInt(limit as string) || 50, 500);
      const filter: any = {};
      if (platform) filter.platform = platform;
      if (deviceId) filter.deviceId = { $regex: escapeRegex(String(deviceId)), $options: 'i' };
      if (level) filter['logs.level'] = level;
      if (search) filter['logs.message'] = { $regex: escapeRegex(String(search)), $options: 'i' };
      if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(String(from));
        if (to) filter.createdAt.$lte = new Date(String(to));
      }
      const logs = await AppLog.find(filter).sort({ createdAt: -1 }).limit(maxLimit).lean();
      const formatted = logs.map((log: any) => ({
        id: log._id,
        deviceId: log.deviceId,
        platform: log.platform,
        appVersion: log.appVersion,
        buildNumber: log.buildNumber,
        isCarPlayLog: log.isCarPlayLog,
        logs: log.logs,
        createdAt: log.createdAt,
      }));
      res.json({ success: true, count: formatted.length, logs: formatted });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  app.get('/api/logs/remote/stats', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) return void res.status(401).json({ error: 'X-API-Key header required' });
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const apiKeyDoc = await ApiKeyModel.findOne({ keyHash });
      if (!apiKeyDoc || apiKeyDoc.status !== 'active') return void res.status(401).json({ error: 'Invalid or inactive API key' });
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const aggResult = await AppLog.aggregate([
        {
          $facet: {
            total: [{ $count: 'count' }],
            today: [{ $match: { createdAt: { $gte: todayStart } } }, { $count: 'count' }],
            byPlatform: [{ $group: { _id: '$platform', count: { $sum: 1 } } }],
            byLevel: [{ $unwind: '$logs' }, { $group: { _id: '$logs.level', count: { $sum: 1 } } }],
            carplayConnected: [{ $unwind: '$logs' }, { $match: { 'logs.message': { $regex: 'CarPlay CONNECTED', $options: 'i' } } }, { $count: 'count' }],
            carplayDisconnected: [{ $unwind: '$logs' }, { $match: { 'logs.message': { $regex: 'CarPlay DISCONNECTED', $options: 'i' } } }, { $count: 'count' }],
            templateCreated: [{ $unwind: '$logs' }, { $match: { 'logs.message': { $regex: 'Template created', $options: 'i' } } }, { $count: 'count' }],
            carplayErrors: [{ $unwind: '$logs' }, { $match: { 'logs.message': { $regex: 'CarPlay|Template', $options: 'i' }, 'logs.level': 'error' } }, { $count: 'count' }],
          },
        },
      ]).option({ maxTimeMS: 15000, allowDiskUse: true });
      const pipeline = aggResult[0] || {};
      const byPlatform: Record<string, number> = {};
      (pipeline.byPlatform || []).forEach((p: any) => { if (p._id) byPlatform[p._id] = p.count; });
      const byLevel: Record<string, number> = {};
      (pipeline.byLevel || []).forEach((l: any) => { if (l._id) byLevel[l._id] = l.count; });
      res.json({
        success: true,
        stats: {
          total: pipeline.total?.[0]?.count || 0,
          today: pipeline.today?.[0]?.count || 0,
          byLevel,
          byPlatform,
          carplayEvents: {
            connected: pipeline.carplayConnected?.[0]?.count || 0,
            disconnected: pipeline.carplayDisconnected?.[0]?.count || 0,
            templateCreated: pipeline.templateCreated?.[0]?.count || 0,
            errors: pipeline.carplayErrors?.[0]?.count || 0,
          },
        },
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch log stats' });
    }
  });

  app.delete('/api/logs/remote', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) return void res.status(401).json({ error: 'X-API-Key header required' });
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const apiKeyDoc = await ApiKeyModel.findOne({ keyHash });
      if (!apiKeyDoc || apiKeyDoc.status !== 'active') return void res.status(401).json({ error: 'Invalid or inactive API key' });
      if (!['internal', 'pro'].includes(apiKeyDoc.plan)) return void res.status(403).json({ error: 'Pro or Internal plan required to delete logs' });
      const olderThanDays = Math.max(1, parseInt(String(req.query.olderThan || req.query.older_than_days || '30')));
      const cutoff = new Date(Date.now() - olderThanDays * 86400000);
      const result = await AppLog.deleteMany({ createdAt: { $lt: cutoff } });
      res.json({ success: true, deletedCount: result.deletedCount, message: `Logs older than ${olderThanDays} days deleted` });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete logs' });
    }
  });

  app.get('/api/admin/app-logs', requireAdmin, async (req, res) => {
    try {
      const { platform, deviceId, page = '1', limit = '50' } = req.query;
      const filter: any = {};
      if (platform) filter.platform = platform;
      if (deviceId) filter.deviceId = { $regex: escapeRegex(String(deviceId)), $options: 'i' };
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const [items, total] = await Promise.all([AppLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(), AppLog.countDocuments(filter)]);
      res.json({ logs: items, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  app.get('/api/admin/app-logs/crashes', requireAdmin, async (req, res) => {
    try {
      const crashes = await AppLog.find({ 'logs.message': 'APP_CRASH' }).sort({ createdAt: -1 }).limit(50).lean();
      res.json({ crashes, total: crashes.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch crash logs' });
    }
  });

  // country-language-mappings, url-translations, and performance routers are registered by the thin routes.ts orchestrator

  app.get("/api/admin/seo-metadata", requireAdmin, async (req, res) => {
    try {
      const { pageType, language, status, page = '1', limit = '50' } = req.query;
      const filter: any = {};
      if (pageType) filter.pageType = pageType;
      if (language) filter.language = language;
      if (status) filter.status = status;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const [items, total] = await Promise.all([SeoMetadata.find(filter).sort({ pageType: 1, routeKey: 1, language: 1 }).skip(skip).limit(Number(limit)).lean(), SeoMetadata.countDocuments(filter)]);
      res.json({ items, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) } });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch SEO metadata' });
    }
  });

  app.get("/api/admin/seo-metadata/:id", requireAdmin, async (req, res) => {
    try {
      const entry = await SeoMetadata.findById(req.params.id).lean();
      if (!entry) return void res.status(404).json({ error: 'SEO metadata entry not found' });
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch SEO metadata' });
    }
  });

  app.post("/api/admin/seo-metadata", requireAdmin, async (req, res) => {
    try {
      const { pageType, routeKey, language, title, description } = req.body;
      if (!pageType || !routeKey || !language || !title || !description) return void res.status(400).json({ error: 'Missing required fields' });
      const entry = new SeoMetadata({ ...req.body, createdAt: new Date(), updatedAt: new Date() });
      await entry.save();
      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create SEO metadata' });
    }
  });

  app.patch("/api/admin/seo-metadata/:id", requireAdmin, async (req, res) => {
    try {
      const entry = await SeoMetadata.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { returnDocument: 'after' });
      if (!entry) return void res.status(404).json({ error: 'SEO metadata entry not found' });
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update SEO metadata' });
    }
  });

  app.delete("/api/admin/seo-metadata/:id", requireAdmin, async (req, res) => {
    try {
      const entry = await SeoMetadata.findByIdAndDelete(req.params.id);
      if (!entry) return void res.status(404).json({ error: 'SEO metadata entry not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete SEO metadata' });
    }
  });

  app.post("/api/admin/seo-metadata/bulk-status", requireAdmin, async (req, res) => {
    try {
      const { ids, status } = req.body;
      const result = await SeoMetadata.updateMany({ _id: { $in: ids } }, { $set: { status, updatedAt: new Date() } });
      res.json({ success: true, modifiedCount: result.modifiedCount });
    } catch (error) {
      res.status(500).json({ error: 'Failed to bulk update SEO metadata' });
    }
  });

  app.get("/api/admin/seo-metadata/stats", requireAdmin, async (req, res) => {
    try {
      const [total, byPageType, byStatus] = await Promise.all([SeoMetadata.countDocuments(), SeoMetadata.aggregate([{ $group: { _id: '$pageType', count: { $sum: 1 } } }]), SeoMetadata.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])]);
      res.json({ total, byPageType: Object.fromEntries(byPageType.map(p => [p._id, p.count])), byStatus: Object.fromEntries(byStatus.map(s => [s._id, s.count])) });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch SEO metadata stats' });
    }
  });

  app.get("/api/admin/seo-metadata/page-types", requireAdmin, (req, res) => {
    res.json({ pageTypes: [{ value: 'homepage', label: 'Homepage' }, { value: 'genre_list', label: 'Genre List' }, { value: 'genre_detail', label: 'Genre Detail' }, { value: 'station_detail', label: 'Station Detail' }, { value: 'country_list', label: 'Country List' }, { value: 'country_detail', label: 'Country Detail' }, { value: 'region', label: 'Region' }, { value: 'search', label: 'Search' }, { value: 'static', label: 'Static Page' }] });
  });

  app.post("/api/admin/seo-metadata/generate-draft", requireAdmin, async (req, res) => {
    try {
      const { pageType, language } = req.body;
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are an SEO expert." }, { role: "user", content: `Generate SEO metadata for a ${pageType} page in ${language}.` }]
      });
      res.json({ draft: completion.choices[0].message.content });
    } catch (error) {
      res.status(500).json({ error: 'Failed to generate draft' });
    }
  });

  app.get("/api/admin/listening-history", requireAdmin, async (req, res) => {
    try {
      const history = await UserListeningHistory.find().sort({ listenedAt: -1 }).limit(100).populate('userId', 'email fullName').populate('stationId', 'name slug');
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch history' });
    }
  });

  // ---- Admin: user feedback queue (read / triage / delete)
  // Backs artifacts/megaradio/src/pages/admin/feedback.tsx. Accepts
  // `status` and `type` query params; the special value 'all' (or
  // missing) disables that filter. Response shape matches what the
  // page consumes: `{ feedback, stats }`.
  app.get("/api/admin/feedback", requireAdmin, async (req, res) => {
    try {
      const FEEDBACK_STATUSES = new Set(['open', 'in-progress', 'resolved', 'closed']);
      const FEEDBACK_TYPES = new Set(['bug', 'feature', 'general']);

      const statusRaw = typeof req.query.status === 'string' ? req.query.status : 'all';
      const typeRaw = typeof req.query.type === 'string' ? req.query.type : 'all';

      const filter: Record<string, unknown> = {};
      if (statusRaw !== 'all' && FEEDBACK_STATUSES.has(statusRaw)) {
        filter.status = statusRaw;
      }
      if (typeRaw !== 'all' && FEEDBACK_TYPES.has(typeRaw)) {
        filter.type = typeRaw;
      }

      const limitRaw = Number.parseInt(typeof req.query.limit === 'string' ? req.query.limit : '', 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

      const [feedback, statusAgg, typeAgg, total] = await Promise.all([
        Feedback.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
        Feedback.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        Feedback.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
        Feedback.countDocuments({}),
      ]);

      const statusCounts: Record<string, number> = {};
      for (const row of statusAgg) statusCounts[row._id as string] = row.count as number;
      const typeCounts: Record<string, number> = { bug: 0, feature: 0, general: 0 };
      for (const row of typeAgg) {
        if (row._id in typeCounts) typeCounts[row._id as string] = row.count as number;
      }

      res.json({
        feedback,
        stats: {
          total,
          open: statusCounts['open'] || 0,
          inProgress: statusCounts['in-progress'] || 0,
          resolved: statusCounts['resolved'] || 0,
          closed: statusCounts['closed'] || 0,
          byType: typeCounts,
        },
      });
    } catch (error) {
      logger.error(`❌ /api/admin/feedback list failed: ${(error as Error)?.message || error}`);
      res.status(500).json({ error: 'Failed to fetch feedback' });
    }
  });

  app.patch("/api/admin/feedback/:id", requireAdmin, async (req, res) => {
    try {
      const FEEDBACK_STATUSES = new Set(['open', 'in-progress', 'resolved', 'closed']);
      const { status, response } = req.body ?? {};
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof status === 'string') {
        if (!FEEDBACK_STATUSES.has(status)) {
          return void res.status(400).json({ error: 'Invalid status' });
        }
        update.status = status;
      }
      if (typeof response === 'string') {
        const trimmed = response.trim();
        if (trimmed.length > 0) update.response = trimmed;
      }

      const updated = await Feedback.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' }).lean();
      if (!updated) return void res.status(404).json({ error: 'Feedback not found' });
      res.json(updated);
    } catch (error) {
      logger.error(`❌ /api/admin/feedback PATCH failed: ${(error as Error)?.message || error}`);
      res.status(500).json({ error: 'Failed to update feedback' });
    }
  });

  app.delete("/api/admin/feedback/:id", requireAdmin, async (req, res) => {
    try {
      const deleted = await Feedback.findByIdAndDelete(req.params.id);
      if (!deleted) return void res.status(404).json({ error: 'Feedback not found' });
      res.json({ success: true });
    } catch (error) {
      logger.error(`❌ /api/admin/feedback DELETE failed: ${(error as Error)?.message || error}`);
      res.status(500).json({ error: 'Failed to delete feedback' });
    }
  });

  app.get("/api/tv/bundle", async (req, res) => {
    try {
      const { Station: StationModel, Genre: GenreModel } = await import('@workspace/db-shared/mongo-schemas');
      const [popularStations, genres] = await Promise.all([
        StationModel.find().sort({ votes: -1 }).limit(20).lean(),
        GenreModel.find({ discoverable: true }).limit(20).lean()
      ]);
      const { tvSlimStation, tvSlimGenre } = await import('./shared-utils');
      res.json({ stations: popularStations.map(tvSlimStation), genres: genres.map(tvSlimGenre) });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch bundle' });
    }
  });
}
