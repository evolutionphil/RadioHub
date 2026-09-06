import { pgCommunityFavorites, pgPopularProfiles, pgPublicProfile, pgRateStation, pgRecentlyPlayed, pgSetFavorite, pgSetFollow, pgStationRatings, pgTrendingStations, pgUserFavorites, } from '../data/postgres-engagement-store';
import { ensurePostgresUser } from '../data/auth-token-store';
export const engagementStore: string = "postgres";
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
        return pgPublicProfile(slug, currentUserId);
    }
    // Get user favorites with station details
    // OPTIMIZED: no longer calls getUserProfileBySlug (was running all 9 queries again)
    async getUserFavoritesBySlug(slug: string, page = 1, limit = 20): Promise<any> {
        return pgUserFavorites(slug, page, limit);
    }
    // Get trending stations based on real user favorites from UserFavorite collection
    async getTrendingStations(country?: string, limit = 50): Promise<any> {
        return pgTrendingStations(country, limit);
    }
    // Get community favorite stations
    async getCommunityFavorites(country?: string, genre?: string, limit = 50): Promise<any> {
        return pgCommunityFavorites(country, genre, limit);
    }
    // Rate a station (mock implementation)
    async rateStation(userId: string, stationId: string, rating: number, review: string): Promise<any> {
        return pgRateStation(userId, stationId, rating, review);
    }
    // Get station ratings from real database
    async getStationRatings(stationId: string, page = 1, limit = 10): Promise<any> {
        return pgStationRatings(stationId, page, limit);
    }
    // Add station to favorites
    async addFavorite(userId: string, stationId: string): Promise<any> {
        return pgSetFavorite(userId, stationId, true);
    }
    // Remove station from favorites
    async removeFavorite(userId: string, stationId: string): Promise<any> {
        return pgSetFavorite(userId, stationId, false);
    }
    // Follow a user
    async followUser(followerId: string, followeeId: string): Promise<any> {
        return pgSetFollow(followerId, followeeId, true);
    }
    // Unfollow a user
    async unfollowUser(followerId: string, followeeId: string): Promise<any> {
        return pgSetFollow(followerId, followeeId, false);
    }
    // Get popular user profiles
    async getPopularProfiles(limit = 20): Promise<any[]> {
        return pgPopularProfiles(limit);
    }
    async getRecentlyPlayed(slug: string, limit = 20): Promise<any[]> {
        return pgRecentlyPlayed(slug, limit);
    }
}
