import type { Express } from "express";
import { Advertisement, FooterSocialMedia, SeoMetadata, User, UserFavorite, AppLog, UserListeningHistory, AuthToken } from "../../shared/mongo-schemas";
import { logger } from "../utils/logger";
import crypto from 'crypto';

export function registerMiscRoutes(app: Express, deps: any) {
  const { requireAdmin, requireAuth, apiKeyMiddleware, seedDemoApiKey } = deps;

  // ===========================
  // ITUNES MUSIC DISCOVERY API
  // ===========================

  // Get iTunes Top 100 songs
  app.get("/api/discover/top100", async (req, res) => {
    try {
      const { country = 'US', limit = 100 } = req.query;
      const cacheKey = `itunes_top100_${country}_${limit}`;
      const CacheManager = (await import('../cache')).default;
      let cachedTop100 = await CacheManager.get(cacheKey);
      if (cachedTop100) {
        return res.json({
          results: cachedTop100,
          cached: true
        });
      }

      logger.log(`🎵 Fetching iTunes Top ${limit} for ${country}`);
      const axios = (await import('axios')).default;
      const rssUrl = `https://itunes.apple.com/${String(country).toLowerCase()}/rss/topsongs/limit=${limit}/json`;
      
      const rssResponse = await axios.get(rssUrl, {
        headers: {
          'User-Agent': 'MegaRadio-DiscoverMusic/1.0',
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      const rssData = rssResponse.data;
      const feedResults = rssData?.feed?.entry || [];

      if (feedResults.length === 0) {
        return res.json({ results: [], message: 'No top songs available' });
      }

      const transformedResults = feedResults.map((item: any, index: number) => {
        const previewLink = item.link?.find((link: any) => link.attributes?.['im:assetType'] === 'preview');
        return {
          trackId: parseInt(item.id?.attributes?.['im:id']) || index + 1,
          artistId: 0,
          collectionId: 0,
          trackName: item['im:name']?.label || 'Unknown Track',
          artistName: item['im:artist']?.label || 'Unknown Artist',
          collectionName: item['im:collection']?.['im:name']?.label || 'Unknown Album',
          trackViewUrl: Array.isArray(item.link) ? item.link[0]?.attributes?.href || '' : item.link?.attributes?.href || '',
          previewUrl: previewLink?.attributes?.href || '',
          artworkUrl30: item['im:image']?.[0]?.label?.replace(/55x55|60x60|170x170/g, '30x30') || '',
          artworkUrl60: item['im:image']?.[1]?.label?.replace(/55x55|60x60|170x170/g, '60x60') || '',
          artworkUrl100: item['im:image']?.[2]?.label?.replace(/55x55|60x60|170x170/g, '100x100') || '',
          collectionPrice: parseFloat(item['im:price']?.attributes?.amount) || 0,
          trackPrice: parseFloat(item['im:price']?.attributes?.amount) || 0,
          releaseDate: item['im:releaseDate']?.attributes?.label || '',
          collectionExplicitness: 'notExplicit',
          trackExplicitness: 'notExplicit',
          discCount: 1,
          discNumber: 1,
          trackCount: 1,
          trackNumber: index + 1,
          trackTimeMillis: parseInt(previewLink?.['im:duration']?.label) || 30000,
          country: country as string,
          currency: item['im:price']?.attributes?.currency || 'USD',
          primaryGenreName: item.category?.attributes?.label || 'Music',
          wrapperType: 'track',
          kind: 'song',
          chartPosition: index + 1,
          isTopChart: true
        };
      });

      await CacheManager.set(cacheKey, transformedResults, { ttl: 3600 });
      res.json({
        results: transformedResults,
        cached: false,
        source: 'iTunes Top Songs RSS',
        country,
        limit: parseInt(limit as string)
      });
    } catch (error: any) {
      console.error('iTunes Top 100 fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch top songs', message: error.message });
    }
  });

  // iTunes Search with caching
  app.get("/api/discover/search", async (req, res) => {
    try {
      const { q: query, type = 'song', limit = 50, country = 'US' } = req.query;
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ error: 'Search query is required' });
      }
      const cacheKey = `itunes_search_${type}_${country}_${limit}_${query.toLowerCase().trim()}`;
      const CacheManager = (await import('../cache')).default;
      let cachedResults = await CacheManager.get(cacheKey);
      if (cachedResults) {
        return res.json({ results: cachedResults, cached: true, total: cachedResults.length });
      }
      const { itunesApiService } = await import('../services/itunes-api');
      let results: any[] = [];
      switch (type) {
        case 'song':
        case 'track':
          results = await itunesApiService.searchTracks(query as string, Number(limit), country as string);
          break;
        case 'album':
          results = await itunesApiService.searchAlbums(query as string, Number(limit), country as string);
          break;
        case 'artist':
          results = await itunesApiService.searchArtists(query as string, Number(limit), country as string);
          break;
        default:
          results = await itunesApiService.searchTracks(query as string, Number(limit), country as string);
      }
      await CacheManager.set(cacheKey, results, { ttl: 3600 });
      res.json({ results, cached: false, total: results.length, query: query, type: type });
    } catch (error: any) {
      console.error('iTunes search error:', error);
      res.status(500).json({ error: 'Failed to search iTunes catalog', message: error.message });
    }
  });

  // Get high-quality artwork URL
  app.get("/api/discover/artwork/:trackId", async (req, res) => {
    try {
      const { size = 300 } = req.query;
      const artworkUrl = req.query.url as string;
      if (!artworkUrl) {
        return res.status(400).json({ error: 'Artwork URL parameter required' });
      }
      const { itunesApiService } = await import('../services/itunes-api');
      const highQualityUrl = itunesApiService.getHighQualityArtwork(artworkUrl, Number(size));
      res.json({ originalUrl: artworkUrl, highQualityUrl, size: Number(size) });
    } catch (error: any) {
      console.error('Artwork generation error:', error);
      res.status(500).json({ error: 'Failed to generate artwork URL', message: error.message });
    }
  });

  // Get detailed track information
  app.get("/api/discover/track/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { country = 'US' } = req.query;
      const cacheKey = `itunes_track_${id}_${country}`;
      const CacheManager = (await import('../cache')).default;
      let cachedTrack = await CacheManager.get(cacheKey);
      if (cachedTrack) {
        return res.json({ track: cachedTrack, cached: true });
      }
      const { itunesApiService } = await import('../services/itunes-api');
      const trackDetails = await itunesApiService.getTrackById(id, country as string);
      if (!trackDetails) {
        return res.status(404).json({ error: 'Track not found' });
      }
      await CacheManager.set(cacheKey, trackDetails, { ttl: 7200 });
      res.json({ track: trackDetails, cached: false });
    } catch (error: any) {
      console.error('Track lookup error:', error);
      res.status(500).json({ error: 'Failed to fetch track details', message: error.message });
    }
  });

  // Get detailed album information and its tracks
  app.get("/api/discover/album/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { country = 'US' } = req.query;
      const cacheKey = `itunes_album_${id}_${country}`;
      const CacheManager = (await import('../cache')).default;
      let cachedAlbum = await CacheManager.get(cacheKey);
      if (cachedAlbum) {
        return res.json({ album: cachedAlbum.album, tracks: cachedAlbum.tracks, cached: true });
      }
      const { itunesApiService } = await import('../services/itunes-api');
      const albumData = await itunesApiService.getAlbumById(id, country as string);
      if (!albumData) {
        return res.status(404).json({ error: 'Album not found' });
      }
      await CacheManager.set(cacheKey, albumData, { ttl: 7200 });
      res.json({ album: albumData.album, tracks: albumData.tracks, cached: false });
    } catch (error: any) {
      console.error('Album lookup error:', error);
      res.status(500).json({ error: 'Failed to fetch album details', message: error.message });
    }
  });

  // Get detailed artist information and their albums/tracks
  app.get("/api/discover/artist/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { country = 'US', limit = 25 } = req.query;
      const cacheKey = `itunes_artist_${id}_${country}_${limit}`;
      const CacheManager = (await import('../cache')).default;
      let cachedArtist = await CacheManager.get(cacheKey);
      if (cachedArtist) {
        return res.json({
          artist: cachedArtist.artist,
          albums: cachedArtist.albums,
          tracks: cachedArtist.tracks,
          biography: cachedArtist.biography,
          similarArtists: cachedArtist.similarArtists,
          cached: true
        });
      }
      const { itunesApiService } = await import('../services/itunes-api');
      const artistData = await itunesApiService.getArtistById(id, country as string, Number(limit));
      if (!artistData) {
        return res.status(404).json({ error: 'Artist not found' });
      }
      let biography = null;
      let similarArtists = null;
      if (artistData.artist && artistData.artist.artistName) {
        try {
          const { lastFmApiService } = await import('../services/lastfm-api');
          const lastFmArtist = await lastFmApiService.getArtistInfo(artistData.artist.artistName);
          if (lastFmArtist && lastFmArtist.bio) {
            biography = {
              summary: lastFmApiService.cleanBioText(lastFmArtist.bio.summary),
              content: lastFmApiService.cleanBioText(lastFmArtist.bio.content),
              listeners: lastFmArtist.stats?.listeners,
              playcount: lastFmArtist.stats?.playcount,
              tags: lastFmArtist.tags?.tag || [],
              image: lastFmApiService.getHighQualityImage(lastFmArtist.image || [])
            };
          }
          similarArtists = await lastFmApiService.getSimilarArtists(artistData.artist.artistName, 10);
        } catch (lastFmError) {
          logger.warn('Last.fm API unavailable:', lastFmError);
        }
      }
      const enhancedData = { ...artistData, biography, similarArtists };
      await CacheManager.set(cacheKey, enhancedData, { ttl: 7200 });
      res.json({
        artist: enhancedData.artist,
        albums: enhancedData.albums,
        tracks: enhancedData.tracks,
        biography: enhancedData.biography,
        similarArtists: enhancedData.similarArtists,
        cached: false
      });
    } catch (error: any) {
      console.error('Artist lookup error:', error);
      res.status(500).json({ error: 'Failed to fetch artist details', message: error.message });
    }
  });

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
      const users = await User.find().select('_id email fullName avatar profilePicture authProvider googleId followers followersCount createdAt updatedAt isActive').lean();
      const userIds = users.map(u => u._id.toString());
      const favoriteCounts = await UserFavorite.aggregate([{ $match: { userId: { $in: userIds } } }, { $group: { _id: '$userId', count: { $sum: 1 } } }]);
      const favoriteMap: Record<string, number> = {};
      favoriteCounts.forEach(doc => { favoriteMap[doc._id] = doc.count; });
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
      res.json(usersWithDetails);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch users' });
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
      const user = await User.findByIdAndDelete(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  app.get("/ads.txt", (req, res) => {
    const adsTxt = `# ads.txt file for themegaradio.com\nCONTACT=support@themegaradio.com\n# No authorized sellers`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(adsTxt);
  });

  import('./routes/user-engagement').then(m => app.use('/api/user-engagement', m.userEngagementRouter));
  const apiKeysRouter = (require('./routes/api-keys')).default;
  app.use('/api/api-keys', apiKeysRouter);
  seedDemoApiKey();
  app.use('/api', apiKeyMiddleware);

  app.post('/api/logs/remote', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) return res.status(401).json({ error: 'X-API-Key header required' });
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const { ApiKey: ApiKeyModel } = await import('../shared/mongo-schemas');
      const apiKeyDoc = await ApiKeyModel.findOne({ keyHash });
      if (!apiKeyDoc || apiKeyDoc.status !== 'active') return res.status(401).json({ error: 'Invalid or inactive API key' });
      const { logs, deviceId, platform } = req.body;
      if (!logs || !Array.isArray(logs) || !deviceId || !platform) return res.status(400).json({ error: 'logs, deviceId, and platform are required' });
      const sanitizedLogs = logs.slice(0, 100).map((log: any) => ({
        level: ['info', 'warn', 'error', 'debug', 'fatal'].includes(log.level) ? log.level : 'info',
        message: String(log.message || '').substring(0, 500),
        timestamp: log.timestamp || new Date().toISOString(),
        data: log.data && typeof log.data === 'object' ? JSON.parse(JSON.stringify(log.data).substring(0, 5000)) : {},
      }));
      await AppLog.create({ deviceId, platform, logs: sanitizedLogs, apiKeyHash: keyHash });
      res.json({ success: true, received: sanitizedLogs.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to store logs' });
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

  import('./routes/country-language-mappings').then(m => m.registerCountryLanguageMappingRoutes(app, requireAdmin));
  const urlTranslationsRouter = (require('./routes/url-translations')).default;
  app.use('/api/admin/url-translations', urlTranslationsRouter);
  const performanceRouter = (require('./routes/performance')).default;
  app.use('/api/admin/performance', performanceRouter);

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
