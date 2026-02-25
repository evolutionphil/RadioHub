import express from 'express';
import { UserEngagementService } from '../services/user-engagement-service';

const router = express.Router();
const userEngagementService = new UserEngagementService();

// Get user profile by slug
router.get('/profile/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    // Same authentication pattern as /api/user/favorites (optional - not required for viewing profiles)
    const session = (req as any).session;
    const currentUserId = session?.user?.userId || null; // Optional authentication
    const profile = await userEngagementService.getUserProfileBySlug(slug, currentUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
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
    
    const favorites = await userEngagementService.getUserFavoritesBySlug(
      slug,
      parseInt(page as string),
      parseInt(limit as string)
    );
    
    if (!favorites) {
      return res.status(404).json({ error: 'Profile not found or favorites private' });
    }
    
    res.json(favorites);
  } catch (error) {
    console.error('Error fetching user favorites:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get trending stations
router.get('/trending', async (req, res) => {
  try {
    const { country, limit = '100' } = req.query;
    
    const trending = await userEngagementService.getTrendingStations(
      country as string,
      parseInt(limit as string)
    );
    
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
    
    const favorites = await userEngagementService.getCommunityFavorites(
      country as string,
      genre as string,
      parseInt(limit as string)
    );
    
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
      return res.status(401).json({ error: 'User authentication required' });
    }
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    const result = await userEngagementService.rateStation(
      userId,
      stationId,
      rating,
      review || ''
    );
    
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
    const { userId, action } = req.body; // action: 'add' or 'remove'
    
    if (!userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }
    
    if (action !== 'add' && action !== 'remove') {
      return res.status(400).json({ error: 'Action must be "add" or "remove"' });
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

// Follow a user - Use same auth as other working endpoints
router.post('/follow/:userId', async (req, res) => {
  try {
    // Same authentication pattern as /api/user/favorites
    const session = (req as any).session;
    if (!session?.user?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const currentUserId = session.user.userId;
    const { userId } = req.params;
    
    console.log('🔍 Follow attempt:', { 
      currentUserId, 
      targetUserId: userId, 
      sessionExists: !!session,
      userInSession: !!session?.user,
      userIdInSession: !!session?.user?.userId
    });
    
    if (currentUserId === userId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }
    
    const result = await userEngagementService.followUser(currentUserId, userId);
    console.log('✅ Follow result:', result);
    res.json({ success: true, message: 'User followed successfully' });
  } catch (error) {
    console.error('❌ Error following user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unfollow a user - Use same auth as other working endpoints
router.post('/unfollow/:userId', async (req, res) => {
  try {
    // Same authentication pattern as /api/user/favorites
    const session = (req as any).session;
    if (!session?.user?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const currentUserId = session.user.userId;
    const { userId } = req.params;
    
    console.log('🔍 Unfollow attempt:', { 
      currentUserId, 
      targetUserId: userId, 
      sessionExists: !!session,
      userInSession: !!session?.user,
      userIdInSession: !!session?.user?.userId
    });
    
    const result = await userEngagementService.unfollowUser(currentUserId, userId);
    console.log('✅ Unfollow result:', result);
    res.json({ success: true, message: 'User unfollowed successfully' });
  } catch (error) {
    console.error('❌ Error unfollowing user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get popular user profiles
router.get('/profiles/popular', async (req, res) => {
  try {
    const { limit = '20' } = req.query;
    
    const profiles = await userEngagementService.getPopularProfiles(
      parseInt(limit as string)
    );
    
    res.json({
      profiles,
      meta: {
        count: profiles.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching popular profiles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as userEngagementRouter };