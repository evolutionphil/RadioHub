import type { Express } from "express";
import { Advertisement, FooterSocialMedia, SeoMetadata, User, UserFavorite, AppLog, UserListeningHistory, AuthToken, ApiKey as ApiKeyModel } from "../../shared/mongo-schemas";
import { logger } from "../utils/logger";
import crypto from 'crypto';
import { isQuotaExceeded, safeWrite, handleQuotaError, isQuotaError } from "../utils/quota-guard";

export function registerMiscRoutes(app: Express, deps: any) {
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
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const imageUrl = `/uploads/${req.file.filename}`;
      res.json({ imageUrl });
    });
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
        return res.status(400).json({ error: 'Title, Image URL, and Target URL are required' });
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
      const ad = await Advertisement.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { new: true });
      if (!ad) return res.status(404).json({ error: 'Advertisement not found' });
      res.json(ad);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update advertisement' });
    }
  });

  app.delete("/api/admin/advertisements/:id", requireAdmin, async (req, res) => {
    try {
      const ad = await Advertisement.findByIdAndDelete(req.params.id);
      if (!ad) return res.status(404).json({ error: 'Advertisement not found' });
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
      if (!platform || !url) return res.status(400).json({ error: 'Platform and URL are required' });
      const socialLink = new FooterSocialMedia({ platform, url, isActive: isActive !== false, position: position || 0 });
      await socialLink.save();
      res.status(201).json(socialLink);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create footer social media' });
    }
  });

  app.patch("/api/admin/footer-social-media/:id", requireAdmin, async (req, res) => {
    try {
      const socialLink = await FooterSocialMedia.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { new: true });
      if (!socialLink) return res.status(404).json({ error: 'Social media link not found' });
      res.json(socialLink);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update footer social media' });
    }
  });

  app.delete("/api/admin/footer-social-media/:id", requireAdmin, async (req, res) => {
    try {
      const socialLink = await FooterSocialMedia.findByIdAndDelete(req.params.id);
      if (!socialLink) return res.status(404).json({ error: 'Social media link not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete footer social media' });
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
        filter.$or = [
          { email: { $regex: search, $options: 'i' } },
          { fullName: { $regex: search, $options: 'i' } }
        ];
      }

      const [users, totalCount] = await Promise.all([
        User.find(filter).select('_id email fullName avatar profilePicture authProvider googleId followers followersCount createdAt updatedAt isActive').skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
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
      const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('_id email fullName profilePicture authProvider googleId followers followersCount createdAt updatedAt isActive');
      if (!user) return res.status(404).json({ error: 'User not found' });
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
      if (!user) return res.status(404).json({ error: 'User not found' });

      const deletedFavs = await UserFavorite.deleteMany({ userId });
      console.log(`Deleted user ${userId} and ${deletedFavs.deletedCount} associated favorites`);

      res.json({ success: true, deletedFavorites: deletedFavs.deletedCount });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

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

  // api-keys, user-engagement, and apiKeyMiddleware are registered by the thin routes.ts orchestrator

  app.post('/api/logs/remote', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) return res.status(401).json({ error: 'X-API-Key header required' });
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const apiKeyDoc = await ApiKeyModel.findOne({ keyHash });
      if (!apiKeyDoc || apiKeyDoc.status !== 'active') return res.status(401).json({ error: 'Invalid or inactive API key' });
      const { logs, deviceId, platform, appVersion = '1.0.0', buildNumber = '' } = req.body;
      if (!logs || !Array.isArray(logs) || !deviceId || !platform) return res.status(400).json({ error: 'logs, deviceId, and platform are required' });
      if (!['ios', 'android'].includes(platform)) return res.status(400).json({ error: 'platform must be "ios" or "android"' });
      const sanitizedLogs = logs.slice(0, 100).map((log: any) => ({
        level: ['info', 'warn', 'error', 'debug', 'fatal'].includes(log.level) ? log.level : 'info',
        message: String(log.message || '').substring(0, 500),
        timestamp: log.timestamp || new Date().toISOString(),
        data: log.data && typeof log.data === 'object' ? JSON.parse(JSON.stringify(log.data).substring(0, 5000)) : {},
      }));
      const isCarPlayLog = sanitizedLogs.some((log: any) => /CarPlay|Template/i.test(log.message));
      if (isQuotaExceeded()) {
        return res.json({ success: true, received: sanitizedLogs.length, note: 'storage_limited' });
      }
      await safeWrite('applog:create', () =>
        AppLog.create({ deviceId, platform, appVersion: String(appVersion), buildNumber: String(buildNumber), logs: sanitizedLogs, apiKeyHash: keyHash, isCarPlayLog })
      );
      res.json({ success: true, received: sanitizedLogs.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to store logs' });
    }
  });

  app.get('/api/logs/remote', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) return res.status(401).json({ error: 'X-API-Key header required' });
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const apiKeyDoc = await ApiKeyModel.findOne({ keyHash });
      if (!apiKeyDoc || apiKeyDoc.status !== 'active') return res.status(401).json({ error: 'Invalid or inactive API key' });
      const { limit = '50', platform, level, search, deviceId, from, to } = req.query;
      const maxLimit = Math.min(parseInt(limit as string) || 50, 500);
      const filter: any = {};
      if (platform) filter.platform = platform;
      if (deviceId) filter.deviceId = { $regex: String(deviceId), $options: 'i' };
      if (level) filter['logs.level'] = level;
      if (search) filter['logs.message'] = { $regex: String(search), $options: 'i' };
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
      if (!apiKey) return res.status(401).json({ error: 'X-API-Key header required' });
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const apiKeyDoc = await ApiKeyModel.findOne({ keyHash });
      if (!apiKeyDoc || apiKeyDoc.status !== 'active') return res.status(401).json({ error: 'Invalid or inactive API key' });
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
      ]);
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
      if (!apiKey) return res.status(401).json({ error: 'X-API-Key header required' });
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const apiKeyDoc = await ApiKeyModel.findOne({ keyHash });
      if (!apiKeyDoc || apiKeyDoc.status !== 'active') return res.status(401).json({ error: 'Invalid or inactive API key' });
      if (!['internal', 'pro'].includes(apiKeyDoc.plan)) return res.status(403).json({ error: 'Pro or Internal plan required to delete logs' });
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
      if (deviceId) filter.deviceId = { $regex: deviceId, $options: 'i' };
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
      if (!entry) return res.status(404).json({ error: 'SEO metadata entry not found' });
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch SEO metadata' });
    }
  });

  app.post("/api/admin/seo-metadata", requireAdmin, async (req, res) => {
    try {
      const { pageType, routeKey, language, title, description } = req.body;
      if (!pageType || !routeKey || !language || !title || !description) return res.status(400).json({ error: 'Missing required fields' });
      const entry = new SeoMetadata({ ...req.body, createdAt: new Date(), updatedAt: new Date() });
      await entry.save();
      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create SEO metadata' });
    }
  });

  app.patch("/api/admin/seo-metadata/:id", requireAdmin, async (req, res) => {
    try {
      const entry = await SeoMetadata.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { new: true });
      if (!entry) return res.status(404).json({ error: 'SEO metadata entry not found' });
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update SEO metadata' });
    }
  });

  app.delete("/api/admin/seo-metadata/:id", requireAdmin, async (req, res) => {
    try {
      const entry = await SeoMetadata.findByIdAndDelete(req.params.id);
      if (!entry) return res.status(404).json({ error: 'SEO metadata entry not found' });
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

  app.get("/api/tv/bundle", async (req, res) => {
    try {
      const { Station: StationModel, Genre: GenreModel } = await import('../shared/mongo-schemas');
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
