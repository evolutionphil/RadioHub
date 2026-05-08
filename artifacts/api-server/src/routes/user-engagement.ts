import express from 'express';
import { UserEngagementService } from '../services/user-engagement-service';
import CacheManager from '../cache';
import { User, UserFollow, UserNotification, AuthToken } from '@workspace/db-shared/mongo-schemas';
import { PushNotificationService } from '../services/pushNotificationService';
import { isQuotaExceeded, handleQuotaError, isQuotaError, safeWrite } from '../utils/quota-guard';

const router = express.Router();
const userEngagementService = new UserEngagementService();

// Get user profile by slug
router.get('/profile/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const session = (req as any).session;
    const currentUserId = session?.user?.userId || null;

    const cacheKey = `user-engagement-profile:${slug}:${currentUserId || 'anon'}`;
    const cached = await CacheManager.get(cacheKey);
    if (cached) {
      return void res.json(cached);
    }

    const profile = await userEngagementService.getUserProfileBySlug(slug, currentUserId);
    
    if (!profile) {
      return void res.status(404).json({ error: 'Profile not found' });
    }

    await CacheManager.set(cacheKey, profile, { ttl: 120 });
    res.json(profile);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user favorites by slug
router.get('/profile/:slug/favorites', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = '1', limit = '20' } = req.query;

    const cacheKey = `user-engagement-favs:${slug}:p${page}:l${limit}`;
    const cached = await CacheManager.get(cacheKey);
    if (cached) {
      return void res.json(cached);
    }
    
    const favorites = await userEngagementService.getUserFavoritesBySlug(
      slug,
      parseInt(page as string),
      parseInt(limit as string)
    );
    
    if (!favorites) {
      return void res.status(404).json({ error: 'Profile not found or favorites private' });
    }

    await CacheManager.set(cacheKey, favorites, { ttl: 120 });
    res.json(favorites);
  } catch (error) {
    console.error('Error fetching user favorites:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Combined endpoint: profile + favorites + recently-played in ONE round trip
// Eliminates 3-request waterfall on the frontend (no more enabled: !!userProfile?.isPublic blocking)
router.get('/profile/:slug/full', async (req, res) => {
  try {
    const { slug } = req.params;
    const { favLimit = '20', recentLimit = '20' } = req.query;
    const session = (req as any).session;
    const currentUserId = session?.user?.userId || null;

    const cacheKey = `user-engagement-full:${slug}:${currentUserId || 'anon'}:fl${favLimit}:rl${recentLimit}`;
    const cached = await CacheManager.get(cacheKey);
    if (cached) return void res.json(cached);

    const profile = await userEngagementService.getUserProfileBySlug(slug, currentUserId);
    if (!profile) return void res.status(404).json({ error: 'Profile not found' });

    let favorites: any[] = [];
    let recentlyPlayed: any[] = [];

    if (profile.isPublic) {
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(slug);
      const [favResult, userDoc] = await Promise.all([
        userEngagementService.getUserFavoritesBySlug(slug, 1, parseInt(favLimit as string)),
        isObjectId
          ? User.findById(slug).select('recentlyPlayedStations').lean()
          : User.findOne({ $or: [{ slug }, { username: slug }] }).select('recentlyPlayedStations').lean(),
      ]);

      favorites = favResult?.favorites || [];
      recentlyPlayed = ((userDoc as any)?.recentlyPlayedStations || []).slice(0, parseInt(recentLimit as string));
    }

    const result = { profile, favorites, recentlyPlayed };
    await CacheManager.set(cacheKey, result, { ttl: 90 });
    res.json(result);
  } catch (error) {
    console.error('Error fetching full user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get recently played by slug
router.get('/profile/:slug/recently-played', async (req, res) => {
  try {
    const { slug } = req.params;
    const { limit = '20' } = req.query;

    const cacheKey = `user-engagement-recent:${slug}:l${limit}`;
    const cached = await CacheManager.get(cacheKey);
    if (cached) return void res.json(cached);

    // Fetch from User document recentlyPlayedStations field
    const { User } = await import('@workspace/db-shared/mongo-schemas');
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(slug);
    const user = isObjectId
      ? await User.findById(slug).select('recentlyPlayedStations').lean()
      : await User.findOne({ slug }).select('recentlyPlayedStations').lean();

    const result = (user as any)?.recentlyPlayedStations?.slice(0, parseInt(limit as string)) || [];
    await CacheManager.set(cacheKey, result, { ttl: 60 });
    res.json(result);
  } catch (error) {
    res.json([]);
  }
});

// Get trending stations
router.get('/trending', async (req, res) => {
  try {
    const { country, limit = '100' } = req.query;
    const cacheKey = `user-engagement-trending:${country || 'all'}:${limit}`;
    const cached = await CacheManager.get(cacheKey);
    if (cached) return void res.json(cached);

    const trending = await userEngagementService.getTrendingStations(
      country as string,
      parseInt(limit as string)
    );

    await CacheManager.set(cacheKey, trending, { ttl: 300 });
    res.json(trending);
  } catch (error) {
    console.error('Error fetching trending stations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get community favorites
router.get('/community/favorites', async (req, res) => {
  try {
    const { country, genre, limit = '100' } = req.query;
    const cacheKey = `user-engagement-community:${country || 'all'}:${genre || 'all'}:${limit}`;
    const cached = await CacheManager.get(cacheKey);
    if (cached) return void res.json(cached);
    
    const favorites = await userEngagementService.getCommunityFavorites(
      country as string,
      genre as string,
      parseInt(limit as string)
    );

    await CacheManager.set(cacheKey, favorites, { ttl: 300 });
    res.json(favorites);
  } catch (error) {
    console.error('Error fetching community favorites:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rate a station
router.post('/stations/:stationId/rate', async (req, res) => {
  try {
    const { stationId } = req.params;
    const { rating, review, userId } = req.body;
    
    if (!userId) {
      return void res.status(401).json({ error: 'User authentication required' });
    }
    
    if (!rating || rating < 1 || rating > 5) {
      return void res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    const result = await userEngagementService.rateStation(userId, stationId, rating, review || '');
    res.json(result);
  } catch (error) {
    console.error('Error rating station:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get station ratings
router.get('/stations/:stationId/ratings', async (req, res) => {
  try {
    const { stationId } = req.params;
    const { page = '1', limit = '10' } = req.query;
    
    const ratings = await userEngagementService.getStationRatings(
      stationId,
      parseInt(page as string),
      parseInt(limit as string)
    );
    
    res.json(ratings);
  } catch (error) {
    console.error('Error fetching station ratings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add/remove station favorite
router.post('/stations/:stationId/favorite', async (req, res) => {
  try {
    const { stationId } = req.params;
    const { userId, action } = req.body;
    
    if (!userId) {
      return void res.status(401).json({ error: 'User authentication required' });
    }
    
    if (action !== 'add' && action !== 'remove') {
      return void res.status(400).json({ error: 'Action must be "add" or "remove"' });
    }
    
    const result = action === 'add' 
      ? await userEngagementService.addFavorite(userId, stationId)
      : await userEngagementService.removeFavorite(userId, stationId);
    
    res.json(result);
  } catch (error) {
    console.error('Error updating favorite:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper: resolve userId from session (web) or Bearer token (mobile)
async function resolveCurrentUserId(req: any): Promise<string | null> {
  const session = req.session;
  const fromSession = session?.userId || session?.user?.userId || session?.passport?.user;
  if (fromSession) return fromSession.toString();

  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (bearerToken) {
    const tokenDoc = await AuthToken.findOne({
      token: bearerToken,
      isRevoked: false,
      expiresAt: { $gt: new Date() }
    }).lean();
    if (tokenDoc) return tokenDoc.userId?.toString() ?? null;
  }
  return null;
}

// Helper: resolve target userId - accepts ObjectId OR slug
async function resolveTargetUserId(param: string): Promise<string | null> {
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(param);
  if (isObjectId) return param;
  const user = await User.findOne({ $or: [{ slug: param }, { username: param }] }).select('_id').lean();
  return user ? (user._id as any).toString() : null;
}

// Follow a user
router.post('/follow/:userId', async (req, res) => {
  try {
    const currentUserId = await resolveCurrentUserId(req);
    if (!currentUserId) return void res.status(401).json({ error: 'Authentication required' });

    const targetUserId = await resolveTargetUserId(req.params.userId);
    if (!targetUserId) return void res.status(404).json({ error: 'User not found' });
    if (currentUserId === targetUserId) return void res.status(400).json({ error: 'Cannot follow yourself' });

    // Check already following
    const existing = await UserFollow.findOne({ userId: currentUserId, followingUserId: targetUserId });
    if (existing) return void res.json({ success: true, message: 'Already following' });

    if (isQuotaExceeded()) return void res.status(503).json({ error: 'Database temporarily unavailable' });

    await safeWrite('follow:create', () =>
      UserFollow.create({ userId: currentUserId, followingUserId: targetUserId })
    );

    const follower = await User.findById(currentUserId).select('fullName username slug').lean();
    const followerName = (follower as any)?.fullName || (follower as any)?.username || 'Someone';
    const followerSlug = (follower as any)?.slug;

    safeWrite('follow:notification', () =>
      UserNotification.create({
        userId: targetUserId,
        fromUserId: currentUserId,
        type: 'follow',
        title: 'New Follower',
        message: `${followerName} started following you`,
        data: { followerId: currentUserId, followerSlug }
      }),
      true
    ).catch(() => {});

    // Send push notification (web + mobile, non-blocking)
    PushNotificationService.sendFollowNotification(targetUserId, followerName, followerSlug).catch(() => {});

    res.json({ success: true, message: 'User followed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unfollow a user
router.post('/unfollow/:userId', async (req, res) => {
  try {
    const currentUserId = await resolveCurrentUserId(req);
    if (!currentUserId) return void res.status(401).json({ error: 'Authentication required' });

    const targetUserId = await resolveTargetUserId(req.params.userId);
    if (!targetUserId) return void res.status(404).json({ error: 'User not found' });

    await UserFollow.findOneAndDelete({ userId: currentUserId, followingUserId: targetUserId });
    res.json({ success: true, message: 'User unfollowed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get popular user profiles
router.get('/profiles/popular', async (req, res) => {
  try {
    const { limit = '20' } = req.query;
    const cacheKey = `user-engagement-popular-profiles:${limit}`;
    const cached = await CacheManager.get(cacheKey);
    if (cached) return void res.json(cached);

    const profiles = await userEngagementService.getPopularProfiles(parseInt(limit as string));
    const result = {
      profiles,
      meta: { count: profiles.length, generatedAt: new Date().toISOString() }
    };
    await CacheManager.set(cacheKey, result, { ttl: 300 });
    res.json(result);
  } catch (error) {
    console.error('Error fetching popular profiles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as userEngagementRouter };
