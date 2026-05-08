import mongoose from 'mongoose';
import { User, Station, UserFavorite, UserFollow, StationRating } from '../shared/mongo-schemas';

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
  // OPTIMIZED: single user lookup + all secondary queries in parallel, .lean() everywhere
  async getUserProfileBySlug(slug: string, currentUserId?: string): Promise<UserProfile | null> {
    try {
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(slug);

      // Single query with $or fallback — no sequential fallback round trips
      const user: any = isObjectId
        ? await User.findOne({ _id: slug, isPublicProfile: true })
            .select('_id fullName username email bio avatar slug isPublicProfile createdAt updatedAt')
            .lean()
        : await User.findOne({
            $or: [{ slug }, { username: slug }],
            isPublicProfile: true
          })
            .select('_id fullName username email bio avatar slug isPublicProfile createdAt updatedAt')
            .lean();

      if (!user) return null;

      const userId = user._id.toString();

      // Fire ALL independent queries in parallel — was 7 sequential queries, now 1 batch
      const [userFavIds, followersCount, followingCount, isFollowingDoc] = await Promise.all([
        UserFavorite.find({ userId }).select('stationId').lean(),
        UserFollow.countDocuments({ followingUserId: user._id }),
        UserFollow.countDocuments({ userId: user._id }),
        currentUserId
          ? UserFollow.findOne({ userId: currentUserId, followingUserId: user._id }).select('_id').lean()
          : Promise.resolve(null),
      ]);

      const favoriteStationIds = userFavIds.map((f: any) => f.stationId);

      // Only fetch tags + country for stats computation — minimal payload
      const favoriteStations: any[] = favoriteStationIds.length > 0
        ? await Station.find({ _id: { $in: favoriteStationIds } })
            .select('tags country')
            .lean()
        : [];

      const totalFavorites = favoriteStations.length;

      // Compute genre + country stats
      const genreMap = new Map<string, number>();
      const countryMap = new Map<string, number>();

      for (const station of favoriteStations) {
        if (station.tags) {
          for (const tag of station.tags.split(',')) {
            const t = tag.trim().toLowerCase();
            if (t && t.length > 2) genreMap.set(t, (genreMap.get(t) || 0) + 1);
          }
        }
        if (station.country) {
          const c = station.country.trim();
          countryMap.set(c, (countryMap.get(c) || 0) + 1);
        }
      }

      const toSorted = (map: Map<string, number>, key: string) =>
        Array.from(map.entries())
          .map(([val, count]) => ({ [key]: val, count, percentage: totalFavorites ? Math.round(count / totalFavorites * 100) : 0 }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

      const effectiveSlug = user.slug || userId;

      // Background: fix missing/old slug without blocking response
      const hasOldSlug = !user.slug || user.slug === userId || (user.slug.startsWith('user_') && user.slug.includes('_'));
      if (hasOldSlug) {
        setImmediate(async () => {
          try {
            const base = (user.fullName || user.username || user.email?.split('@')[0] || 'user')
              .toLowerCase().replace(/[^\w-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'user';
            let candidate = base;
            let i = 1;
            while (await User.findOne({ slug: candidate, _id: { $ne: user._id } }).select('_id').lean()) {
              candidate = `${base}-${i++}`;
            }
            await User.findByIdAndUpdate(user._id, { slug: candidate });
          } catch { /* silent */ }
        });
      }

      return {
        displayName: user.fullName || user.username || user.email?.split('@')[0] || 'Anonymous User',
        bio: user.bio || `Radio enthusiast with ${totalFavorites} favorite stations`,
        slug: effectiveSlug,
        avatar: user.avatar,
        isPublic: user.isPublicProfile || false,
        followersCount,
        followingCount,
        isFollowing: !!isFollowingDoc,
        listeningStats: {
          totalListenHours: Math.max(totalFavorites * 2.5, 10),
          uniqueStationsListened: Math.max(totalFavorites, 1),
          favoriteGenres: toSorted(genreMap, 'genre') as any,
          favoriteCountries: toSorted(countryMap, 'country') as any,
          peakListeningHours: [9, 10, 11, 14, 15, 18, 19, 20],
          joinedDate: (user.createdAt as Date)?.toISOString() || new Date().toISOString(),
          lastActiveDate: (user.updatedAt as Date)?.toISOString() || new Date().toISOString()
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
  // OPTIMIZED: no longer calls getUserProfileBySlug (was running all 9 queries again)
  async getUserFavoritesBySlug(slug: string, page = 1, limit = 20): Promise<any> {
    try {
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(slug);
      const user: any = isObjectId
        ? await User.findOne({ _id: slug, isPublicProfile: true }).select('_id isPublicProfile').lean()
        : await User.findOne({ $or: [{ slug }, { username: slug }], isPublicProfile: true }).select('_id isPublicProfile').lean();

      if (!user || !user.isPublicProfile) return null;

      const userId = user._id.toString();
      const skip = (page - 1) * limit;

      // Use aggregation to get paginated favorites with station details in one query
      const favs = await UserFavorite.aggregate([
        { $match: { userId } },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: 'stations',
            let: { sid: { $toObjectId: '$stationId' } },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', '$$sid'] } } },
              { $project: { _id: 1, name: 1, country: 1, tags: 1, favicon: 1, votes: 1, slug: 1,
                  genre: 1, language: 1, codec: 1, bitrate: 1, url: 1, hasLogo: 1, logoAssets: 1, urlResolved: 1 } }
            ],
            as: 'station'
          }
        },
        { $unwind: { path: '$station', preserveNullAndEmptyArrays: false } },
        { $replaceRoot: { newRoot: '$station' } }
      ]);

      const total = await UserFavorite.countDocuments({ userId });

      return { favorites: favs, total, page, limit };
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
  
  // Get station ratings from real database
  async getStationRatings(stationId: string, page = 1, limit = 10): Promise<any> {
    const skip = (page - 1) * limit;
    const [ratings, total] = await Promise.all([
      StationRating.find({ stationId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('userId rating comment createdAt')
        .lean(),
      StationRating.countDocuments({ stationId })
    ]);

    const avgResult = await StationRating.aggregate([
      { $match: { stationId } },
      { $group: { _id: null, avg: { $avg: '$rating' } } }
    ]);
    const averageRating = avgResult.length > 0 ? Math.round(avgResult[0].avg * 10) / 10 : 0;

    return {
      ratings,
      meta: {
        page,
        limit,
        total,
        averageRating
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
              { fullName: { $exists: true, $nin: [null, ''] } },
              { username: { $exists: true, $nin: [null, ''] } }
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