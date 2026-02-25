import mongoose from 'mongoose';
import { User, Station, UserFavorite, UserFollow } from '../../shared/mongo-schemas';

export interface TrendingStation {
  stationId: string;
  totalFavorites: number;
  averageRating: number;
  trendingScore: number;
  weeklyFavorites: number;
  station: {
    name: string;
    country: string;
    genre: string;
    favicon: string;
    slug: string;
    votes: number;
  };
}

export interface CommunityFavorite {
  stationId: string;
  totalFavorites: number;
  averageRating: number;
  totalRatings: number;
  trendingScore: number;
  station: {
    name: string;
    country: string;
    tags: string;
    favicon: string;
    slug: string;
    votes: number;
  };
}

export interface UserProfile {
  displayName: string;
  bio?: string;
  slug: string;
  avatar?: string;
  isPublic: boolean;
  followersCount?: number;
  followingCount?: number;
  isFollowing?: boolean;
  listeningStats: {
    totalListenHours: number;
    uniqueStationsListened: number;
    favoriteGenres: Array<{
      genre: string;
      count: number;
      percentage: number;
    }>;
    favoriteCountries: Array<{
      country: string;
      count: number;
      percentage: number;
    }>;
    peakListeningHours: number[];
    joinedDate: string;
    lastActiveDate: string;
  };
  privacy: {
    showFavorites: boolean;
    showStatistics: boolean;
  };
}

export class UserEngagementService {
  
  // Get user profile by slug (SEO-friendly URL) or ObjectId
  async getUserProfileBySlug(slug: string, currentUserId?: string): Promise<UserProfile | null> {
    try {
      let user;
      
      // Check if slug is a valid MongoDB ObjectId
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(slug);
      
      if (isObjectId) {
        // If it's an ObjectId, find by _id and ensure it's a public profile
        user = await User.findOne({ 
          _id: slug,
          isPublicProfile: true
        });
      } else {
        // Find user by slug (indexed field, fast lookup)
        user = await User.findOne({ 
          slug: slug,
          isPublicProfile: true
        });
        // Fallback: try username if slug not found
        if (!user) {
          user = await User.findOne({ username: slug, isPublicProfile: true });
        }
      }
      
      if (!user) {
        return null;
      }

      // Auto-generate slug if user doesn't have a proper one
      const hasRandomSlug = user.slug && user.slug.startsWith('user_') && user.slug.includes('_');
      if (!user.slug || user.slug === user._id.toString() || /^[0-9a-fA-F]{24}$/.test(user.slug) || hasRandomSlug) {
        const generateSlug = (name: string): string => {
          return name
            .toLowerCase()
            .replace(/[^\w\s-]/g, '') 
            .replace(/\s+/g, '') // Remove spaces completely for "sahinyogurtcu" format
            .replace(/-+/g, '-') 
            .trim()
            .replace(/^-+|-+$/g, '');
        };

        let slugSource = user.fullName || user.username || user.email?.split('@')[0] || 'user';
        let newSlug = generateSlug(slugSource);
        
        // Simple uniqueness check
        let counter = 1;
        let uniqueSlug = newSlug;
        while (await User.findOne({ slug: uniqueSlug, _id: { $ne: user._id } })) {
          uniqueSlug = `${newSlug}-${counter}`;
          counter++;
        }
        
        try {
          await User.findByIdAndUpdate(user._id, { 
            slug: uniqueSlug,
            isPublicProfile: true 
          });
          user.slug = uniqueSlug;
          user.isPublicProfile = true;
        } catch (updateError) {
          console.error('Failed to auto-generate slug:', updateError);
          // Use MongoDB ID as fallback
          user.slug = user._id.toString();
        }
      }
      
      // Get user's favorites from UserFavorite collection (new system)
      const userFavorites = await UserFavorite.find({ userId: user._id.toString() });
      const favoriteStationIds = userFavorites.map(fav => fav.stationId);
      
      // Get station details for the favorites - only count stations that actually exist
      const favoriteStations = favoriteStationIds.length > 0 ? await Station.find({ 
        _id: { $in: favoriteStationIds } 
      }) : [];
      
      // Use the count of actual valid stations, not all favorite records
      const totalFavorites = favoriteStations.length;
      
      // Calculate genre and country statistics
      const genreMap = new Map();
      const countryMap = new Map();
      
      favoriteStations.forEach((station: any) => {
        // Process genres from tags
        if (station.tags) {
          const tags = station.tags.split(',').map((tag: string) => tag.trim().toLowerCase());
          tags.forEach((tag: string) => {
            if (tag && tag.length > 2) {
              genreMap.set(tag, (genreMap.get(tag) || 0) + 1);
            }
          });
        }
        
        // Process countries
        if (station.country) {
          const country = station.country.trim();
          countryMap.set(country, (countryMap.get(country) || 0) + 1);
        }
      });
      
      // Convert maps to sorted arrays
      const favoriteGenres = Array.from(genreMap.entries())
        .map(([genre, count]) => ({
          genre,
          count: count as number,
          percentage: Math.round((count as number / totalFavorites) * 100)
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
        
      const favoriteCountries = Array.from(countryMap.entries())
        .map(([country, count]) => ({
          country,
          count: count as number,
          percentage: Math.round((count as number / totalFavorites) * 100)
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      
      // Get actual follower and following counts from UserFollow collection
      const followersCount = await UserFollow.countDocuments({ followingUserId: user._id });
      const followingCount = await UserFollow.countDocuments({ userId: user._id });
      
      // Check if current user is following this profile
      let isFollowing = false;
      if (currentUserId) {
        const followRelation = await UserFollow.findOne({ 
          userId: currentUserId, 
          followingUserId: user._id 
        });
        isFollowing = !!followRelation;
      }
      
      // Simulate listening stats (in real app, this would come from listening history)
      const mockPeakHours = [9, 10, 11, 14, 15, 18, 19, 20]; // Common listening hours
      
      return {
        displayName: user.fullName || user.username || user.email?.split('@')[0] || 'Anonymous User',
        bio: user.bio || `Radio enthusiast with ${totalFavorites} favorite stations`,
        slug: user.slug || slug,
        avatar: user.avatar,
        isPublic: user.isPublicProfile || false,
        followersCount,
        followingCount,
        isFollowing,
        listeningStats: {
          totalListenHours: Math.max(totalFavorites * 2.5, 10), // Estimate based on favorites
          uniqueStationsListened: Math.max(totalFavorites, 1),
          favoriteGenres,
          favoriteCountries,
          peakListeningHours: mockPeakHours,
          joinedDate: user.createdAt?.toISOString() || new Date().toISOString(),
          lastActiveDate: user.updatedAt?.toISOString() || new Date().toISOString()
        },
        privacy: {
          showFavorites: user.isPublicProfile || false,
          showStatistics: user.isPublicProfile || false
        }
      };
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  }
  
  // Get user favorites with station details
  async getUserFavoritesBySlug(slug: string, page = 1, limit = 20): Promise<any> {
    try {
      const profile = await this.getUserProfileBySlug(slug);
      if (!profile || !profile.privacy.showFavorites) {
        return null;
      }
      
      // Find user again to get favorites - handle both ObjectId and slug
      let user;
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(slug);
      
      if (isObjectId) {
        user = await User.findOne({ 
          _id: slug,
          isPublicProfile: true
        });
      } else {
        user = await User.findOne({ 
          $or: [
            { slug: slug },
            { email: new RegExp(slug, 'i') },
            { username: new RegExp(slug, 'i') },
            { fullName: new RegExp(slug, 'i') }
          ],
          isPublicProfile: true
        });
      }
      
      if (!user) return null;
      
      // Get paginated favorites with station details
      const favoriteStationIds = user.favoriteStations || [];
      const skip = (page - 1) * limit;
      const paginatedIds = favoriteStationIds.slice(skip, skip + limit);
      
      const stations = paginatedIds.length > 0 ? await Station.find({ 
        _id: { $in: paginatedIds } 
      }) : [];
      
      const stationsWithEngagement = stations.map((station: any) => ({
        _id: station._id,
        name: station.name,
        country: station.country,
        tags: station.tags,
        favicon: station.favicon,
        votes: station.votes,
        slug: station.slug,
        engagement: {
          totalFavorites: Math.floor(Math.random() * 50) + 5, // Mock engagement for now
          averageRating: 3.5 + Math.random() * 1.5,
          trendingScore: Math.floor(Math.random() * 100)
        }
      }));
      
      return {
        profile,
        favorites: stationsWithEngagement
      };
    } catch (error) {
      console.error('Error fetching user favorites:', error);
      return null;
    }
  }
  
  // Get trending stations based on real user favorites from UserFavorite collection
  async getTrendingStations(country?: string, limit = 50): Promise<any> {
    try {
      // Get trending from UserFavorite collection (real data)
      let trendingData = await UserFavorite.aggregate([
        {
          $group: {
            _id: '$stationId', // Group by station ID (string)
            totalFavorites: { $sum: 1 },
            users: { $addToSet: '$userId' }
          }
        },
        {
          $addFields: {
            stationObjectId: { $toObjectId: '$_id' } // Convert string to ObjectId
          }
        },
        {
          $lookup: {
            from: 'stations',
            localField: 'stationObjectId', // Use ObjectId for lookup
            foreignField: '_id',
            as: 'station'
          }
        },
        {
          $unwind: { 
            path: '$station', 
            preserveNullAndEmptyArrays: false 
          }
        },
        // Apply country filter if specified
        ...(country && country !== 'global' ? [{
          $match: {
            'station.country': new RegExp(country, 'i')
          }
        }] : []),
        {
          $addFields: {
            trendingScore: {
              $multiply: [
                '$totalFavorites',
                { $add: [{ $divide: [{ $ifNull: ['$station.votes', 0] }, 100] }, 1] }
              ]
            },
            averageRating: 4.2
          }
        },
        {
          $sort: { trendingScore: -1 }
        },
        {
          $limit: limit
        },
        {
          $project: {
            stationId: '$_id',
            totalFavorites: 1,
            weeklyFavorites: '$totalFavorites',
            trendingScore: { $round: ['$trendingScore', 1] },
            averageRating: 1,
            station: {
              name: '$station.name',
              country: '$station.country',
              genre: { $ifNull: ['$station.tags', 'Music'] },
              favicon: '$station.favicon',
              slug: '$station.slug',
              votes: '$station.votes',
              url: '$station.url',
              urlResolved: '$station.urlResolved'
            }
          }
        }
      ]);

      // Only return real user favorites data - no fallback to synthetic data
      
      return {
        trending: trendingData,
        meta: {
          count: trendingData.length,
          country: country || 'global',
          generatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Error fetching trending stations:', error);
      return {
        trending: [],
        meta: {
          count: 0,
          country: country || 'global',
          generatedAt: new Date().toISOString()
        }
      };
    }
  }
  
  // Get community favorite stations
  async getCommunityFavorites(country?: string, genre?: string, limit = 50): Promise<any> {
    try {
      // Build match criteria for stations
      const stationMatch: any = {};
      if (country && country !== 'global') {
        stationMatch.country = new RegExp(country, 'i');
      }
      if (genre && genre !== 'all') {
        stationMatch.tags = new RegExp(genre, 'i');
      }
      
      // Get community favorites from UserFavorite collection (real data)
      let favorites = await UserFavorite.aggregate([
        {
          $group: {
            _id: '$stationId', // Group by station ID (string)
            totalFavorites: { $sum: 1 },
            users: { $addToSet: '$userId' },
            firstFavorited: { $min: '$createdAt' },
            lastFavorited: { $max: '$updatedAt' }
          }
        },
        {
          $match: {
            totalFavorites: { $gte: 1 }
          }
        },
        {
          $addFields: {
            stationObjectId: { $toObjectId: '$_id' } // Convert string to ObjectId
          }
        },
        {
          $lookup: {
            from: 'stations',
            localField: 'stationObjectId', // Use ObjectId for lookup
            foreignField: '_id',
            as: 'station'
          }
        },
        {
          $unwind: { 
            path: '$station', 
            preserveNullAndEmptyArrays: false 
          }
        },
        {
          $match: {
            ...Object.keys(stationMatch).reduce((acc, key) => ({
              ...acc,
              [`station.${key}`]: stationMatch[key]
            }), {})
          }
        }
      ]);

      // Only show real user favorites - no synthetic fallback data

      // Process the results to add rankings and ratings - only real data
      const processedFavorites = favorites.map((item, index) => ({
        stationId: item._id || item.stationId,
        totalFavorites: item.totalFavorites || 0, // Real favorites count
        averageRating: 4.0, // Fixed rating since we don't have real ratings yet
        totalRatings: item.totalFavorites || 0,
        trendingScore: item.trendingScore || (item.totalFavorites || 0) * 2,
        station: {
          name: item.station?.name || item.name,
          country: item.station?.country || item.country,
          tags: item.station?.tags || item.tags || 'Music',
          favicon: item.station?.favicon || item.favicon,
          slug: item.station?.slug || item.slug,
          votes: item.station?.votes || item.votes || 0,
          url: item.station?.url || item.url,
          urlResolved: item.station?.urlResolved || item.urlResolved
        }
      }));
      
      return {
        favorites: processedFavorites,
        meta: {
          count: processedFavorites.length,
          filters: { country: country || 'global', genre: genre || 'all' },
          generatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Error fetching community favorites:', error);
      return {
        favorites: [],
        meta: {
          count: 0,
          filters: { country: country || 'global', genre: genre || 'all' },
          generatedAt: new Date().toISOString()
        }
      };
    }
  }
  
  // Rate a station (mock implementation)
  async rateStation(userId: string, stationId: string, rating: number, review: string): Promise<any> {
    // In real implementation, this would store ratings in a ratings collection
    return {
      success: true,
      message: 'Rating submitted successfully',
      rating: {
        userId,
        stationId,
        rating,
        review,
        createdAt: new Date().toISOString()
      }
    };
  }
  
  // Get station ratings (mock implementation)
  async getStationRatings(stationId: string, page = 1, limit = 10): Promise<any> {
    // Mock ratings for demonstration
    const mockRatings = [];
    for (let i = 0; i < limit; i++) {
      mockRatings.push({
        userId: `user_${i}`,
        rating: 3 + Math.floor(Math.random() * 3),
        review: Math.random() > 0.5 ? `Great station! ${i}` : '',
        isPublic: true,
        helpfulVotes: Math.floor(Math.random() * 10),
        createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
      });
    }
    
    return {
      ratings: mockRatings,
      meta: {
        page,
        limit,
        total: 50, // Mock total
        averageRating: 4.2
      }
    };
  }
  
  // Add station to favorites
  async addFavorite(userId: string, stationId: string): Promise<any> {
    try {
      const existing = await UserFavorite.findOne({ userId, stationId });
      if (existing) {
        return { success: true, message: 'Station already in favorites' };
      }
      
      await UserFavorite.create({ userId, stationId });
      return { success: true, message: 'Station added to favorites' };
    } catch (error) {
      console.error('Error adding favorite:', error);
      return { success: false, message: 'Failed to add favorite' };
    }
  }
  
  // Remove station from favorites
  async removeFavorite(userId: string, stationId: string): Promise<any> {
    try {
      await UserFavorite.findOneAndDelete({ userId, stationId });
      return { success: true, message: 'Station removed from favorites' };
    } catch (error) {
      console.error('Error removing favorite:', error);
      return { success: false, message: 'Failed to remove favorite' };
    }
  }

  // Follow a user
  async followUser(followerId: string, followeeId: string): Promise<any> {
    try {
      const existing = await UserFollow.findOne({ userId: followerId, followingUserId: followeeId });
      if (existing) {
        return { success: true, message: 'Already following this user' };
      }
      
      await UserFollow.create({ userId: followerId, followingUserId: followeeId });
      return { success: true, message: 'User followed successfully' };
    } catch (error) {
      console.error('Error following user:', error);
      return { success: false, message: 'Failed to follow user' };
    }
  }

  // Unfollow a user
  async unfollowUser(followerId: string, followeeId: string): Promise<any> {
    try {
      await UserFollow.findOneAndDelete({ userId: followerId, followingUserId: followeeId });
      return { success: true, message: 'User unfollowed successfully' };
    } catch (error) {
      console.error('Error unfollowing user:', error);
      return { success: false, message: 'Failed to unfollow user' };
    }
  }
  
  // Get popular user profiles
  async getPopularProfiles(limit = 20): Promise<any[]> {
    try {
      const profiles = await User.aggregate([
        {
          $match: {
            isPublicProfile: true,
            $or: [
              { fullName: { $exists: true, $ne: null, $ne: '' } },
              { username: { $exists: true, $ne: null, $ne: '' } }
            ]
          }
        },
        {
          $addFields: {
            favorites: { $ifNull: ['$favoriteStations', []] }
          }
        },
        {
          $addFields: {
            favoriteCount: { $size: '$favorites' },
            slug: { 
              $toLower: { 
                $replaceAll: { 
                  input: { $ifNull: ['$fullName', '$username'] }, 
                  find: ' ', 
                  replacement: '-' 
                }
              }
            }
          }
        },
        {
          $match: {
            favoriteCount: { $gte: 1 } // At least 1 favorite to show
          }
        },
        {
          $sort: { favoriteCount: -1, createdAt: -1 }
        },
        {
          $limit: limit
        },
        {
          $project: {
            _id: 1,
            fullName: 1,
            username: 1,
            email: 1,
            slug: 1,
            favoriteCount: 1,
            avatar: 1,
            createdAt: 1,
            displayName: { 
              $ifNull: [
                '$fullName', 
                '$username', 
                { $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }
              ] 
            }
          }
        }
      ]);
      
      return profiles;
    } catch (error) {
      console.error('Error fetching popular profiles:', error);
      return [];
    }
  }
}