import { Station, UserListeningHistory, StationSimilarity, UserProfile } from '@workspace/db-shared/mongo-schemas';
import { CacheManager, CacheKeys } from '../cache';
import { performanceCache } from '../performance-cache';
import { isQuotaExceeded, handleQuotaError } from '../utils/quota-guard';

interface UserInteraction {
  sessionId: string;
  stationId: string;
  listenDuration: number;
  interactionType: 'play' | 'skip' | 'favorite' | 'share' | 'seek' | 'volume_change';
  deviceType?: 'mobile' | 'desktop' | 'tablet';
  location?: { country: string; region?: string };
  skipReason?: string;
}

interface RecommendationResult {
  stationId: string;
  score: number;
  reasons: string[];
  confidence: number;
  type: 'content_based' | 'collaborative' | 'hybrid' | 'popularity';
}

interface PersonalizedSimilarStationsOptions {
  sourceStationId: string;
  sessionId?: string;
  limit?: number;
  minConfidence?: number;
}

export class RecommendationEngine {
  private static activeRecommendations = 0;
  private static readonly MAX_CONCURRENT_RECOMMENDATIONS = 3;
  
  static async recordUserInteraction(interaction: UserInteraction): Promise<void> {
    try {
      const station = await Station.findById(interaction.stationId).lean();
      if (!station) return;

      const now = new Date();
      const listenHistory = new UserListeningHistory({
        sessionId: interaction.sessionId,
        stationId: interaction.stationId,
        stationName: station.name,
        country: station.country || 'Unknown',
        genre: this.extractPrimaryGenre(station.tags),
        tags: station.tags,
        listenDuration: interaction.listenDuration,
        interactionType: interaction.interactionType,
        listenedAt: now,
        timeOfDay: now.getHours(),
        dayOfWeek: now.getDay(),
        deviceType: interaction.deviceType,
        location: interaction.location,
        skipReason: interaction.skipReason,
        rating: this.calculateImplicitRating(interaction.listenDuration, interaction.interactionType)
      });

      if (isQuotaExceeded()) return;
      await listenHistory.save();
      
      setImmediate(() => this.updateUserProfile(interaction.sessionId));
      await CacheManager.del(`user_profile_${interaction.sessionId}`);
      
    } catch (error: any) {
      handleQuotaError('recommendation:interaction', error);
    }
  }

  static async getPersonalizedSimilarStations(options: PersonalizedSimilarStationsOptions): Promise<RecommendationResult[]> {
    const { sourceStationId, sessionId, limit = 10, minConfidence = 0.3 } = options;
    
    if (this.activeRecommendations >= this.MAX_CONCURRENT_RECOMMENDATIONS) {
      return this.getFallbackRecommendations(sourceStationId, limit);
    }
    
    this.activeRecommendations++;
    let settled = false;
    try {
      const computePromise = (async () => {
        const userProfile = await this.getUserProfile(sessionId ?? '');
        const sourceStation = await Station.findById(sourceStationId).lean();
        
        if (!sourceStation) return [];

        const strategies = await Promise.all([
          this.getCollaborativeRecommendations(sourceStationId, sessionId ?? '', userProfile),
          this.getContentBasedRecommendations(sourceStationId, userProfile),
          this.getPopularityBasedRecommendations(sourceStation, userProfile)
        ]);

        const recommendations = this.blendRecommendations(strategies, userProfile?.profileStrength || 0);
        
        return recommendations
          .filter(rec => rec.confidence >= minConfidence)
          .slice(0, limit);
      })();
      
      let timeoutHandle: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<RecommendationResult[]>((resolve) => {
        timeoutHandle = setTimeout(() => resolve([]), 8000);
      });

      let result: RecommendationResult[];
      try {
        result = await Promise.race([computePromise, timeoutPromise]);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
      settled = true;
      return result.length > 0 ? result : await this.getFallbackRecommendations(sourceStationId, limit);
        
    } catch (error) {
      settled = true;
      return this.getFallbackRecommendations(sourceStationId, limit);
    } finally {
      if (settled) {
        this.activeRecommendations--;
      } else {
        setTimeout(() => { this.activeRecommendations = Math.max(0, this.activeRecommendations - 1); }, 15000);
      }
    }
  }

  // Content-based recommendations using station features
  private static async getContentBasedRecommendations(
    sourceStationId: string, 
    userProfile?: any
  ): Promise<RecommendationResult[]> {
    const sourceStation = await Station.findById(sourceStationId).lean();
    if (!sourceStation) return [];

    const sourceGenres = this.extractGenres(sourceStation.tags);
    const sourceCountry = sourceStation.country;

    // Build query based on content similarity
    const query: any = {
      _id: { $ne: sourceStationId },
      lastCheckOk: true
    };

    // Prioritize user's preferred genres if available
    if (userProfile?.preferredGenres?.length > 0) {
      const preferredGenreNames = userProfile.preferredGenres.map((g: any) => g.genre);
      query.$or = [
        { tags: { $regex: new RegExp(preferredGenreNames.join('|'), 'i') } },
        { tags: { $regex: new RegExp(sourceGenres.join('|'), 'i') } }
      ];
    } else if (sourceGenres.length > 0) {
      query.tags = { $regex: new RegExp(sourceGenres.join('|'), 'i') };
    }

    const similarStations = await Station.find(query)
      .sort({ votes: -1, clickCount: -1 })
      .limit(50)
      .lean();

    return similarStations.map(station => ({
      stationId: station._id.toString(),
      score: this.calculateContentSimilarity(sourceStation, station, userProfile),
      reasons: this.generateContentReasons(sourceStation, station, userProfile),
      confidence: 0.7,
      type: 'content_based' as const
    })).sort((a, b) => b.score - a.score);
  }

  // Collaborative filtering based on user listening patterns
  private static async getCollaborativeRecommendations(
    sourceStationId: string,
    sessionId: string,
    userProfile?: any
  ): Promise<RecommendationResult[]> {
    // Find users with similar listening patterns
    const userHistory = await UserListeningHistory.find({ sessionId }).lean();
    const userStationIds = userHistory.map(h => h.stationId);

    if (userStationIds.length < 3) return []; // Need enough data

    const similarUsers = await UserListeningHistory.aggregate([
      { $match: { stationId: { $in: userStationIds }, sessionId: { $ne: sessionId } } },
      { 
        $group: { 
          _id: '$sessionId', 
          commonStations: { $addToSet: '$stationId' },
          totalListenDuration: { $sum: '$listenDuration' }
        } 
      },
      { $match: { $expr: { $gte: [{ $size: '$commonStations' }, 2] } } },
      { $sort: { totalListenDuration: -1 } },
      { $limit: 50 }
    ]).option({ maxTimeMS: 5000 });

    if (similarUsers.length === 0) return [];

    // Get recommendations from similar users
    const similarUserIds = similarUsers.map(u => u._id);
    const recommendations = await UserListeningHistory.aggregate([
      { 
        $match: { 
          sessionId: { $in: similarUserIds },
          stationId: { $nin: [sourceStationId, ...userStationIds] },
          listenDuration: { $gte: 30 } // Only stations they listened to for meaningful time
        } 
      },
      { 
        $group: { 
          _id: '$stationId',
          score: { $avg: '$rating' },
          listenerCount: { $sum: 1 },
          avgListenDuration: { $avg: '$listenDuration' }
        } 
      },
      { $match: { listenerCount: { $gte: 2 } } },
      { $sort: { score: -1, listenerCount: -1 } },
      { $limit: 20 }
    ]).option({ maxTimeMS: 5000 });

    return recommendations.map(rec => ({
      stationId: rec._id,
      score: rec.score || 3,
      reasons: [
        `ml_reason_similar_listeners|${rec.listenerCount}`,
        `ml_reason_avg_listen_time|${Math.round(rec.avgListenDuration)}`
      ],
      confidence: Math.min(rec.listenerCount / 10, 0.9),
      type: 'collaborative' as const
    }));
  }

  // Popularity-based recommendations as fallback
  private static async getPopularityBasedRecommendations(
    sourceStation: any,
    userProfile?: any
  ): Promise<RecommendationResult[]> {
    const query: any = {
      _id: { $ne: sourceStation._id },
      lastCheckOk: true
    };

    // Use user preferences if available
    if (userProfile?.preferredCountries?.length > 0) {
      const preferredCountries = userProfile.preferredCountries.map((c: any) => c.country);
      query.country = { $in: preferredCountries };
    } else if (sourceStation.country) {
      query.country = sourceStation.country;
    }

    const popularStations = await Station.find(query)
      .sort({ votes: -1, clickCount: -1 })
      .limit(15)
      .lean();

    return popularStations.map((station, index) => ({
      stationId: station._id.toString(),
      score: (15 - index) / 15, // Normalize by position
      reasons: [
        `ml_reason_popular_in_country|${station.country}`,
        `ml_reason_votes|${station.votes}`
      ],
      confidence: 0.5,
      type: 'popularity' as const
    }));
  }

  // Blend different recommendation strategies
  private static blendRecommendations(
    strategies: RecommendationResult[][],
    profileStrength: number
  ): RecommendationResult[] {
    const [collaborative, contentBased, popularity] = strategies;
    
    // Adjust weights based on profile strength
    const collabWeight = Math.min(profileStrength * 1.5, 0.7);
    const contentWeight = 0.6;
    const popularityWeight = Math.max(0.3 - profileStrength * 0.2, 0.1);

    // Create a map to merge recommendations for the same station
    const stationScores = new Map<string, RecommendationResult>();

    // Add collaborative filtering results
    collaborative.forEach(rec => {
      const existing = stationScores.get(rec.stationId);
      if (existing) {
        existing.score += rec.score * collabWeight;
        existing.reasons.push(...rec.reasons);
        existing.confidence = Math.max(existing.confidence, rec.confidence);
        existing.type = 'hybrid';
      } else {
        stationScores.set(rec.stationId, {
          ...rec,
          score: rec.score * collabWeight,
          type: 'collaborative'
        });
      }
    });

    // Add content-based results
    contentBased.forEach(rec => {
      const existing = stationScores.get(rec.stationId);
      if (existing) {
        existing.score += rec.score * contentWeight;
        existing.reasons.push(...rec.reasons);
        existing.confidence = Math.max(existing.confidence, rec.confidence);
        existing.type = 'hybrid';
      } else {
        stationScores.set(rec.stationId, {
          ...rec,
          score: rec.score * contentWeight,
          type: 'content_based'
        });
      }
    });

    // Add popularity-based results (lower weight)
    popularity.forEach(rec => {
      const existing = stationScores.get(rec.stationId);
      if (existing) {
        existing.score += rec.score * popularityWeight;
        existing.reasons.push(...rec.reasons);
        if (existing.type !== 'hybrid') existing.type = 'hybrid';
      } else {
        stationScores.set(rec.stationId, {
          ...rec,
          score: rec.score * popularityWeight,
          type: 'popularity'
        });
      }
    });

    // Return sorted results
    return Array.from(stationScores.values())
      .sort((a, b) => b.score - a.score);
  }

  // Update user profile based on listening history
  private static async updateUserProfile(sessionId: string): Promise<void> {
    try {
      const recentHistory = await UserListeningHistory.find({ sessionId })
        .sort({ listenedAt: -1 })
        .limit(1000)
        .lean();

      if (recentHistory.length === 0) return;

      // Calculate preferences
      const genreWeights = this.calculateGenrePreferences(recentHistory);
      const countryWeights = this.calculateCountryPreferences(recentHistory);
      const languageWeights = this.calculateLanguagePreferences(recentHistory);

      // Calculate behavioral metrics
      const avgListenDuration = recentHistory.reduce((sum, h) => sum + h.listenDuration, 0) / recentHistory.length;
      const skipRate = recentHistory.filter(h => h.interactionType === 'skip').length / recentHistory.length;
      const peakHours = this.calculatePeakListeningHours(recentHistory);
      const profileStrength = Math.min(recentHistory.length / 50, 1); // Stronger with more data

      // Update or create user profile
      await UserProfile.findOneAndUpdate(
        { sessionId },
        {
          preferredGenres: genreWeights,
          preferredCountries: countryWeights,
          preferredLanguages: languageWeights,
          averageListenDuration: avgListenDuration,
          peakListeningHours: peakHours,
          skipRate,
          totalStationsListened: recentHistory.length,
          uniqueStationsCount: new Set(recentHistory.map(h => h.stationId)).size,
          favoriteStationsCount: recentHistory.filter(h => h.interactionType === 'favorite').length,
          lastListenedAt: recentHistory[0].listenedAt,
          profileStrength,
          updatedAt: new Date()
        },
        { upsert: true, returnDocument: 'after' }
      );

    } catch (error) {
      console.error('Failed to update user profile:', error);
    }
  }

  // Helper methods for ML calculations
  private static extractPrimaryGenre(tags?: string): string | undefined {
    if (!tags) return undefined;
    const genres = ['rock', 'pop', 'jazz', 'classical', 'folk', 'electronic', 'hip-hop', 'country', 'blues', 'reggae'];
    const tagLower = tags.toLowerCase();
    return genres.find(genre => tagLower.includes(genre));
  }

  private static extractGenres(tags?: string): string[] {
    if (!tags) return [];
    const commonGenres = ['rock', 'pop', 'jazz', 'classical', 'folk', 'electronic', 'dance', 'house', 'techno', 'trance', 'hip-hop', 'country', 'blues', 'reggae', 'latin', 'world', 'news', 'talk', 'sports'];
    const tagLower = tags.toLowerCase();
    return commonGenres.filter(genre => tagLower.includes(genre));
  }

  private static calculateImplicitRating(listenDuration: number, interactionType: string): number {
    if (interactionType === 'skip') return 1;
    if (interactionType === 'favorite') return 5;
    if (listenDuration > 300) return 5; // 5+ minutes = love it
    if (listenDuration > 120) return 4; // 2+ minutes = like it
    if (listenDuration > 30) return 3;  // 30+ seconds = neutral
    if (listenDuration > 10) return 2;  // 10+ seconds = mild dislike
    return 1; // quick skip = dislike
  }

  private static calculateContentSimilarity(station1: any, station2: any, userProfile?: any): number {
    let score = 0;
    let factors = 0;

    // Genre similarity
    const genres1 = this.extractGenres(station1.tags);
    const genres2 = this.extractGenres(station2.tags);
    const genreOverlap = genres1.filter(g => genres2.includes(g)).length;
    if (genres1.length > 0 && genres2.length > 0) {
      score += (genreOverlap / Math.max(genres1.length, genres2.length)) * 0.4;
      factors++;
    }

    // Country similarity
    if (station1.country === station2.country) {
      score += 0.3;
    }
    factors++;

    // Language similarity
    if (station1.language && station2.language && station1.language === station2.language) {
      score += 0.2;
    }
    factors++;

    // User preference boost
    if (userProfile?.preferredCountries) {
      const preferredCountry = userProfile.preferredCountries.find((c: any) => c.country === station2.country);
      if (preferredCountry) {
        score += preferredCountry.weight * 0.3;
      }
    }

    return factors > 0 ? score / factors : 0;
  }

  private static generateContentReasons(station1: any, station2: any, userProfile?: any): string[] {
    const reasons = [];
    
    const genres1 = this.extractGenres(station1.tags);
    const genres2 = this.extractGenres(station2.tags);
    const commonGenres = genres1.filter(g => genres2.includes(g));
    
    if (commonGenres.length > 0) {
      reasons.push(`ml_reason_similar_genres|${commonGenres.join(', ')}`);
    }
    
    if (station1.country === station2.country) {
      reasons.push(`ml_reason_same_country|${station1.country}`);
    }
    
    if (station1.language === station2.language && station1.language) {
      reasons.push(`ml_reason_same_language|${station1.language}`);
    }

    if (userProfile?.preferredCountries?.find((c: any) => c.country === station2.country)) {
      reasons.push('ml_reason_matches_country_preference');
    }
    
    return reasons;
  }

  private static calculateGenrePreferences(history: any[]): Array<{ genre: string; weight: number; confidence: number }> {
    const genreCounts = new Map<string, { totalDuration: number; count: number; avgRating: number }>();
    
    history.forEach(h => {
      const genre = this.extractPrimaryGenre(h.tags) || 'unknown';
      const existing = genreCounts.get(genre) || { totalDuration: 0, count: 0, avgRating: 0 };
      existing.totalDuration += h.listenDuration;
      existing.count += 1;
      existing.avgRating = ((existing.avgRating * (existing.count - 1)) + (h.rating || 3)) / existing.count;
      genreCounts.set(genre, existing);
    });

    return Array.from(genreCounts.entries())
      .map(([genre, data]) => ({
        genre,
        weight: Math.min((data.totalDuration / 3600) * (data.avgRating / 5), 1), // Hours * rating factor
        confidence: Math.min(data.count / 10, 1)
      }))
      .filter(p => p.weight > 0.1)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);
  }

  private static calculateCountryPreferences(history: any[]): Array<{ country: string; weight: number; confidence: number }> {
    const countryCounts = new Map<string, { totalDuration: number; count: number }>();
    
    history.forEach(h => {
      const existing = countryCounts.get(h.country) || { totalDuration: 0, count: 0 };
      existing.totalDuration += h.listenDuration;
      existing.count += 1;
      countryCounts.set(h.country, existing);
    });

    return Array.from(countryCounts.entries())
      .map(([country, data]) => ({
        country,
        weight: Math.min(data.totalDuration / 3600, 1), // Normalize by hours
        confidence: Math.min(data.count / 5, 1)
      }))
      .filter(p => p.weight > 0.1)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3);
  }

  private static calculateLanguagePreferences(history: any[]): Array<{ language: string; weight: number; confidence: number }> {
    // Similar to country preferences but for languages
    const langCounts = new Map<string, { totalDuration: number; count: number }>();
    
    history.forEach(h => {
      if (!h.language) return;
      const existing = langCounts.get(h.language) || { totalDuration: 0, count: 0 };
      existing.totalDuration += h.listenDuration;
      existing.count += 1;
      langCounts.set(h.language, existing);
    });

    return Array.from(langCounts.entries())
      .map(([language, data]) => ({
        language,
        weight: Math.min(data.totalDuration / 3600, 1),
        confidence: Math.min(data.count / 5, 1)
      }))
      .filter(p => p.weight > 0.1)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3);
  }

  private static calculatePeakListeningHours(history: any[]): number[] {
    const hourCounts = new Array(24).fill(0);
    history.forEach(h => {
      hourCounts[h.timeOfDay || 0]++;
    });

    const avgCount = hourCounts.reduce((sum, count) => sum + count, 0) / 24;
    return hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter(h => h.count > avgCount * 1.2) // 20% above average
      .map(h => h.hour);
  }

  private static async getUserProfile(sessionId: string): Promise<any> {
    const cacheKey = `user_profile_${sessionId}`;
    let profile = await CacheManager.get(cacheKey);
    
    if (!profile) {
      profile = await UserProfile.findOne({ sessionId }).lean();
      if (profile) {
        await CacheManager.set(cacheKey, profile, { ttl: 300 }); // 5 minutes
      }
    }
    
    return profile;
  }

  private static async getFallbackRecommendations(sourceStationId: string, limit: number): Promise<RecommendationResult[]> {
    const sourceStation = await Station.findById(sourceStationId).select('country').lean();
    if (!sourceStation) return [];

    const country = sourceStation.country ?? '';
    const pool = performanceCache.getSimilarPool(country) || performanceCache.getGlobalPopularPool();

    if (pool && pool.length > 0) {
      const filtered = pool
        .filter((s: any) => s._id?.toString() !== sourceStationId)
        .slice(0, limit);

      return filtered.map((station: any, index: number) => ({
        stationId: station._id.toString(),
        score: (limit - index) / limit,
        reasons: [`Popular in ${country}`],
        confidence: 0.3,
        type: 'popularity' as const
      }));
    }

    const fallbackStations = await Station.find({
      _id: { $ne: sourceStationId },
      country,
      lastCheckOk: true
    })
    .sort({ votes: -1, clickCount: -1 })
    .limit(limit)
    .lean();

    return fallbackStations.map((station, index) => ({
      stationId: station._id.toString(),
      score: (limit - index) / limit,
      reasons: [`Popular in ${country}`],
      confidence: 0.3,
      type: 'popularity' as const
    }));
  }

  /**
   * ULTRA-FAST Similar Stations - Cache-First Architecture
   * 
   * Strategy: Use pre-warmed country pools from performanceCache
   * Target: <50ms response time (just memory read + shuffle)
   * 
   * Priority:
   * 1. Station's country pool (pre-cached)
   * 2. User's selected country pool (pre-cached)
   * 3. Global popular pool (pre-cached)
   */
  static async getSimilarStations(options: {
    stationId: string;
    country?: string;
    limit?: number;
    excludeIds?: string[];
    seedRandom?: number;
  }): Promise<any[]> {
    const { stationId, limit = 12, excludeIds = [] } = options;
    
    try {
      // Get source station with tags and country
      const sourceStation = await Station.findById(stationId)
        .select('country tags')
        .lean();
      if (!sourceStation) return [];
      
      const stationCountry = sourceStation.country;
      if (!stationCountry) return [];
      
      const excludeSet = new Set([stationId, ...excludeIds]);
      const sourceTags = this.parseStationTags(sourceStation.tags);
      
      let pool: any[] = [];
      
      // ===== STEP 1: GENRE/TAG MATCHING FROM SAME COUNTRY ONLY =====
      if (sourceTags.length > 0) {
        const tagPatterns = sourceTags.slice(0, 5).map(tag => 
          new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        );
        
        // CRITICAL: country filter MUST be applied - only same country stations!
        const tagMatchedStations = await Station.find({
          _id: { $nin: Array.from(excludeSet) },
          country: stationCountry, // STRICT COUNTRY LOCK
          lastCheckOk: true,
          $or: tagPatterns.map(pattern => ({ tags: pattern }))
        })
        .sort({ votes: -1 })
        .limit(limit * 3)
        .select('_id name slug favicon country countryCode tags votes clickCount bitrate codec logoAssets localImagePath url url_resolved')
        .lean();
        
        // Score by tag match count
        const scoredStations = tagMatchedStations.map(station => {
          const stationTags = this.parseStationTags(station.tags);
          const matchCount = sourceTags.filter(st => 
            stationTags.some(tt => tt.includes(st) || st.includes(tt))
          ).length;
          return { ...station, _score: matchCount };
        });
        
        scoredStations.sort((a, b) => b._score - a._score || (b.votes || 0) - (a.votes || 0));
        pool.push(...scoredStations);
      }
      
      // ===== STEP 2: FALLBACK - HIGH VOTE STATIONS FROM SAME COUNTRY (votes >= 5000) =====
      // Discovery feature: random selection from popular stations for variety
      if (pool.length < limit) {
        const existingIds = new Set(pool.map(s => s._id.toString()));
        const needed = limit - pool.length;
        
        // Get high-vote stations from same country (5000+ votes) for discovery
        const highVoteStations = await Station.find({
          _id: { $nin: Array.from(excludeSet) },
          country: stationCountry, // STRICT COUNTRY LOCK
          lastCheckOk: true,
          votes: { $gte: 5000 } // Discovery threshold
        })
        .select('_id name slug favicon country countryCode tags votes clickCount bitrate codec logoAssets localImagePath url url_resolved')
        .limit(50) // Get pool for random selection
        .lean();
        
        // Filter out already used stations
        const available = highVoteStations.filter(s => !existingIds.has(s._id.toString()));
        
        // Random shuffle for discovery (different stations on each refresh)
        const shuffled = this.shuffleArray(available);
        pool.push(...shuffled.slice(0, needed));
      }
      
      // ===== STEP 3: FINAL FALLBACK - ANY STATION FROM SAME COUNTRY =====
      // If still not enough (small country with few stations)
      if (pool.length < limit) {
        const existingIds = new Set(pool.map(s => s._id.toString()));
        const needed = limit - pool.length;
        
        const countryStations = await Station.find({
          _id: { $nin: Array.from(excludeSet) },
          country: stationCountry, // STRICT COUNTRY LOCK
          lastCheckOk: true
        })
        .sort({ votes: -1 })
        .limit(needed * 2)
        .select('_id name slug favicon country countryCode tags votes clickCount bitrate codec logoAssets localImagePath url url_resolved')
        .lean();
        
        pool.push(...countryStations.filter(s => !existingIds.has(s._id.toString())).slice(0, needed));
      }
      
      // ===== STEP 4: LOGO PRIORITY =====
      const stationsWithLogo = pool.filter(s => s.logoAssets?.webp256 || s.logoAssets?.webp96);
      const stationsWithoutLogo = pool.filter(s => !s.logoAssets?.webp256 && !s.logoAssets?.webp96);
      
      const result = stationsWithLogo.length >= limit 
        ? stationsWithLogo.slice(0, limit)
        : [...stationsWithLogo, ...stationsWithoutLogo].slice(0, limit);
      
      return result;

    } catch (error) {
      console.error('getSimilarStations error:', error);
      return [];
    }
  }

  /**
   * Parse station tags from comma-separated string to array
   */
  private static parseStationTags(tags?: string): string[] {
    if (!tags) return [];
    return tags.split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);
  }

  /**
   * Apply randomization within quality buckets
   * - Top tier (highest quality) gets shuffled among themselves
   * - Middle tier gets shuffled
   * - Lower tier gets shuffled
   * This ensures high-quality stations are always shown, but order varies
   */
  private static applyQualityBucketRandomization(
    stations: any[], 
    limit: number,
    seedRandom?: number
  ): any[] {
    if (stations.length <= limit) {
      // Shuffle all if we have exactly what we need or less
      return this.shuffleArray(stations, seedRandom);
    }

    // Divide into quality buckets (top 40%, middle 40%, bottom 20%)
    const topSize = Math.ceil(stations.length * 0.4);
    const midSize = Math.ceil(stations.length * 0.4);
    
    const topTier = stations.slice(0, topSize);
    const midTier = stations.slice(topSize, topSize + midSize);
    const bottomTier = stations.slice(topSize + midSize);

    // Shuffle each tier
    const shuffledTop = this.shuffleArray(topTier, seedRandom);
    const shuffledMid = this.shuffleArray(midTier, seedRandom ? seedRandom + 1 : undefined);
    const shuffledBottom = this.shuffleArray(bottomTier, seedRandom ? seedRandom + 2 : undefined);

    // Take proportionally from each tier
    const takeFromTop = Math.ceil(limit * 0.5);  // 50% from top tier
    const takeFromMid = Math.ceil(limit * 0.35); // 35% from middle tier
    const takeFromBottom = limit - takeFromTop - takeFromMid; // Rest from bottom

    const result = [
      ...shuffledTop.slice(0, takeFromTop),
      ...shuffledMid.slice(0, takeFromMid),
      ...shuffledBottom.slice(0, Math.max(takeFromBottom, 0))
    ];

    // Final shuffle to mix tiers together
    return this.shuffleArray(result, seedRandom ? seedRandom + 3 : undefined);
  }

  /**
   * Fisher-Yates shuffle with optional seed for reproducibility
   */
  private static shuffleArray<T>(array: T[], seed?: number): T[] {
    const result = [...array];
    
    // Simple seeded random if seed provided, otherwise use Math.random
    let random: () => number;
    if (seed !== undefined) {
      let s = seed;
      random = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    } else {
      random = Math.random;
    }

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    
    return result;
  }
}