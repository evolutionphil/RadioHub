import mongoose, { Schema, Document } from 'mongoose';

// Interfaces for MongoDB documents
export interface IStation extends Document {
  changeUuid?: string;
  stationuuid: string;
  serverUuid?: string;
  name: string;
  url: string;
  urlResolved?: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countryCode?: string;
  iso31662?: string;
  state?: string;
  language?: string;
  languageCodes?: string;
  genre?: string;
  votes: number;
  // Rating system fields
  averageRating?: number; // Calculated average (1-5 stars)
  totalRatings?: number; // Total number of ratings
  ratingBreakdown?: {
    stars1: number;
    stars2: number;
    stars3: number;
    stars4: number;
    stars5: number;
  };
  lastChangeTime?: Date;
  codec?: string;
  bitrate?: number;
  hls: boolean;
  lastCheckOk: boolean;
  lastCheckTime?: Date;
  lastCheckOkTime?: Date;
  lastLocalCheckTime?: Date;
  clickTimestamp?: Date;
  clickCount: number;
  clickTrend: number;
  sslError?: boolean;
  geoLat?: number;
  geoLong?: number;
  // GeoJSON Point for MongoDB geospatial queries - optimized for $geoNear aggregation
  location?: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude] - GeoJSON format
  };
  hasExtendedInfo?: boolean;
  localImagePath?: string;
  // Optimized logo assets - multiple sizes in WebP format
  logoAssets?: {
    folder: string; // Folder name: {slug}_{id8}
    webp48?: string; // 48px logo filename
    webp96?: string; // 96px logo filename
    webp256?: string; // 256px logo filename
    original?: string; // Original filename (backup)
    status: 'pending' | 'processing' | 'completed' | 'failed';
    processedAt?: Date;
    error?: string; // Error message if failed
    failureType?: 'http_error' | 'invalid_format' | 'timeout' | 'download_failed' | 'processing_failed';
    lastAttempt?: Date; // Used for stale-processing recovery
  };
  isManuallyEdited: boolean;
  manualEditFields?: Record<string, boolean>;
  hasCustomFavicon?: boolean; // If favicon was manually uploaded
  mergedUrls?: string[]; // URLs from merged stations
  mergedStationUuids?: string[]; // UUIDs of stations merged into this one
  slug?: string; // SEO-friendly URL slug
  slugAliases?: string[]; // Old slugs that 301-redirect to current slug
  noIndex?: boolean; // Junk/thin station — exclude from sitemap & emit robots=noindex
  // Multi-language descriptions field - matches original repository pattern
  descriptions?: { [locale: string]: string };
  // Global playback cache fields - stores successful playback methods
  cachedPlaybackMethod?: 'direct' | 'proxy'; // Which method worked last
  cachedPlaybackUrl?: string; // The working URL
  playbackSuccessCount?: number; // How many times this method worked
  lastPlaybackSuccess?: Date; // When it last worked successfully
  mediaGroupId?: mongoose.Types.ObjectId; // Reference to MediaGroup for linked stations
  isFeatured?: boolean; // Manual featured/popular station flag - shows in station's own country
  showInGlobalPopular?: boolean; // Also show in global popular section (requires isFeatured=true)
  aiDescriptionSkipped?: boolean; // Station was checked for AI description but had no info from OpenAI - don't recheck to save tokens
  tagsCheckedAt?: Date; // Last time we re-queried Radio-Browser for this station's tags (whether upstream returned tags or was empty) - used to skip re-querying empty-upstream stations for a cooldown window
  hasLogo?: boolean; // Pre-computed flag: true if station has a valid favicon/logo
  createdAt: Date;
  updatedAt: Date;
}

export interface ICountry extends Document {
  code: string;
  name: string;
  createdAt: Date;
}

export interface ILanguage extends Document {
  code: string;
  name: string;
  createdAt: Date;
}

export interface IMediaGroup extends Document {
  name: string; // Group name like "Radio Antenne Group" or "ORF Stations"
  description?: string;
  logoUrl?: string;
  website?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGenreCleanupDemotion {
  // Why the slug-cleanup migration auto-flipped isDiscoverable to false.
  // 'empty-slug'  → original slug normalized to "" (unrecoverable).
  // 'collision'   → another doc already owns the safe slug; we kept that
  //                 winner and demoted this duplicate.
  reason: 'empty-slug' | 'collision';
  // The raw slug as it existed before normalization (may contain
  // XML/URL-unsafe chars — display only, never link to it).
  originalSlug?: string;
  // What the script tried to normalize the original slug to.
  normalizedSlug?: string;
  // For 'collision' only: identity of the doc that already owns the
  // normalized slug. Stored denormalized so the admin UI can render the
  // winner without an extra lookup.
  collisionWinnerId?: mongoose.Types.ObjectId | string;
  collisionWinnerSlug?: string;
  collisionWinnerName?: string;
  demotedAt: Date;
}

export interface IGenre extends Document {
  name: string;
  slug: string;
  posterImage?: string;
  discoverableImage?: string;
  description?: string;
  isDiscoverable?: boolean;
  stationCount: number;
  cleanupDemotion?: IGenreCleanupDemotion;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICodec extends Document {
  name: string;
  stationCount: number;
  createdAt: Date;
}

// Global station playback cache for sharing successful methods across all users
export interface IStationPlaybackCache extends Document {
  stationId: string; // MongoDB station ID
  method: 'direct' | 'proxy'; // Which method worked
  workingUrl: string; // The URL that worked
  successCount: number; // How many times this method worked
  lastSuccessTime: Date; // When it last worked
  createdAt: Date;
  updatedAt: Date;
}

export interface ISyncLog extends Document {
  syncType: 'full' | 'incremental';
  status: 'running' | 'completed' | 'failed';
  stationsProcessed: number;
  stationsAdded: number;
  stationsUpdated: number;
  stationsSkipped: number;
  stationsAutoFlagged?: number;
  errorMessage?: string;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
}

// User listening behavior tracking for ML recommendations
export interface IUserListeningHistory extends Document {
  userId?: string; // Session-based user ID (for anonymous users)
  sessionId: string; // Browser session ID
  stationId: string; // MongoDB station ID
  stationName: string;
  country: string;
  genre?: string;
  tags?: string;
  // Interaction metrics
  listenDuration: number; // seconds listened
  interactionType: 'play' | 'skip' | 'favorite' | 'share' | 'seek' | 'volume_change';
  listenedAt: Date;
  // Context data
  timeOfDay: number; // 0-23 hour
  dayOfWeek: number; // 0-6 (Sunday = 0)
  deviceType?: 'mobile' | 'desktop' | 'tablet';
  location?: {
    country: string;
    region?: string;
  };
  // Quality metrics
  skipReason?: 'bad_quality' | 'wrong_genre' | 'language' | 'ads' | 'other';
  rating?: number; // 1-5 implicit rating based on listen duration
  createdAt: Date;
}

// Station similarity matrix for collaborative filtering
export interface IStationSimilarity extends Document {
  stationId1: string;
  stationId2: string;
  similarityScore: number; // 0-1 score
  confidence: number; // based on sample size
  calculationType: 'content_based' | 'collaborative' | 'hybrid';
  features: {
    genreSimilarity?: number;
    countryMatch?: boolean;
    languageMatch?: boolean;
    userOverlap?: number;
    tagSimilarity?: number;
  };
  lastCalculated: Date;
  sampleSize: number; // users who listened to both stations
  createdAt: Date;
  updatedAt: Date;
}

// User preference profile for personalized recommendations
export interface IUserProfile extends Document {
  sessionId: string;
  userId?: string;
  // Learned preferences
  preferredGenres: Array<{
    genre: string;
    weight: number; // 0-1 preference strength
    confidence: number; // based on sample size
  }>;
  preferredCountries: Array<{
    country: string;
    weight: number;
    confidence: number;
  }>;
  preferredLanguages: Array<{
    language: string;
    weight: number;
    confidence: number;
  }>;
  // Behavioral patterns
  averageListenDuration: number;
  peakListeningHours: number[]; // Hours when user is most active
  skipRate: number; // 0-1 how often user skips
  // Interaction patterns
  totalStationsListened: number;
  uniqueStationsCount: number;
  favoriteStationsCount: number;
  lastListenedAt: Date;
  profileStrength: number; // 0-1 how confident we are in predictions
  createdAt: Date;
  updatedAt: Date;
}


export interface IUser extends Document {
  username: string;
  email: string;
  passwordHash: string;
  fullName: string;
  name?: string;
  bio?: string;
  role: 'admin' | 'moderator' | 'user';
  status: 'active' | 'inactive' | 'suspended';
  isActive?: boolean;
  authProvider?: string;
  profilePicture?: string;
  lastLoginAt?: Date;
  location?: string;
  avatar?: string;
  profileImageUrl?: string;
  isPublicProfile?: boolean;
  isSeedProfile?: boolean;
  emailVerified: boolean;
  emailVerificationToken?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  resetPasswordExpiry?: Date;
  
  // Social authentication IDs
  googleId?: string;
  facebookId?: string;
  appleId?: string;
  pushSubscription?: any;
  slug?: string;
  favoriteStations?: string[];
  recentlyPlayedStations?: Array<{
    stationId: string;
    playedAt: Date;
    playDuration?: number;
  }>;
  preferences?: {
    theme?: 'dark' | 'light';
    language?: string;
    autoplay?: boolean;
    volume?: number;
    notificationsEnabled?: boolean;
    playAtLogin?: 'LAST_PLAYED' | 'RANDOM' | 'FAVORITE';
  };
  theme?: 'dark' | 'light';
  language?: string;
  autoplay?: boolean;
  volume?: number;
  playAtLogin?: 'LAST_PLAYED' | 'RANDOM' | 'FAVORITE';
  permissions: {
    canManageStations: boolean;
    canManageUsers: boolean;
    canRunSync: boolean;
    canViewAnalytics: boolean;
    canExportData: boolean;
  };
  // Enhanced social features
  following?: string[]; // User IDs this user follows
  followers?: string[]; // User IDs that follow this user
  followersCount: number;
  followingCount: number;
  favoriteStationsCount: number;
  totalListeningTime: number; // Total minutes listened
  stationsCreated?: string[]; // Stations submitted by this user
  stationsCreatedCount: number;
  // User activity stats
  stats?: {
    totalPlays: number;
    totalListeningHours: number;
    favoriteGenres: string[];
    mostPlayedStation?: string;
    joinDate: Date;
    lastActiveDate: Date;
    streakDays: number;
  };
  subscription?: {
    plan: 'none' | 'remove_ads' | 'premium_monthly' | 'premium_yearly' | 'premium_lifetime';
    platform: 'ios' | 'android' | 'tvos' | 'macos' | 'web' | 'admin';
    productId?: string;
    transactionId?: string;
    originalTransactionId?: string;
    receipt?: string;
    purchaseToken?: string;
    expiresAt?: Date | null;
    startedAt?: Date;
    isTrial?: boolean;
    isActive: boolean;
    cancelledAt?: Date;
    lastVerifiedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Additional interfaces for mega radio API features
export interface IStationRating extends Document {
  stationId: string;
  userId: string;
  sessionId?: string; // For anonymous users
  rating: number; // 1-5 stars
  comment?: string;
  ipAddress?: string; // For duplicate prevention
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserFavorite extends Document {
  userId: string;
  stationId: string;
  createdAt: Date;
}

// Enhanced user profile for public display and SEO
export interface IPublicUserProfile extends Document {
  sessionId: string;
  userId?: string;
  displayName?: string;
  bio?: string;
  avatar?: string;
  slug: string; // SEO-friendly URL slug
  isPublic: boolean;
  
  // User collections
  favoriteStations: string[];
  customCollections: Array<{
    name: string;
    slug: string;
    description?: string;
    stationIds: string[];
    isPublic: boolean;
    createdAt: Date;
  }>;
  
  // Listening statistics for SEO content
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
    joinedDate: Date;
    lastActiveDate: Date;
  };
  
  // Privacy settings
  privacy: {
    showFavorites: boolean;
    showListeningHistory: boolean;
    showStatistics: boolean;
    allowPublicCollections: boolean;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

// Station engagement metrics for social proof
export interface IStationEngagement extends Document {
  stationId: string;
  
  // Favorite metrics
  totalFavorites: number;
  recentFavorites: Array<{
    userId: string;
    favoritedAt: Date;
  }>;
  
  // User ratings and reviews
  ratings: Array<{
    userId: string;
    rating: number; // 1-5 stars
    review?: string;
    isPublic: boolean;
    helpfulVotes: number;
    createdAt: Date;
  }>;
  averageRating: number;
  totalRatings: number;
  
  // Trending metrics
  trendingScore: number; // 0-100 trending indicator
  weeklyFavorites: number;
  monthlyFavorites: number;
  peakListeningHours: Array<{
    hour: number;
    listenerCount: number;
  }>;
  
  // Geographic popularity
  popularInCountries: Array<{
    country: string;
    favoriteCount: number;
    percentage: number;
  }>;
  
  // User-generated tags
  userTags: Array<{
    tag: string;
    count: number;
    users: string[];
  }>;
  
  lastUpdated: Date;
  createdAt: Date;
}

export interface IAnalyticsEvent extends Document {
  stationId: string;
  userId?: string;
  event: 'play' | 'stop' | 'favorite' | 'search' | 'rating' | 'click';
  metadata: Record<string, any>;
  ip?: string;
  userAgent?: string;
  timestamp: Date;
}

// Station Debug Log Interface - tracks all station failures and issues
export interface IStationDebugLog extends Document {
  stationId: string;
  stationName: string;
  stationUrl: string;
  errorType: 'AUDIO_ERROR' | 'CONNECTION_TIMEOUT' | 'STREAM_UNAVAILABLE' | 'CODEC_UNSUPPORTED' | 'CORS_ERROR' | 'NETWORK_ERROR';
  errorMessage: string;
  errorDetails?: {
    errorCode?: number;
    errorMessage?: string;
    errorName?: string;
    networkState?: number;
    readyState?: number;
    statusCode?: number;
    headers?: Record<string, string>;
    stackTrace?: string;
    attemptCount?: number;
    lastAttemptUrl?: string;
    occurrenceCount?: number;
    audioProperties?: {
      currentTime?: number;
      duration?: number;
      buffered?: number;
      volume?: number;
      muted?: boolean;
      paused?: boolean;
      ended?: boolean;
      seeking?: boolean;
      crossOrigin?: string;
      preload?: string;
    };
    browserInfo?: {
      userAgent?: string;
      platform?: string;
      language?: string;
      cookieEnabled?: boolean;
      onLine?: boolean;
    };
    connectionInfo?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
    };
    streamAnalysis?: {
      isHLS?: boolean;
      isPlaylist?: boolean;
      isLautFm?: boolean;
      isSimpleMp3?: boolean;
      detectedFormat?: string;
      contentType?: string;
      contentLength?: number;
    };
  };
  stationMeta?: {
    country?: string;
    language?: string;
    codec?: string;
    bitrate?: number;
    isHLS?: boolean;
    isPlaylist?: boolean;
    favicon?: string;
    votes?: number;
    clickCount?: number;
  };
  userAgent?: string;
  clientIP?: string;
  timestamp: Date;
  isResolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  notes?: string;
  // User tracking for multiple reports
  reportingUsers: Array<{
    userAgent: string;
    clientIP: string;
    timestamp: Date;
  }>;
  uniqueUserCount: number;
  totalOccurrences: number;
  // Server logs captured during the error
  serverLogs?: string[];
}

export interface IFeedback extends Document {
  type: 'bug' | 'feature' | 'general';
  subject: string;
  message: string;
  email?: string;
  userId?: string;
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  response?: string;
  createdAt: Date;
  updatedAt?: Date;
}

// New missing features interfaces
export interface IStationComment extends Document {
  stationId: string;
  userId: string;
  username: string;
  content: string;
  rating?: number; // 1-5 stars optional
  likes: number;
  dislikes: number;
  likedBy: string[];
  dislikedBy: string[];
  isModerated: boolean;
  parentCommentId?: string; // For replies
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserSession extends Document {
  userId: string;
  sessionData: {
    currentStation?: string;
    volume: number;
    isPlaying: boolean;
    lastActivity: Date;
    preferences: Record<string, any>;
  };
  expiresAt: Date;
  createdAt: Date;
}

export interface INotification extends Document {
  userId: string;
  type: 'new_station' | 'favorite_update' | 'comment_reply' | 'system' | 'promotional' | 'follow';
  title: string;
  message: string;
  data?: Record<string, any>;
  isRead: boolean;
  createdAt: Date;
}

export interface IAdvancedSearch extends Document {
  userId?: string;
  query: string;
  filters: {
    country?: string;
    language?: string;
    genre?: string;
    codec?: string;
    bitrateMin?: number;
    bitrateMax?: number;
    hasSSL?: boolean;
    isWorking?: boolean;
  };
  results: number;
  searchedAt: Date;
}

// Bulk AI Description Generation Job - tracks progress for auto-resume
export interface IBulkDescriptionJob extends Document {
  jobId: string; // Unique job ID for tracking
  filterByCountry?: string; // Filter by country code (e.g., 'FR', 'TR')
  status: 'running' | 'paused' | 'completed' | 'failed'; // Job status
  totalStations: number; // Total stations to process
  processedStations: number; // Stations processed so far
  successCount: number; // Successfully generated descriptions
  failedCount: number; // Failed descriptions
  skippedCount: number; // Skipped (no info or fallback)
  lastProcessedStationId?: string; // Last station ID processed (for resume)
  lastProcessedSkip?: number; // Last skip value (for resume with pagination)
  errorMessage?: string; // Error message if failed
  createdAt: Date;
  updatedAt: Date;
}

// Scheduled cross-country logo + tag backfill — one row per cron sweep so
// admins can see "DE: 372 logos enqueued, 295 tags hydrated" without
// re-running the manual scripts. See `services/scheduled-backfill.ts`.
// A small sample of stations a single per-country backfill phase actually
// touched, persisted on the BackfillRun row so admins can click straight
// from the run detail page into a problem station instead of grepping
// server logs (Task #234). Capped to `BACKFILL_SAMPLE_STATIONS_PER_COUNTRY`
// in `services/scheduled-backfill.ts` to keep the document small.
export interface IBackfillRunSampleStation {
  _id: string;
  slug?: string;
  name?: string;
}
export interface IBackfillRunCountryLogos {
  countryCode: string;
  candidates: number;
  enqueued: number;
  // Per-country wall time for the logo-enqueue phase (Task #235), so the
  // detail page can show which country/step actually dominated a slow
  // Sunday sweep instead of just the overall `durationMs`.
  durationMs?: number;
  // Sample of stations whose `logoAssets` was actually $unset by this
  // sweep (i.e. the head of the candidate filter, capped to N).
  sampleStations?: IBackfillRunSampleStation[];
}
export interface IBackfillRunCountryTags {
  countryCode: string;
  processed: number;
  hydrated: number;
  emptyUpstream: number;
  failed: number;
  // Per-country wall time for the tag-hydration phase (Task #235). This
  // is the radio-browser-bound step so it's typically the long pole on
  // markets with thousands of un-hydrated stations.
  durationMs?: number;
  // Sample of stations the tags-hydration phase considered (head of the
  // candidate filter at sweep start, capped to N). The hydrator itself
  // doesn't report which stationuuids it touched, so this is the
  // intent-list rather than per-result success/fail.
  sampleStations?: IBackfillRunSampleStation[];
}
export interface IBackfillRun extends Document {
  trigger: string; // 'cron:weekly' | 'manual:logos:<CC>' | 'manual:tags:<CC>'
  status: 'running' | 'completed' | 'failed';
  topN: number;
  // When set, the sweep targeted just this country (admin override) instead
  // of the cron's top-N aggregation. Persisted so history rows are
  // unambiguous when admins backfill a long-tail market on demand.
  overrideCountry?: string;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  logos: IBackfillRunCountryLogos[];
  tags: IBackfillRunCountryTags[];
  errorMessage?: string;
  // Failed retry attempts before the final outcome. Empty when the run
  // succeeded on the first try. Populated by the bounded auto-retry in
  // `services/scheduled-backfill.ts` so admins can see whether a run
  // recovered after a transient blip vs. failed cleanly first time.
  attempts?: IBackfillRunAttempt[];
}

export interface IBackfillRunAttempt {
  attempt: number; // 1-indexed
  error: string;
  failedAt: Date;
}

// Daily per-country coverage snapshot — populated by
// `services/scheduled-coverage-snapshot.ts` so the admin coverage page can
// show a 30-day trend/sparkline beside today's numbers instead of just the
// current point-in-time value.
export interface ICoverageSnapshot extends Document {
  countryCode: string;     // upper-case ISO code, e.g. "DE"
  snapshotDate: Date;      // midnight UTC of the snapshot day (one row per country/day)
  total: number;
  withLogo: number;
  withTags: number;
  logoCoveragePct: number; // rounded to 0.1
  tagCoveragePct: number;  // rounded to 0.1
  // How this row landed in the collection:
  //   'cron'     — written by the nightly snapshot job from live data
  //   'backfill' — seeded by `scripts/backfill-coverage-snapshots.ts`
  //                from existing station signals (best-effort
  //                reconstruction; tag counts in particular use station
  //                createdAt as a proxy because we don't track when each
  //                station first received tags).
  // Rows missing this field were written before the discriminator
  // existed; the API and UI treat them as 'cron'.
  source?: 'cron' | 'backfill';
  createdAt: Date;
}

// Task #232: persisted status of the first-deploy historical coverage
// backfill (`services/coverage-backfill-on-boot.ts`). The seeder runs in
// the background and only logs to stdout, which leaves admins with no
// in-app way to tell whether it ran on this deploy, when, or whether it
// failed. We persist a single "latest" doc that the admin coverage page
// reads so the outcome is visible without grepping logs.
//
// Singleton-style: there is exactly one document in this collection,
// keyed on `key: 'latest'` so re-runs on the same node and across
// restarts simply overwrite the previous status. The collection is
// intentionally tiny — no history, just "what happened most recently".
export type CoverageBackfillBootOutcome =
  | 'skipped-env'             // SKIP_COVERAGE_BACKFILL_ON_BOOT=true
  | 'skipped-already-seeded'  // historical day count >= threshold
  | 'skipped-count-error'     // distinct() on snapshots failed; never started
  | 'running'                 // kicked off, not yet returned
  | 'done'                    // finished, rows seeded
  | 'done-no-stations'        // finished, stations collection empty
  | 'failed';                 // seeder threw

export interface ICoverageBackfillStatus extends Document {
  key: 'latest';
  outcome: CoverageBackfillBootOutcome;
  message: string;
  // When the boot evaluation observed this outcome. For 'running' this
  // is the start time; for terminal outcomes this is the boot
  // evaluation time and `finishedAt` is the seeder completion time.
  observedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  // Threshold + observed counts that drove the boot decision.
  thresholdDays?: number;
  historicalDayCount?: number;
  // Configured + actual seed window.
  seedDays?: number;
  daysSeeded?: number;
  inserted?: number;
  preserved?: number;
  // Populated for `failed` outcomes.
  error?: string;
  updatedAt: Date;
}

// Task #316: bounded history of past first-deploy backfill boot
// evaluations. The singleton `CoverageBackfillStatus` doc above only
// remembers the most recent outcome; this collection keeps one row per
// evaluation so admins can see whether the last few deploys all
// skipped because the threshold was met, or whether one of them
// silently failed. Inserts happen only on terminal outcomes (skipped*,
// done*, failed) — the transient `running` state is left to the
// singleton so the history doesn't accumulate two rows per boot.
// `services/coverage-backfill-on-boot.ts` prunes the collection back
// to `COVERAGE_BACKFILL_HISTORY_MAX` rows after every insert so it
// can't grow unbounded.
export interface ICoverageBackfillRun extends Document {
  outcome: CoverageBackfillBootOutcome;
  message: string;
  observedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  thresholdDays?: number;
  historicalDayCount?: number;
  seedDays?: number;
  daysSeeded?: number;
  inserted?: number;
  preserved?: number;
  error?: string;
  createdAt: Date;
}

// Task #132: weekly genre-slug cleanup audit log. Mirrors the BackfillRun
// shape so admins can see "scanned 1284, normalized 3, demoted 2" without
// having to grep server logs. See `services/scheduled-genre-slug-cleanup.ts`.
export interface IGenreSlugCleanupRun extends Document {
  trigger: string; // 'cron:weekly' | 'manual' | 'boot:deploy'
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  scanned: number;
  alreadyValid: number;
  normalized: number;
  markedUndiscoverable: number;
  emptySlugMarked: number;
  collisionMarked: number;
  errorCount: number;
  rewarmed: boolean;
  errorMessage?: string;
}

// Task #330: nightly Genre.stationCount recompute audit log. Mirrors
// the GenreSlugCleanupRun shape so admins can see "scanned 1284
// genres, updated 3" without grepping logs and confirm the cron has
// been firing reliably. See `services/genre-station-counts.ts` and
// `services/scheduled-genre-station-counts.ts`.
export interface IGenreStationCountsRun extends Document {
  trigger: string; // 'cron:nightly' | 'admin-manual' | bulk-op trigger labels
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  totalGenres: number;
  updatedSlugs: number;
  errorMessage?: string;
}

// Blacklisted Station Interface - prevents re-syncing deleted stations
export interface IBlacklistedStation extends Document {
  stationUuid?: string; // Original Radio Browser UUID
  url: string; // Station URL for identification
  name: string; // Station name for admin reference
  reason?: string; // Reason for blacklisting
  deletedBy?: string; // Admin who deleted it
  deletedAt: Date;
  // Prevention fields
  radioBrowserId?: string; // Radio Browser changeuuid for matching
  createdAt: Date;
}

export interface IPage extends Document {
  slug: string;
  name: string;
  contents: string;
  isPublished: boolean;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

// Translation system interfaces
export interface ITranslationKey extends Document {
  key: string; // e.g., 'login', 'welcome_message'
  defaultValue: string; // Default text in English
  description?: string; // Where this text appears
  context?: string; // Additional context for translators
  category: string; // e.g., 'auth', 'navigation', 'forms'
  isPlural?: boolean; // If this key has plural forms
  createdAt: Date;
  updatedAt: Date;
}

export interface ITranslation extends Document {
  keyId: mongoose.Types.ObjectId; // Reference to TranslationKey
  language: string; // Language code (e.g., 'en', 'es', 'tr')
  value: string; // Translated text
  isCompleted: boolean; // If translation is finalized
  lastModified: Date;
  createdAt: Date;
}

export interface ITranslationLanguage extends Document {
  code: string; // Language code (e.g., 'en', 'es', 'tr')
  name: string; // Language name (e.g., 'English', 'Spanish', 'Turkish')
  isEnabled: boolean; // If this language is active
  isDefault?: boolean; // If this is the default language
  createdAt: Date;
}

export interface ITranslationMetadata extends Document {
  scope: string; // Always 'global' - singleton identifier
  languagesVersion: number; // Auto-incremented version number
  lastBumpedAt: Date; // When version was last incremented
  notes?: string; // Optional admin notes
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Task #191 — Cached Google Search Console URL Inspection results for every
 * URL we publish in the sitemap. Refreshed on a schedule by the
 * `gsc-inspection` service so admins can see, without leaving the app,
 * whether the URLs we already submitted to Google have actually been indexed.
 */
export interface IGscUrlInspection extends Document {
  url: string;
  language: string;
  group: 'static' | 'country' | 'station' | 'genre';
  // Normalized bucket so the UI can filter without parsing GSC's free-form
  // strings (which are localized + sometimes change wording across years).
  state:
    | 'indexed'
    | 'crawled-not-indexed'
    | 'discovered-not-indexed'
    | 'excluded'
    | 'error'
    | 'unknown'
    | 'pending';
  // Raw values from the GSC URL Inspection API response (see
  // https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect).
  coverageState?: string;
  verdict?: string;
  robotsTxtState?: string;
  indexingState?: string;
  pageFetchState?: string;
  lastCrawlTime?: Date;
  googleCanonical?: string;
  userCanonical?: string;
  inspectionResultLink?: string;
  // Last-error / freshness bookkeeping so admins can see when data is stale.
  lastInspectedAt?: Date;
  lastError?: string;
  errorCount: number;
  // Discovery bookkeeping so the scheduler can rotate cheapest-first.
  discoveredAt: Date;
  updatedAt: Date;
  // Task #266 — auto-resubmit bookkeeping. `notIndexedSince` is the first
  // time GSC reported one of the "not indexed" buckets for this URL and
  // is cleared when the state flips back to indexed/excluded. The
  // resubmit fields track the most recent IndexNow re-ping so admins can
  // see (and the cron can rate-limit) repeated attempts.
  notIndexedSince?: Date;
  lastResubmitAt?: Date;
  lastResubmitStatus?: 'success' | 'failed';
  lastResubmitError?: string;
  resubmitCount: number;
}

/**
 * Task #267 — Daily aggregate snapshot of GSC indexing state, so admins
 * can see trends (last 30/90 days) instead of just the latest snapshot.
 *
 * One row per (date UTC midnight, language, group). `language='all'` and
 * `group='all'` rows store the cross-cutting totals so the dashboard can
 * draw an overall trend line without an extra aggregate query.
 */
export interface IGscIndexingSnapshot extends Document {
  date: Date;
  language: string;
  group: 'static' | 'country' | 'station' | 'genre' | 'all';
  total: number;
  indexed: number;
  crawledNotIndexed: number;
  discoveredNotIndexed: number;
  excluded: number;
  error: number;
  pending: number;
  unknown: number;
  createdAt: Date;
}

export interface IIndexNowLog extends Document {
  timestamp: Date;
  host: string;
  urlCount: number;
  status: 'success' | 'failed';
  statusCode?: number;
  trigger: 'manual' | 'station-update' | 'sitemap-regen' | 'sync-complete' | 'sitemap-diff';
  errorMessage?: string;
  sampleUrls?: string[];
  retryAttempt?: number;
  responseTime?: number;
  // For sitemap-diff submissions, the calendar night (UTC YYYY-MM-DD) the
  // submission is attributed to. Set when an admin manually re-runs a
  // specific past night so the resulting submission appears under that
  // night's row instead of today's. Nightly cron submissions leave this
  // unset and are grouped by `timestamp` as before.
  runDate?: string;
  createdAt: Date;
}

export interface ISitemapUrlSnapshot extends Document {
  // 'stations' added in task #339 — per-language station chunks. For
  // 'stations' rows `chunk` is required and the unique key is
  // (type, language, chunk); for 'main'/'genres' `chunk` is absent.
  type: 'main' | 'genres' | 'stations';
  language: string;
  chunk?: number;
  urls: string[];
  urlCount: number;
  generatedAt: Date;
  updatedAt: Date;
}

// Task #336 — full submitted-URL list for an IndexNow submission. Stored
// separately from `IndexNowLog` so the log row stays small (it only keeps a
// 5-URL `sampleUrls` preview) and so we can put a TTL on the heavy payload
// independently of the lightweight log retention. Each row corresponds 1:1
// with one `IndexNowLog` row via `logId`.
export interface IIndexNowSubmissionUrls extends Document {
  logId: mongoose.Types.ObjectId;
  timestamp: Date;
  host: string;
  trigger: 'manual' | 'station-update' | 'sitemap-regen' | 'sync-complete' | 'sitemap-diff';
  urls: string[];
  urlCount: number;
  expiresAt: Date;
}

export interface IAdvertisement extends Document {
  title: string;
  imageUrl: string;
  altText: string;
  seoDescription: string;
  url: string;
  position: 'desktop_sidebar' | 'mobile_bottom';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFooterSocialMedia extends Document {
  platform: 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'whatsapp' | 'telegram' | 'reddit' | 'pinterest' | 'youtube' | 'tiktok';
  url: string;
  isActive: boolean;
  position: number; // Order in footer
  createdAt: Date;
  updatedAt: Date;
}

// SEO Metadata for per-page SEO management (Google 2025 compliant)
export interface ISeoMetadata extends Document {
  pageType: 'homepage' | 'genre_list' | 'genre_detail' | 'station_detail' | 'country_list' | 'country_detail' | 'region' | 'search' | 'static';
  routeKey: string; // Slug or page identifier (e.g., 'pop', 'iran-international', 'about')
  language: string; // ISO language code (e.g., 'en', 'tr', 'de')
  // Core SEO fields
  title: string; // 50-60 chars recommended
  description: string; // 120-160 chars recommended
  // Open Graph
  ogTitle?: string;
  ogDescription?: string;
  ogImageUrl?: string;
  // Twitter Cards
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImageUrl?: string;
  // Advanced
  canonicalUrl?: string;
  metaKeywords?: string;
  noIndex?: boolean; // For thin content pages
  noFollow?: boolean;
  // Management
  source: 'manual' | 'ai_generated' | 'template';
  status: 'draft' | 'published';
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICountryLanguageMapping extends Document {
  countryCode: string; // ISO 3166-1 alpha-2 country code (e.g., 'af', 'al', 'tr')
  countryName: string; // Country name (e.g., 'Afghanistan', 'Albania', 'Turkey')
  languageCode: string; // Language code (e.g., 'en', 'sq', 'tr')
  isActive: boolean; // If this mapping is active
  priority?: number; // Priority order (higher = more important)
  notes?: string; // Admin notes about this mapping
  createdAt: Date;
  updatedAt: Date;
}

export interface IUrlTranslation extends Document {
  languageCode: string; // Language code (e.g., 'en', 'de', 'fr')
  englishPath: string; // English path segment (e.g., 'stations', 'genres', 'about')
  translatedPath: string; // Translated path segment (e.g., 'stationen', 'genres', 'über')
  isActive: boolean; // If this translation is active
  notes?: string; // Admin notes about this translation
  createdAt: Date;
  updatedAt: Date;
}

// MongoDB Schemas
const StationSchema = new Schema<IStation>({
  changeUuid: String,
  stationuuid: { type: String, required: true, unique: true },
  serverUuid: String,
  name: { type: String, required: true },
  url: { type: String, required: true },
  urlResolved: String,
  homepage: String,
  favicon: String,
  tags: String,
  country: String,
  countryCode: String,
  iso31662: String,
  state: String,
  language: String,
  languageCodes: String,
  votes: { type: Number, default: 0 },
  // Rating system fields
  averageRating: { type: Number, default: 0, index: true },
  totalRatings: { type: Number, default: 0 },
  ratingBreakdown: {
    stars1: { type: Number, default: 0 },
    stars2: { type: Number, default: 0 },
    stars3: { type: Number, default: 0 },
    stars4: { type: Number, default: 0 },
    stars5: { type: Number, default: 0 }
  },
  lastChangeTime: Date,
  codec: String,
  bitrate: Number,
  hls: { type: Boolean, default: false },
  lastCheckOk: { type: Boolean, default: true },
  lastCheckTime: Date,
  lastCheckOkTime: Date,
  lastLocalCheckTime: Date,
  clickTimestamp: Date,
  clickCount: { type: Number, default: 0 },
  clickTrend: { type: Number, default: 0 },
  sslError: { type: Boolean, default: false },
  geoLat: Number,
  geoLong: Number,
  // GeoJSON Point for MongoDB geospatial queries - optimized for $geoNear aggregation
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude] - GeoJSON format
      index: '2dsphere' // Create geospatial index automatically
    }
  },
  hasExtendedInfo: { type: Boolean, default: false },
  localImagePath: String,
  // Optimized logo assets - multiple sizes in WebP format
  logoAssets: {
    folder: String, // Folder name: {slug}_{id8}
    webp48: String, // 48px logo filename
    webp96: String, // 96px logo filename
    webp256: String, // 256px logo filename
    original: String, // Original filename (backup)
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], index: true },
    processedAt: Date,
    error: String, // Error message if failed
    failureType: {
      type: String,
      enum: ['http_error', 'invalid_format', 'timeout', 'download_failed', 'processing_failed']
    },
    lastAttempt: Date
  },
  isManuallyEdited: { type: Boolean, default: false },
  manualEditFields: { type: Schema.Types.Mixed, default: {} },
  hasCustomFavicon: { type: Boolean, default: false },
  mergedUrls: [String], // URLs from merged stations
  mergedStationUuids: [String], // UUIDs of stations merged into this one
  slug: { type: String, index: true, sparse: true }, // SEO-friendly URL slug
  slugAliases: { type: [String], default: [], index: true }, // Old slugs that should 301 → current slug
  noIndex: { type: Boolean, default: false, index: true }, // Junk/thin station — exclude from sitemap & emit robots=noindex
  // Global playback cache fields - stores successful playback methods
  cachedPlaybackMethod: { type: String, enum: ['direct', 'proxy'] },
  cachedPlaybackUrl: String,
  playbackSuccessCount: { type: Number, default: 0 },
  lastPlaybackSuccess: Date,
  mediaGroupId: { type: Schema.Types.ObjectId, ref: 'MediaGroup' }, // Reference to MediaGroup for linked stations
  isFeatured: { type: Boolean, default: false, index: true }, // Manual featured/popular station flag - shows in station's own country
  showInGlobalPopular: { type: Boolean, default: false }, // Also show in global popular section (requires isFeatured=true)
  descriptions: { type: Schema.Types.Mixed, default: {} }, // Multi-language AI descriptions - { "en": "...", "tr": "...", etc }
  aiDescriptionSkipped: { type: Boolean, default: false, index: true }, // Station was checked for AI description but had no info from OpenAI - don't recheck to save tokens
  tagsCheckedAt: { type: Date }, // Last time we re-queried Radio-Browser for this station's tags (whether upstream returned tags or was empty) - used to skip re-querying empty-upstream stations for a cooldown window
  hasLogo: { type: Boolean, default: false }, // Pre-computed flag: true if station has a valid favicon/logo - used for fast sorting in precomputed cache
  // SEO FRESHNESS BUG FIX (2026-05-09): switched from manual `createdAt` /
  // `updatedAt` defaults (which only set on insert) to Mongoose's auto
  // `timestamps: true`. Root cause discovered during sitemap audit: 9938 of
  // 9988 stations carried <lastmod>2025-11-24 in /sitemap-stations-en-*.xml
  // even though the user reported routinely updating stations in 2026.
  // Reason: vote, rating, AI description, logo processing, slug auto-fill
  // and many other write call-sites use `Station.updateOne(...)` /
  // `findByIdAndUpdate(...)` / `bulkWrite(...)` and NEVER manually set
  // `updatedAt: new Date()`. With auto timestamps OFF, those operations
  // bypass the field entirely → updatedAt is frozen at the original insert
  // date forever. Mongoose's `timestamps: true` automatically injects
  // `$set: { updatedAt: <now> }` into every update, findOneAndUpdate,
  // updateMany, replaceOne, AND every bulkWrite updateOne/updateMany op
  // (since Mongoose v6+) — which is exactly what the sitemap freshness
  // signal requires.
  //
  // Fields above intentionally omit explicit createdAt/updatedAt — Mongoose
  // adds them via the schema option below.
}, { timestamps: true });

const CountrySchema = new Schema<ICountry>({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const LanguageSchema = new Schema<ILanguage>({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const MediaGroupSchema = new Schema<IMediaGroup>({
  name: { type: String, required: true },
  description: String,
  logoUrl: String,
  website: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Task #110: enforce safe URL/SEO slug charset (lowercase letters, digits,
// dash) at the schema layer so future writes can't reintroduce the
// XML-unsafe values cleaned up by the one-off migration script
// `scripts/cleanup-malformed-genre-slugs.ts`.
export const SAFE_GENRE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Single normalize helper used by *every* code path that writes
 * `Genre.slug` (Task #161). Lowercases, replaces any run of non
 * `[a-z0-9]` characters with a single dash, and trims edge dashes.
 *
 * Returns `''` if the input is empty or normalizes to nothing — callers
 * MUST treat that as "do not write a slug" (skip the doc / set
 * isDiscoverable=false). The output is guaranteed to either be `''` or
 * to satisfy `SAFE_GENRE_SLUG_RE`, so funneling all writes through this
 * helper means the weekly `cleanup-malformed-genre-slugs` cron has
 * nothing left to fix and idles at `normalized=0`.
 */
export function normalizeGenreSlug(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const GenreSchema = new Schema<IGenre>({
  name: { type: String, required: true },
  slug: {
    type: String,
    validate: {
      validator: (v: string | null | undefined) =>
        v == null || SAFE_GENRE_SLUG_RE.test(v),
      message: (props: { value: unknown }) =>
        `Genre.slug "${String(props.value)}" must match ${SAFE_GENRE_SLUG_RE}`,
    },
  },
  posterImage: String,
  discoverableImage: String,
  description: String,
  isDiscoverable: { type: Boolean, default: false },
  stationCount: { type: Number, default: 0 },
  // Forensic record written by `cleanup-malformed-genre-slugs.ts` when it
  // demotes a genre. Lets the admin UI surface "Recently demoted by slug
  // cleanup" so admins can decide whether to merge, rename, or delete.
  // Subdoc lives inline; absent on healthy genres so existing reads are
  // unaffected.
  cleanupDemotion: {
    reason: { type: String, enum: ['empty-slug', 'collision'] },
    originalSlug: String,
    normalizedSlug: String,
    collisionWinnerId: Schema.Types.Mixed,
    collisionWinnerSlug: String,
    collisionWinnerName: String,
    demotedAt: Date,
  },
  createdAt: { type: Date, default: Date.now }
}, { strict: false }); // Allow any _id type without strict validation

GenreSchema.index({ name: 1 });
GenreSchema.index({ isDiscoverable: 1 });
// Partial unique index on slug (Task #210). Prevents two genres from sharing
// the same slug, which would break `/api/genres/slug/:slug` lookups and SEO
// routing. Partial filter ensures genres without a slug (slug == null) don't
// collide with each other.
GenreSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: 'string' } } },
);
GenreSchema.index({ stationCount: -1 });
// Speeds up the admin "Recently demoted by slug cleanup" filter view.
GenreSchema.index({ 'cleanupDemotion.demotedAt': -1 }, { sparse: true });

const CodecSchema = new Schema<ICodec>({
  name: { type: String, required: true, unique: true },  
  stationCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const BulkDescriptionJobSchema = new Schema<IBulkDescriptionJob>({
  jobId: { type: String, required: true, unique: true, index: true },
  filterByCountry: String,
  status: { type: String, enum: ['running', 'paused', 'completed', 'failed'], default: 'running', index: true },
  totalStations: { type: Number, required: true },
  processedStations: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  skippedCount: { type: Number, default: 0 },
  lastProcessedStationId: String,
  lastProcessedSkip: { type: Number, default: 0 },
  errorMessage: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

BulkDescriptionJobSchema.index({ status: 1, createdAt: -1 });

const BackfillRunSchema = new Schema<IBackfillRun>({
  trigger: { type: String, required: true, index: true },
  status: { type: String, enum: ['running', 'completed', 'failed'], required: true, index: true },
  topN: { type: Number, default: 5 },
  overrideCountry: { type: String, uppercase: true, trim: true },
  startedAt: { type: Date, required: true },
  finishedAt: Date,
  durationMs: Number,
  logos: [{
    _id: false,
    countryCode: { type: String, required: true },
    candidates: { type: Number, default: 0 },
    enqueued: { type: Number, default: 0 },
    durationMs: Number,
    sampleStations: {
      type: [{
        _id: { type: String, required: true },
        slug: String,
        name: String,
      }],
      default: undefined,
    },
  }],
  tags: [{
    _id: false,
    countryCode: { type: String, required: true },
    processed: { type: Number, default: 0 },
    hydrated: { type: Number, default: 0 },
    emptyUpstream: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    durationMs: Number,
    sampleStations: {
      type: [{
        _id: { type: String, required: true },
        slug: String,
        name: String,
      }],
      default: undefined,
    },
  }],
  errorMessage: String,
  attempts: {
    type: [{
      _id: false,
      attempt: { type: Number, required: true },
      error: { type: String, default: '' },
      failedAt: { type: Date, required: true },
    }],
    default: [],
  },
});
BackfillRunSchema.index({ startedAt: -1 });

const CoverageSnapshotSchema = new Schema<ICoverageSnapshot>({
  countryCode: { type: String, required: true, uppercase: true, trim: true },
  snapshotDate: { type: Date, required: true },
  total: { type: Number, default: 0 },
  withLogo: { type: Number, default: 0 },
  withTags: { type: Number, default: 0 },
  logoCoveragePct: { type: Number, default: 0 },
  tagCoveragePct: { type: Number, default: 0 },
  // 'cron' = nightly snapshot from live data; 'backfill' = seeded from
  // historical station signals by the one-shot reconstruction script.
  // Optional + no default so legacy rows written before this field
  // existed remain `undefined` (interpreted as 'cron' downstream).
  source: { type: String, enum: ['cron', 'backfill'] },
  createdAt: { type: Date, default: Date.now },
});
// One snapshot per country per day (idempotent re-runs of the cron just
// upsert today's row).
CoverageSnapshotSchema.index({ countryCode: 1, snapshotDate: 1 }, { unique: true });
CoverageSnapshotSchema.index({ snapshotDate: -1 });

// Task #232: singleton-style status for the boot-time historical
// coverage backfill. See ICoverageBackfillStatus for field-level
// notes. The unique index on `key` enforces the singleton invariant
// even if two replicas race to write at the same time.
const CoverageBackfillStatusSchema = new Schema<ICoverageBackfillStatus>({
  key: { type: String, required: true, default: 'latest' },
  outcome: {
    type: String,
    enum: [
      'skipped-env',
      'skipped-already-seeded',
      'skipped-count-error',
      'running',
      'done',
      'done-no-stations',
      'failed',
    ],
    required: true,
  },
  message: { type: String, required: true },
  observedAt: { type: Date, required: true },
  startedAt: Date,
  finishedAt: Date,
  durationMs: Number,
  thresholdDays: Number,
  historicalDayCount: Number,
  seedDays: Number,
  daysSeeded: Number,
  inserted: Number,
  preserved: Number,
  error: String,
  updatedAt: { type: Date, default: Date.now },
});
CoverageBackfillStatusSchema.index({ key: 1 }, { unique: true });

// Task #316: bounded history collection for past boot evaluations.
// Mirrors the singleton schema (without the `key` field) and is
// pruned to a small cap by `services/coverage-backfill-on-boot.ts`.
const CoverageBackfillRunSchema = new Schema<ICoverageBackfillRun>({
  outcome: {
    type: String,
    enum: [
      'skipped-env',
      'skipped-already-seeded',
      'skipped-count-error',
      'running',
      'done',
      'done-no-stations',
      'failed',
    ],
    required: true,
  },
  message: { type: String, required: true },
  observedAt: { type: Date, required: true },
  startedAt: Date,
  finishedAt: Date,
  durationMs: Number,
  thresholdDays: Number,
  historicalDayCount: Number,
  seedDays: Number,
  daysSeeded: Number,
  inserted: Number,
  preserved: Number,
  error: String,
  createdAt: { type: Date, default: Date.now },
});
CoverageBackfillRunSchema.index({ observedAt: -1 });

const GenreSlugCleanupRunSchema = new Schema<IGenreSlugCleanupRun>({
  trigger: { type: String, required: true, index: true },
  status: { type: String, enum: ['running', 'completed', 'failed'], required: true, index: true },
  startedAt: { type: Date, required: true },
  finishedAt: Date,
  durationMs: Number,
  scanned: { type: Number, default: 0 },
  alreadyValid: { type: Number, default: 0 },
  normalized: { type: Number, default: 0 },
  markedUndiscoverable: { type: Number, default: 0 },
  emptySlugMarked: { type: Number, default: 0 },
  collisionMarked: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  rewarmed: { type: Boolean, default: false },
  errorMessage: String,
});
GenreSlugCleanupRunSchema.index({ startedAt: -1 });

// Task #330: audit log for nightly + ad-hoc Genre.stationCount recomputes.
const GenreStationCountsRunSchema = new Schema<IGenreStationCountsRun>({
  trigger: { type: String, required: true, index: true },
  status: { type: String, enum: ['running', 'completed', 'failed'], required: true, index: true },
  startedAt: { type: Date, required: true },
  finishedAt: Date,
  durationMs: Number,
  totalGenres: { type: Number, default: 0 },
  updatedSlugs: { type: Number, default: 0 },
  errorMessage: String,
});
GenreStationCountsRunSchema.index({ startedAt: -1 });

const SyncLogSchema = new Schema<ISyncLog>({
  syncType: { type: String, enum: ['full', 'incremental'], required: true },
  status: { type: String, enum: ['running', 'completed', 'failed'], required: true },
  stationsProcessed: { type: Number, default: 0 },
  stationsAdded: { type: Number, default: 0 },
  stationsUpdated: { type: Number, default: 0 },
  stationsSkipped: { type: Number, default: 0 },
  stationsAutoFlagged: { type: Number, default: 0 },
  errorMessage: String,
  startedAt: { type: Date, required: true },
  completedAt: Date
});

// Schema definitions for SEO user engagement
const StationEngagementSchema = new Schema<IStationEngagement>({
  stationId: { type: String, required: true, unique: true, index: true },
  totalFavorites: { type: Number, default: 0, index: true },
  recentFavorites: [{
    userId: String,
    favoritedAt: { type: Date, default: Date.now }
  }],
  ratings: [{
    userId: String,
    rating: { type: Number, min: 1, max: 5 },
    review: String,
    isPublic: { type: Boolean, default: true },
    helpfulVotes: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
  }],
  averageRating: { type: Number, default: 0, index: true },
  totalRatings: { type: Number, default: 0 },
  trendingScore: { type: Number, default: 0, index: true },
  weeklyFavorites: { type: Number, default: 0 },
  monthlyFavorites: { type: Number, default: 0 },
  peakListeningHours: [{
    hour: Number,
    listenerCount: Number
  }],
  popularInCountries: [{
    country: String,
    favoriteCount: Number,
    percentage: Number
  }],
  userTags: [{
    tag: String,
    count: Number,
    users: [String]
  }],
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const PublicUserProfileSchema = new Schema<IPublicUserProfile>({
  sessionId: { type: String, required: true, index: true },
  userId: String,
  displayName: String,
  bio: String,
  avatar: String,
  slug: { type: String, required: true, unique: true, index: true },
  isPublic: { type: Boolean, default: false, index: true },
  favoriteStations: [String],
  customCollections: [{
    name: String,
    slug: String,
    description: String,
    stationIds: [String],
    isPublic: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
  }],
  listeningStats: {
    totalListenHours: { type: Number, default: 0 },
    uniqueStationsListened: { type: Number, default: 0 },
    favoriteGenres: [{
      genre: String,
      count: Number,
      percentage: Number
    }],
    favoriteCountries: [{
      country: String,
      count: Number,
      percentage: Number
    }],
    peakListeningHours: [Number],
    joinedDate: { type: Date, default: Date.now },
    lastActiveDate: { type: Date, default: Date.now }
  },
  privacy: {
    showFavorites: { type: Boolean, default: true },
    showListeningHistory: { type: Boolean, default: false },
    showStatistics: { type: Boolean, default: true },
    allowPublicCollections: { type: Boolean, default: true }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});


const UserSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: false }, // Not required for OAuth users
  fullName: { type: String, required: true },
  bio: String,
  role: { type: String, enum: ['admin', 'moderator', 'user'], default: 'user' },
  status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
  lastLoginAt: Date,
  location: String,
  avatar: String,
  isPublicProfile: { type: Boolean, default: false },
  isSeedProfile: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  emailVerificationToken: String,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  
  // Social authentication IDs
  googleId: { type: String, unique: true, sparse: true },
  facebookId: { type: String, unique: true, sparse: true },
  appleId: { type: String, unique: true, sparse: true },
  pushSubscription: Schema.Types.Mixed,
  slug: String,
  favoriteStations: [{ type: String }],
  recentlyPlayedStations: [{
    stationId: { type: String, required: true },
    playedAt: { type: Date, default: Date.now },
    playDuration: Number
  }],
  preferences: {
    theme: { type: String, enum: ['dark', 'light'], default: 'dark' },
    language: { type: String, default: 'en' },
    autoplay: { type: Boolean, default: false },
    volume: { type: Number, default: 80, min: 0, max: 100 },
    notificationsEnabled: { type: Boolean, default: true },
    playAtLogin: { type: String, enum: ['LAST_PLAYED', 'RANDOM', 'FAVORITE'], default: 'LAST_PLAYED' }
  },
  permissions: {
    canManageStations: { type: Boolean, default: false },
    canManageUsers: { type: Boolean, default: false },
    canRunSync: { type: Boolean, default: false },
    canViewAnalytics: { type: Boolean, default: false },
    canExportData: { type: Boolean, default: false }
  },
  // Enhanced social features
  following: [{ type: String }], // User IDs this user follows
  followers: [{ type: String }], // User IDs that follow this user
  followersCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },
  favoriteStationsCount: { type: Number, default: 0 },
  totalListeningTime: { type: Number, default: 0 }, // Total minutes listened
  stationsCreated: [{ type: String }], // Stations submitted by this user
  stationsCreatedCount: { type: Number, default: 0 },
  // User activity stats
  stats: {
    totalPlays: { type: Number, default: 0 },
    totalListeningHours: { type: Number, default: 0 },
    favoriteGenres: [{ type: String }],
    mostPlayedStation: String,
    joinDate: { type: Date, default: Date.now },
    lastActiveDate: { type: Date, default: Date.now },
    streakDays: { type: Number, default: 0 }
  },
  subscription: {
    plan: { type: String, enum: ['none', 'remove_ads', 'premium_monthly', 'premium_yearly', 'premium_lifetime'], default: 'none' },
    platform: { type: String, enum: ['ios', 'android', 'tvos', 'macos', 'web', 'admin'] },
    productId: String,
    transactionId: String,
    originalTransactionId: String,
    receipt: String,
    purchaseToken: String,
    expiresAt: { type: Date, default: null },
    startedAt: Date,
    isTrial: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },
    cancelledAt: Date,
    lastVerifiedAt: Date,
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// New schemas for mega radio API features
const StationRatingSchema = new Schema<IStationRating>({
  stationId: { type: String, required: true, index: true },
  userId: { type: String, index: true },
  sessionId: { type: String, index: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: String,
  ipAddress: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Create compound indexes for rating system
StationRatingSchema.index({ stationId: 1, userId: 1 }, { unique: true, sparse: true });
StationRatingSchema.index({ stationId: 1, sessionId: 1 }, { unique: true, sparse: true });
StationRatingSchema.index({ stationId: 1, ipAddress: 1 }, { sparse: true });

const UserFavoriteSchema = new Schema<IUserFavorite>({
  userId: { type: String, required: true },
  stationId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

UserFavoriteSchema.index({ userId: 1, stationId: 1 }, { unique: true });
UserFavoriteSchema.index({ userId: 1, createdAt: -1 });

const AnalyticsEventSchema = new Schema<IAnalyticsEvent>({
  stationId: { type: String, required: true },
  userId: String,
  event: { 
    type: String, 
    required: true, 
    enum: ['play', 'stop', 'favorite', 'search', 'rating', 'click'] 
  },
  metadata: { type: Schema.Types.Mixed, default: {} },
  ip: String,
  userAgent: String,
  timestamp: { type: Date, default: Date.now }
});

const FeedbackSchema = new Schema<IFeedback>({
  type: { type: String, required: true, enum: ['bug', 'feature', 'general'] },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  email: String,
  userId: String,
  status: { type: String, enum: ['open', 'in-progress', 'resolved', 'closed'], default: 'open' },
  response: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
});

// New missing features schemas
const StationCommentSchema = new Schema<IStationComment>({
  stationId: { type: String, required: true },
  userId: { type: String, required: true },
  username: { type: String, required: true },
  content: { type: String, required: true, minlength: 10, maxlength: 500 },
  rating: { type: Number, min: 1, max: 5 },
  likes: { type: Number, default: 0 },
  dislikes: { type: Number, default: 0 },
  likedBy: [{ type: String }],
  dislikedBy: [{ type: String }],
  isModerated: { type: Boolean, default: false },
  parentCommentId: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const UserSessionSchema = new Schema<IUserSession>({
  userId: { type: String, required: true, unique: true },
  sessionData: {
    currentStation: String,
    volume: { type: Number, default: 80, min: 0, max: 100 },
    isPlaying: { type: Boolean, default: false },
    lastActivity: { type: Date, default: Date.now },
    preferences: { type: Schema.Types.Mixed, default: {} }
  },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // 7 days
  createdAt: { type: Date, default: Date.now }
});

// Visitor Tracking Schema - for anonymous user tracking by UNIQUE IP
interface IVisitorSession extends Document {
  ipAddress: string;
  lastActiveDate: Date;
  createdAt: Date;
  userAgent?: string;
  visitCount: number;
}

const VisitorSessionSchema = new Schema<IVisitorSession>({
  ipAddress: { type: String, required: true, unique: true, index: true },
  lastActiveDate: { type: Date, default: Date.now, index: true },
  createdAt: { type: Date, default: Date.now },
  userAgent: String,
  visitCount: { type: Number, default: 1 }
}, { collection: 'visitor_sessions' });

// Add TTL index to auto-delete old visitor sessions after 30 days
VisitorSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const NotificationSchema = new Schema<INotification>({
  userId: { type: String, required: true },
  type: { 
    type: String, 
    required: true, 
    enum: ['new_station', 'favorite_update', 'comment_reply', 'system', 'promotional'] 
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: { type: Schema.Types.Mixed, default: {} },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const AdvancedSearchSchema = new Schema<IAdvancedSearch>({
  userId: String,
  query: { type: String, required: true },
  filters: {
    country: String,
    language: String,
    genre: String,
    codec: String,
    bitrateMin: Number,
    bitrateMax: Number,
    hasSSL: Boolean,
    isWorking: Boolean
  },
  results: { type: Number, default: 0 },
  searchedAt: { type: Date, default: Date.now }
});

// BlacklistedStation Schema - prevents re-syncing deleted stations
const BlacklistedStationSchema = new Schema<IBlacklistedStation>({
  stationUuid: String,
  url: { type: String, required: true, index: true },
  name: { type: String, required: true },
  reason: String,
  deletedBy: String,
  deletedAt: { type: Date, default: Date.now },
  radioBrowserId: String,
  createdAt: { type: Date, default: Date.now },
});

// Note: IStationDebugLog interface is defined above at line 205 extending Document

// Station Debug Log Schema
const StationDebugLogSchema = new Schema<IStationDebugLog>({
  stationId: { type: String, required: true },
  stationName: { type: String, required: true },
  stationUrl: { type: String, required: true },
  errorType: { 
    type: String, 
    required: true,
    enum: ['AUDIO_ERROR', 'CONNECTION_TIMEOUT', 'STREAM_UNAVAILABLE', 'CODEC_UNSUPPORTED', 'CORS_ERROR', 'NETWORK_ERROR']
  },
  errorMessage: { type: String, required: true },
  errorDetails: {
    errorCode: Number,
    errorMessage: String,
    errorName: String,
    networkState: Number,
    readyState: Number,
    statusCode: Number,
    headers: { type: Map, of: String },
    stackTrace: String,
    attemptCount: Number,
    lastAttemptUrl: String,
    occurrenceCount: { type: Number, default: 1 },
    audioProperties: {
      currentTime: Number,
      duration: Number,
      buffered: Number,
      volume: Number,
      muted: Boolean,
      paused: Boolean,
      ended: Boolean,
      seeking: Boolean,
      crossOrigin: String,
      preload: String
    },
    browserInfo: {
      userAgent: String,
      platform: String,
      language: String,
      cookieEnabled: Boolean,
      onLine: Boolean
    },
    connectionInfo: {
      effectiveType: String,
      downlink: Number,
      rtt: Number
    },
    streamAnalysis: {
      isHLS: Boolean,
      isPlaylist: Boolean,
      isLautFm: Boolean,
      isSimpleMp3: Boolean,
      detectedFormat: String,
      contentType: String,
      contentLength: Number
    }
  },
  stationMeta: {
    country: String,
    language: String,
    codec: String,
    bitrate: Number,
    isHLS: Boolean,
    isPlaylist: Boolean,
    favicon: String,
    votes: Number,
    clickCount: Number
  },
  userAgent: String,
  clientIP: String,
  timestamp: { type: Date, default: Date.now },
  isResolved: { type: Boolean, default: false },
  resolvedAt: Date,
  resolvedBy: String,
  notes: String,
  // User tracking for multiple reports
  reportingUsers: [{
    userAgent: String,
    clientIP: String,
    timestamp: { type: Date, default: Date.now }
  }],
  uniqueUserCount: { type: Number, default: 1 },
  totalOccurrences: { type: Number, default: 1 },
  // Server logs captured during the error
  serverLogs: [String]
});

// Create indexes for better performance
StationSchema.index({ name: 1 });
StationSchema.index({ countryCode: 1 });
StationSchema.index({ language: 1 });
StationSchema.index({ tags: 1 });
StationSchema.index({ votes: -1 });
StationSchema.index({ clickCount: -1 });
StationSchema.index({ updatedAt: -1 });
StationSchema.index({ codec: 1 }); // Used in dashboard stats distinct/aggregate queries
// Compound indexes for Similar Radios performance
StationSchema.index({ country: 1, lastCheckOk: 1, votes: -1 }); // Country lookup with votes sort
StationSchema.index({ lastCheckOk: 1, votes: -1 }); // Global popular lookup
StationSchema.index({ lastCheckOk: 1, hasLogo: -1, votes: -1 }); // Precomputed stations fast sort

// Debug log indexes
StationDebugLogSchema.index({ stationId: 1 });
StationDebugLogSchema.index({ errorType: 1 });
StationDebugLogSchema.index({ timestamp: -1 });
StationDebugLogSchema.index({ isResolved: 1 });

// Laravel Backend Features - Interfaces
interface IStationRequest {
  stationName: string;
  stationUrl: string;
  website?: string;
  country?: string;
  genre?: string;
  description?: string;
  submittedBy?: string;
  submittedByEmail?: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNotes?: string;
  createdAt: Date;
  processedAt?: Date;
}

interface IStationSubmission {
  name: string;
  stream_url: string;
  website?: string;
  logo?: string;
  country?: string;
  state?: string;
  genre?: string;
  description?: string;
  submittedBy?: string;
  email?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  createdAt: Date;
  processedAt?: Date;
}

interface IAds {
  name: string;
  url: string;
  image?: string;
  position: 'header' | 'sidebar' | 'footer' | 'content';
  is_discoverable: boolean;
  isActive: boolean;
  clickCount: number;
  impressions: number;
  createdAt: Date;
  updatedAt: Date;
}

interface IPageLaravel {
  name: string;
  slug: string;
  title: Map<string, string>;
  description: Map<string, string>;
  keywords: Map<string, string>;
  contents: Map<string, string>;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface IEnhancedLanguage {
  name: string;
  key: string;
  iso?: string;
  phrases: Map<string, string>;
  site_meta: Map<string, any>;
  is_published: boolean;
  is_rtl: boolean;
  totalStations: number;
  createdAt: Date;
  updatedAt: Date;
}

// Export models
// Laravel Backend Features - Station Requests & Submissions
const StationRequestSchema = new Schema<IStationRequest>({
  stationName: { type: String, required: true },
  stationUrl: { type: String, required: true },
  website: String,
  country: String,
  genre: String,
  description: String,
  submittedBy: String,
  submittedByEmail: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNotes: String,
  createdAt: { type: Date, default: Date.now },
  processedAt: Date
});

const StationSubmissionSchema = new Schema<IStationSubmission>({
  name: { type: String, required: true },
  stream_url: { type: String, required: true },
  website: String,
  logo: String,
  country: String,
  state: String,
  genre: String,
  description: String,
  submittedBy: String,
  email: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  rejectionReason: String,
  createdAt: { type: Date, default: Date.now },
  processedAt: Date
});

// Ads Management System
const AdsSchema = new Schema<IAds>({
  name: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  image: String,
  position: { type: String, required: true, enum: ['header', 'sidebar', 'footer', 'content'] },
  is_discoverable: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  clickCount: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Simple Page schema for privacy policy, terms, etc.
const PageSchema = new Schema<IPage>({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  contents: { type: String, required: true },
  isPublished: { type: Boolean, default: true },
  language: { type: String, default: 'en' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Laravel CMS Page schema (more complex)
const LaravelPageSchema = new Schema<IPageLaravel>({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  title: { type: Map, of: String },
  description: { type: Map, of: String },
  keywords: { type: Map, of: String },
  contents: { type: Map, of: String },
  isPublished: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Enhanced Language with Phrases
const EnhancedLanguageSchema = new Schema<IEnhancedLanguage>({
  name: { type: String, required: true },
  key: { type: String, required: true, unique: true },
  iso: String,
  phrases: { type: Map, of: String },
  site_meta: { type: Map, of: Schema.Types.Mixed },
  is_published: { type: Boolean, default: false },
  is_rtl: { type: Boolean, default: false },
  totalStations: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// ML Recommendation Schemas
const UserListeningHistorySchema = new Schema<IUserListeningHistory>({
  userId: String,
  sessionId: { type: String, required: true, index: true },
  stationId: { type: String, required: true, index: true },
  stationName: { type: String, required: true },
  country: { type: String, required: true },
  genre: String,
  tags: String,
  listenDuration: { type: Number, required: true, min: 0 },
  interactionType: { 
    type: String, 
    required: true, 
    enum: ['play', 'skip', 'favorite', 'share', 'seek', 'volume_change'] 
  },
  listenedAt: { type: Date, required: true, index: true },
  timeOfDay: { type: Number, min: 0, max: 23 },
  dayOfWeek: { type: Number, min: 0, max: 6 },
  deviceType: { type: String, enum: ['mobile', 'desktop', 'tablet'] },
  location: {
    country: String,
    region: String
  },
  skipReason: { type: String, enum: ['bad_quality', 'wrong_genre', 'language', 'ads', 'other'] },
  rating: { type: Number, min: 1, max: 5 },
  createdAt: { type: Date, default: Date.now }
});

const StationSimilaritySchema = new Schema<IStationSimilarity>({
  stationId1: { type: String, required: true, index: true },
  stationId2: { type: String, required: true, index: true },
  similarityScore: { type: Number, required: true, min: 0, max: 1 },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  calculationType: { 
    type: String, 
    required: true, 
    enum: ['content_based', 'collaborative', 'hybrid'] 
  },
  features: {
    genreSimilarity: { type: Number, min: 0, max: 1 },
    countryMatch: Boolean,
    languageMatch: Boolean,
    userOverlap: { type: Number, min: 0 },
    tagSimilarity: { type: Number, min: 0, max: 1 }
  },
  lastCalculated: { type: Date, required: true, index: true },
  sampleSize: { type: Number, required: true, min: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const UserProfileSchema = new Schema<IUserProfile>({
  sessionId: { type: String, required: true, unique: true, index: true },
  userId: String,
  preferredGenres: [{
    genre: { type: String, required: true },
    weight: { type: Number, required: true, min: 0, max: 1 },
    confidence: { type: Number, required: true, min: 0, max: 1 }
  }],
  preferredCountries: [{
    country: { type: String, required: true },
    weight: { type: Number, required: true, min: 0, max: 1 },
    confidence: { type: Number, required: true, min: 0, max: 1 }
  }],
  preferredLanguages: [{
    language: { type: String, required: true },
    weight: { type: Number, required: true, min: 0, max: 1 },
    confidence: { type: Number, required: true, min: 0, max: 1 }
  }],
  averageListenDuration: { type: Number, default: 0 },
  peakListeningHours: [{ type: Number, min: 0, max: 23 }],
  skipRate: { type: Number, default: 0, min: 0, max: 1 },
  totalStationsListened: { type: Number, default: 0 },
  uniqueStationsCount: { type: Number, default: 0 },
  favoriteStationsCount: { type: Number, default: 0 },
  lastListenedAt: Date,
  profileStrength: { type: Number, default: 0, min: 0, max: 1 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound indexes for efficient queries
UserListeningHistorySchema.index({ sessionId: 1, listenedAt: -1 });
UserListeningHistorySchema.index({ stationId: 1, listenedAt: -1 });
StationSimilaritySchema.index({ stationId1: 1, stationId2: 1 }, { unique: true });
StationSimilaritySchema.index({ similarityScore: -1, confidence: -1 });

export const Station = mongoose.model<IStation>('Station', StationSchema);
export const Country = mongoose.model<ICountry>('Country', CountrySchema);
export const Language = mongoose.model<ILanguage>('Language', LanguageSchema);
export const Genre = mongoose.model<IGenre>('Genre', GenreSchema);
export const Codec = mongoose.model<ICodec>('Codec', CodecSchema);
export const SyncLog = mongoose.model<ISyncLog>('SyncLog', SyncLogSchema);
export const BackfillRun = mongoose.model<IBackfillRun>('BackfillRun', BackfillRunSchema);
export const CoverageSnapshot = mongoose.model<ICoverageSnapshot>('CoverageSnapshot', CoverageSnapshotSchema);
export const CoverageBackfillStatus = mongoose.model<ICoverageBackfillStatus>(
  'CoverageBackfillStatus',
  CoverageBackfillStatusSchema,
);
export const CoverageBackfillRun = mongoose.model<ICoverageBackfillRun>(
  'CoverageBackfillRun',
  CoverageBackfillRunSchema,
);
export const GenreSlugCleanupRun = mongoose.model<IGenreSlugCleanupRun>(
  'GenreSlugCleanupRun',
  GenreSlugCleanupRunSchema,
);
export const GenreStationCountsRun = mongoose.model<IGenreStationCountsRun>(
  'GenreStationCountsRun',
  GenreStationCountsRunSchema,
);
UserSchema.index({ slug: 1 }, { sparse: true }); // Used in profile lookups
UserSchema.index({ isPublicProfile: 1 }); // Used in community listings

export const User = mongoose.model<IUser>('User', UserSchema);
export const StationRating = mongoose.model<IStationRating>('StationRating', StationRatingSchema);
export const UserFavorite = mongoose.model<IUserFavorite>('UserFavorite', UserFavoriteSchema);

// New models for SEO user engagement
export const StationEngagement = mongoose.model<IStationEngagement>('StationEngagement', StationEngagementSchema);
export const PublicUserProfile = mongoose.model<IPublicUserProfile>('PublicUserProfile', PublicUserProfileSchema);
export const AnalyticsEvent = mongoose.model<IAnalyticsEvent>('AnalyticsEvent', AnalyticsEventSchema);
export const Feedback = mongoose.model<IFeedback>('Feedback', FeedbackSchema);
export const StationRequest = mongoose.model<IStationRequest>('StationRequest', StationRequestSchema);
export const StationSubmission = mongoose.model<IStationSubmission>('StationSubmission', StationSubmissionSchema);
export const Ads = mongoose.model<IAds>('Ads', AdsSchema);
export const Page = mongoose.model<IPage>('Page', PageSchema);
export const LaravelPage = mongoose.model<IPageLaravel>('LaravelPage', LaravelPageSchema);
export const EnhancedLanguage = mongoose.model<IEnhancedLanguage>('EnhancedLanguage', EnhancedLanguageSchema);

// ML Recommendation Models
export const UserListeningHistory = mongoose.model<IUserListeningHistory>('UserListeningHistory', UserListeningHistorySchema);
export const StationSimilarity = mongoose.model<IStationSimilarity>('StationSimilarity', StationSimilaritySchema);
export const UserProfile = mongoose.model<IUserProfile>('UserProfile', UserProfileSchema);

// New missing features models
// StationPlaybackCache Schema for global caching
const StationPlaybackCacheSchema = new Schema<IStationPlaybackCache>({
  stationId: { type: String, required: true, unique: true, index: true },
  method: { type: String, enum: ['direct', 'proxy'], required: true },
  workingUrl: { type: String, required: true },
  successCount: { type: Number, default: 1 },
  lastSuccessTime: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

export const StationComment = mongoose.model<IStationComment>('StationComment', StationCommentSchema);
export const UserSession = mongoose.model<IUserSession>('UserSession', UserSessionSchema);
export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
export const AdvancedSearch = mongoose.model<IAdvancedSearch>('AdvancedSearch', AdvancedSearchSchema);
export const StationPlaybackCache = mongoose.model<IStationPlaybackCache>('StationPlaybackCache', StationPlaybackCacheSchema);
export const BlacklistedStation = mongoose.model<IBlacklistedStation>('BlacklistedStation', BlacklistedStationSchema);

// Station Error Log Interface
export interface IStationErrorLog {
  _id?: string;
  stationId: string;
  stationName: string;
  stationUrl: string;
  errorType: 'STREAM_FAILED' | 'AUDIO_ERROR' | 'CONNECTION_TIMEOUT' | 'INVALID_FORMAT' | 'NOT_FOUND' | 'USER_REPORT';
  errorMessage: string;
  errorDetails?: {
    httpStatus?: number;
    streamUrl?: string;
    userAgent?: string;
    ipAddress?: string;
    errorCode?: string;
    stackTrace?: string;
  };
  userSessionId?: string;
  userCountry?: string;
  timestamp: Date;
  isResolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  retryCount: number;
  lastRetryAt?: Date;
}

// Station Error Log Schema
const StationErrorLogSchema = new Schema<IStationErrorLog>({
  stationId: { type: String, required: true, index: true },
  stationName: { type: String, required: true },
  stationUrl: { type: String, required: true },
  errorType: { 
    type: String, 
    required: true,
    enum: ['STREAM_FAILED', 'AUDIO_ERROR', 'CONNECTION_TIMEOUT', 'INVALID_FORMAT', 'NOT_FOUND', 'USER_REPORT']
  },
  errorMessage: { type: String, required: true },
  errorDetails: {
    httpStatus: Number,
    streamUrl: String,
    userAgent: String,
    ipAddress: String,
    errorCode: String,
    stackTrace: String
  },
  userSessionId: String,
  userCountry: String,
  timestamp: { type: Date, default: Date.now, index: true },
  isResolved: { type: Boolean, default: false },
  resolvedAt: Date,
  resolvedBy: String,
  retryCount: { type: Number, default: 0 },
  lastRetryAt: Date
});

// Index for efficient querying
StationErrorLogSchema.index({ stationId: 1, timestamp: -1 });
StationErrorLogSchema.index({ errorType: 1, isResolved: 1 });
StationErrorLogSchema.index({ timestamp: -1 });

export const StationErrorLog = mongoose.model<IStationErrorLog>('StationErrorLog', StationErrorLogSchema);

// ====================================
// PERSONALIZED RECOMMENDATION ENGINE
// ====================================

// User Music Profile Interface
export interface IUserMusicProfile {
  _id?: string;
  userId: string;
  genres: Array<{
    name: string;
    preference: number; // 0-100 score
    playTime: number; // total minutes listened
    lastPlayed: Date;
  }>;
  countries: Array<{
    name: string;
    preference: number;
    playTime: number;
    lastPlayed: Date;
  }>;
  languages: Array<{
    name: string;
    preference: number;
    playTime: number;
    lastPlayed: Date;
  }>;
  listeningHabits: {
    preferredTimes: Array<{
      hour: number; // 0-23
      frequency: number; // how often they listen at this hour
    }>;
    averageSessionLength: number; // minutes
    totalListeningTime: number; // total minutes
    favoriteStations: string[]; // station IDs
    skipRate: number; // percentage of stations skipped quickly
  };
  mood: {
    currentMood?: 'energetic' | 'relaxed' | 'focused' | 'nostalgic' | 'adventurous';
    moodHistory: Array<{
      mood: string;
      timestamp: Date;
      stationsPlayed: string[];
    }>;
  };
  discovery: {
    explorationLevel: number; // 0-100, how much they like discovering new music
    lastRecommendations: Array<{
      stationId: string;
      reason: string;
      recommended: Date;
      played: boolean;
      liked: boolean;
    }>;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Listening Session Interface
export interface IListeningSession {
  _id?: string;
  userId?: string;
  sessionId: string;
  stationId: string;
  stationName: string;
  genre: string;
  country: string;
  language: string;
  startTime: Date;
  endTime?: Date;
  duration: number; // seconds
  skipReason?: 'disliked' | 'looking_for_something_else' | 'poor_quality' | 'not_working';
  liked: boolean;
  mood?: string;
  context?: 'work' | 'exercise' | 'relax' | 'commute' | 'study' | 'party';
  deviceType?: 'mobile' | 'desktop' | 'tablet';
  location?: {
    country: string;
    city?: string;
  };
}

// Recommendation Interface
export interface IRecommendation {
  _id?: string;
  userId?: string;
  stationId: string;
  stationName: string;
  recommendationType: 'genre_based' | 'country_based' | 'language_based' | 'mood_based' | 'collaborative' | 'trending' | 'discovery';
  confidence: number; // 0-100 recommendation confidence
  reason: string;
  metadata: {
    genres: string[];
    country: string;
    language: string;
    mood?: string;
    similarUsers?: string[];
    trendingScore?: number;
  };
  generated: Date;
  presented?: Date;
  clicked?: Date;
  liked?: Date;
  dismissed?: Date;
  feedback?: 'love' | 'like' | 'dislike' | 'not_interested';
}

// User Music Profile Schema
const UserMusicProfileSchema = new Schema<IUserMusicProfile>({
  userId: { type: String, required: true, unique: true },
  genres: [{
    name: { type: String, required: true },
    preference: { type: Number, min: 0, max: 100, default: 50 },
    playTime: { type: Number, default: 0 },
    lastPlayed: { type: Date, default: Date.now }
  }],
  countries: [{
    name: { type: String, required: true },
    preference: { type: Number, min: 0, max: 100, default: 50 },
    playTime: { type: Number, default: 0 },
    lastPlayed: { type: Date, default: Date.now }
  }],
  languages: [{
    name: { type: String, required: true },
    preference: { type: Number, min: 0, max: 100, default: 50 },
    playTime: { type: Number, default: 0 },
    lastPlayed: { type: Date, default: Date.now }
  }],
  listeningHabits: {
    preferredTimes: [{
      hour: { type: Number, min: 0, max: 23 },
      frequency: { type: Number, default: 0 }
    }],
    averageSessionLength: { type: Number, default: 0 },
    totalListeningTime: { type: Number, default: 0 },
    favoriteStations: [{ type: String }],
    skipRate: { type: Number, min: 0, max: 100, default: 0 }
  },
  mood: {
    currentMood: { 
      type: String, 
      enum: ['energetic', 'relaxed', 'focused', 'nostalgic', 'adventurous'] 
    },
    moodHistory: [{
      mood: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      stationsPlayed: [{ type: String }]
    }]
  },
  discovery: {
    explorationLevel: { type: Number, min: 0, max: 100, default: 50 },
    lastRecommendations: [{
      stationId: { type: String, required: true },
      reason: { type: String, required: true },
      recommended: { type: Date, default: Date.now },
      played: { type: Boolean, default: false },
      liked: { type: Boolean, default: false }
    }]
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Listening Session Schema
const ListeningSessionSchema = new Schema<IListeningSession>({
  userId: String,
  sessionId: { type: String, required: true },
  stationId: { type: String, required: true },
  stationName: { type: String, required: true },
  genre: { type: String, required: true },
  country: { type: String, required: true },
  language: { type: String, required: true },
  startTime: { type: Date, default: Date.now },
  endTime: Date,
  duration: { type: Number, default: 0 },
  skipReason: { 
    type: String, 
    enum: ['disliked', 'looking_for_something_else', 'poor_quality', 'not_working'] 
  },
  liked: { type: Boolean, default: false },
  mood: String,
  context: { 
    type: String, 
    enum: ['work', 'exercise', 'relax', 'commute', 'study', 'party'] 
  },
  deviceType: { 
    type: String, 
    enum: ['mobile', 'desktop', 'tablet'] 
  },
  location: {
    country: String,
    city: String
  }
});

// Recommendation Schema
const RecommendationSchema = new Schema<IRecommendation>({
  userId: String,
  stationId: { type: String, required: true },
  stationName: { type: String, required: true },
  recommendationType: { 
    type: String, 
    required: true,
    enum: ['genre_based', 'country_based', 'language_based', 'mood_based', 'collaborative', 'trending', 'discovery']
  },
  confidence: { type: Number, min: 0, max: 100, required: true },
  reason: { type: String, required: true },
  metadata: {
    genres: [{ type: String }],
    country: String,
    language: String,
    mood: String,
    similarUsers: [{ type: String }],
    trendingScore: Number
  },
  generated: { type: Date, default: Date.now },
  presented: Date,
  clicked: Date,
  liked: Date,
  dismissed: Date,
  feedback: { 
    type: String, 
    enum: ['love', 'like', 'dislike', 'not_interested'] 
  }
});

// Indexes for performance (userId already has unique index from schema definition)
ListeningSessionSchema.index({ userId: 1, startTime: -1 });
ListeningSessionSchema.index({ stationId: 1 });
RecommendationSchema.index({ userId: 1, generated: -1 });

// User Follow Schema - for users following other users
const UserFollowSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // The user who is following
  followingUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // The user being followed
  createdAt: { type: Date, default: Date.now }
});

// Create compound index to prevent duplicate follows and optimize queries
UserFollowSchema.index({ userId: 1, followingUserId: 1 }, { unique: true });
UserFollowSchema.index({ followingUserId: 1 }); // For getting followers
UserFollowSchema.index({ userId: 1 }); // For getting following

// User Notification Schema for social features
const UserNotificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // Recipient
  fromUserId: { type: Schema.Types.ObjectId, ref: 'User' }, // User who triggered the notification
  type: { 
    type: String, 
    enum: ['follow', 'unfollow', 'favorite_station', 'new_station', 'system', 'new_message'],
    required: true 
  },
  title: { type: String, required: false },
  message: { type: String, required: true },
  data: { type: Schema.Types.Mixed }, // Additional data for the notification
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

UserNotificationSchema.index({ userId: 1, createdAt: -1 }); // For getting user notifications
UserNotificationSchema.index({ userId: 1, read: 1 }); // For filtering read/unread

// Translation schemas
const TranslationKeySchema = new Schema<ITranslationKey>({
  key: { type: String, required: true, unique: true },
  defaultValue: { type: String, required: true },
  description: String,
  context: String,
  category: { type: String, required: true, default: 'general' },
  isPlural: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const TranslationSchema = new Schema<ITranslation>({
  keyId: { type: Schema.Types.ObjectId, ref: 'TranslationKey', required: true },
  language: { type: String, required: true },
  value: { type: String, required: true },
  isCompleted: { type: Boolean, default: false },
  lastModified: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const TranslationLanguageSchema = new Schema<ITranslationLanguage>({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  isEnabled: { type: Boolean, default: true },
  isDefault: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const TranslationMetadataSchema = new Schema<ITranslationMetadata>({
  scope: { type: String, required: true, unique: true, default: 'global' },
  languagesVersion: { type: Number, required: true, default: 1 },
  lastBumpedAt: { type: Date, default: Date.now },
  notes: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const CountryLanguageMappingSchema = new Schema<ICountryLanguageMapping>({
  countryCode: { type: String, required: true },
  countryName: { type: String, required: true },
  languageCode: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  priority: { type: Number, default: 0 },
  notes: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const UrlTranslationSchema = new Schema<IUrlTranslation>({
  languageCode: { type: String, required: true },
  englishPath: { type: String, required: true },
  translatedPath: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  notes: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const GscUrlInspectionSchema = new Schema<IGscUrlInspection>({
  url: { type: String, required: true, unique: true },
  language: { type: String, required: true, index: true },
  group: { type: String, enum: ['static', 'country', 'station', 'genre'], required: true, index: true },
  state: {
    type: String,
    enum: ['indexed', 'crawled-not-indexed', 'discovered-not-indexed', 'excluded', 'error', 'unknown', 'pending'],
    required: true,
    default: 'pending',
    index: true,
  },
  coverageState: String,
  verdict: String,
  robotsTxtState: String,
  indexingState: String,
  pageFetchState: String,
  lastCrawlTime: Date,
  googleCanonical: String,
  userCanonical: String,
  inspectionResultLink: String,
  lastInspectedAt: Date,
  lastError: String,
  errorCount: { type: Number, default: 0 },
  discoveredAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  notIndexedSince: Date,
  lastResubmitAt: Date,
  lastResubmitStatus: { type: String, enum: ['success', 'failed'] },
  lastResubmitError: String,
  resubmitCount: { type: Number, default: 0 },
});
GscUrlInspectionSchema.index({ language: 1, group: 1, state: 1 });
// Cheapest-first rotation key: oldest lastInspectedAt first, then newest discovered.
GscUrlInspectionSchema.index({ lastInspectedAt: 1, discoveredAt: -1 });
// Task #266 — fast lookup of stuck rows by (state, notIndexedSince).
GscUrlInspectionSchema.index({ state: 1, notIndexedSince: 1 });

const GscIndexingSnapshotSchema = new Schema<IGscIndexingSnapshot>({
  date: { type: Date, required: true },
  language: { type: String, required: true },
  group: {
    type: String,
    enum: ['static', 'country', 'station', 'genre', 'all'],
    required: true,
  },
  total: { type: Number, required: true, default: 0 },
  indexed: { type: Number, required: true, default: 0 },
  crawledNotIndexed: { type: Number, required: true, default: 0 },
  discoveredNotIndexed: { type: Number, required: true, default: 0 },
  excluded: { type: Number, required: true, default: 0 },
  error: { type: Number, required: true, default: 0 },
  pending: { type: Number, required: true, default: 0 },
  unknown: { type: Number, required: true, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
// Idempotent daily snapshot: one row per (date, language, group).
GscIndexingSnapshotSchema.index(
  { date: 1, language: 1, group: 1 },
  { unique: true },
);
GscIndexingSnapshotSchema.index({ date: -1 });

const IndexNowLogSchema = new Schema<IIndexNowLog>({
  timestamp: { type: Date, default: Date.now, required: true },
  host: { type: String, required: true },
  urlCount: { type: Number, required: true },
  status: { type: String, enum: ['success', 'failed'], required: true },
  statusCode: Number,
  trigger: { type: String, enum: ['manual', 'station-update', 'sitemap-regen', 'sync-complete', 'sitemap-diff', 'sitemap-touch-stations', 'nightly-station-sync'], required: true },
  errorMessage: String,
  sampleUrls: [String],
  retryAttempt: { type: Number, default: 0 },
  responseTime: Number,
  runDate: { type: String, required: false },
  createdAt: { type: Date, default: Date.now }
});

const AdvertisementSchema = new Schema<IAdvertisement>({
  title: { type: String, required: true },
  imageUrl: { type: String, required: true },
  altText: { type: String, required: true },
  seoDescription: { type: String, required: true },
  url: { type: String, required: true },
  position: { type: String, enum: ['desktop_sidebar', 'mobile_bottom', 'middle_section'], required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const FooterSocialMediaSchema = new Schema<IFooterSocialMedia>({
  platform: { type: String, enum: ['facebook', 'instagram', 'twitter', 'linkedin', 'whatsapp', 'telegram', 'reddit', 'pinterest', 'youtube', 'tiktok'], required: true },
  url: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  position: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// SEO Metadata Schema - per-page SEO management
const SeoMetadataSchema = new Schema<ISeoMetadata>({
  pageType: { 
    type: String, 
    required: true, 
    enum: ['homepage', 'genre_list', 'genre_detail', 'station_detail', 'country_list', 'country_detail', 'region', 'search', 'static']
  },
  routeKey: { type: String, required: true },
  language: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  ogTitle: String,
  ogDescription: String,
  ogImageUrl: String,
  twitterTitle: String,
  twitterDescription: String,
  twitterImageUrl: String,
  canonicalUrl: String,
  metaKeywords: String,
  noIndex: { type: Boolean, default: false },
  noFollow: { type: Boolean, default: false },
  source: { type: String, enum: ['manual', 'ai_generated', 'template'], default: 'manual' },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  updatedBy: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound unique index: one SEO entry per pageType + routeKey + language
SeoMetadataSchema.index({ pageType: 1, routeKey: 1, language: 1 }, { unique: true });
SeoMetadataSchema.index({ pageType: 1, status: 1 });
SeoMetadataSchema.index({ language: 1 });

// Indexes for translation system
TranslationKeySchema.index({ category: 1 });
TranslationSchema.index({ keyId: 1, language: 1 }, { unique: true });
TranslationSchema.index({ language: 1 });

// Indexes for country-language mappings
CountryLanguageMappingSchema.index({ countryCode: 1 }, { unique: true });
CountryLanguageMappingSchema.index({ isActive: 1 });

// Indexes for URL translations
UrlTranslationSchema.index({ languageCode: 1, englishPath: 1 }, { unique: true });
UrlTranslationSchema.index({ isActive: 1 });

// Indexes for IndexNow logs
IndexNowLogSchema.index({ timestamp: -1 });
IndexNowLogSchema.index({ host: 1, timestamp: -1 });
IndexNowLogSchema.index({ status: 1, timestamp: -1 });

export const UserMusicProfile = mongoose.model<IUserMusicProfile>('UserMusicProfile', UserMusicProfileSchema);
export const ListeningSession = mongoose.model<IListeningSession>('ListeningSession', ListeningSessionSchema);
export const Recommendation = mongoose.model<IRecommendation>('Recommendation', RecommendationSchema);
export const StationDebugLog = mongoose.model<IStationDebugLog>('StationDebugLog', StationDebugLogSchema);
export const UserFollow = mongoose.model('UserFollow', UserFollowSchema);
export const UserNotification = mongoose.model('UserNotification', UserNotificationSchema);
export const TranslationKey = mongoose.model<ITranslationKey>('TranslationKey', TranslationKeySchema);
export const Translation = mongoose.model<ITranslation>('Translation', TranslationSchema);
export const TranslationLanguage = mongoose.model<ITranslationLanguage>('TranslationLanguage', TranslationLanguageSchema);
export const TranslationMetadata = mongoose.model<ITranslationMetadata>('TranslationMetadata', TranslationMetadataSchema);
export const CountryLanguageMapping = mongoose.model<ICountryLanguageMapping>('CountryLanguageMapping', CountryLanguageMappingSchema);
export const UrlTranslation = mongoose.model<IUrlTranslation>('UrlTranslation', UrlTranslationSchema);
export const MediaGroup = mongoose.model<IMediaGroup>('MediaGroup', MediaGroupSchema);
export const IndexNowLog = mongoose.model<IIndexNowLog>('IndexNowLog', IndexNowLogSchema);

// Task #336 — full submitted-URL list per IndexNow submission. 30-day TTL
// keeps growth bounded; admins can still browse the last month of nightly
// sitemap-diff additions in their entirety.
const INDEXNOW_SUBMISSION_URLS_TTL_DAYS = 30;
const IndexNowSubmissionUrlsSchema = new Schema<IIndexNowSubmissionUrls>({
  logId: { type: Schema.Types.ObjectId, required: true, ref: 'IndexNowLog' },
  timestamp: { type: Date, required: true },
  host: { type: String, required: true },
  trigger: {
    type: String,
    enum: ['manual', 'station-update', 'sitemap-regen', 'sync-complete', 'sitemap-diff', 'sitemap-touch-stations', 'nightly-station-sync'],
    required: true,
  },
  urls: { type: [String], default: [] },
  urlCount: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
});
IndexNowSubmissionUrlsSchema.index({ logId: 1 }, { unique: true });
IndexNowSubmissionUrlsSchema.index({ trigger: 1, timestamp: -1 });
IndexNowSubmissionUrlsSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const IndexNowSubmissionUrls = mongoose.model<IIndexNowSubmissionUrls>(
  'IndexNowSubmissionUrls',
  IndexNowSubmissionUrlsSchema,
);
export const INDEXNOW_SUBMISSION_URLS_RETENTION_DAYS = INDEXNOW_SUBMISSION_URLS_TTL_DAYS;

const SitemapUrlSnapshotSchema = new Schema<ISitemapUrlSnapshot>({
  type: { type: String, enum: ['main', 'genres', 'stations'], required: true },
  language: { type: String, required: true },
  // chunk is set only for type='stations'. Absent for main/genres so the
  // composite (type, language, chunk) unique index treats them as a single
  // row per (type, language) (chunk is missing field → indexed as null).
  chunk: { type: Number, required: false },
  urls: { type: [String], default: [] },
  urlCount: { type: Number, required: true },
  generatedAt: { type: Date, default: Date.now, required: true },
  updatedAt: { type: Date, default: Date.now },
});
// Task #339: composite unique includes `chunk` so 'stations' rows can have
// many entries per (type, language). The legacy {type:1,language:1} unique
// index from before this task is dropped at server boot in routes.ts.
SitemapUrlSnapshotSchema.index({ type: 1, language: 1, chunk: 1 }, { unique: true });
export const SitemapUrlSnapshot = mongoose.model<ISitemapUrlSnapshot>('SitemapUrlSnapshot', SitemapUrlSnapshotSchema);
export const GscUrlInspection = mongoose.model<IGscUrlInspection>('GscUrlInspection', GscUrlInspectionSchema);
export const GscIndexingSnapshot = mongoose.model<IGscIndexingSnapshot>('GscIndexingSnapshot', GscIndexingSnapshotSchema);
export const BulkDescriptionJob = mongoose.model<IBulkDescriptionJob>('BulkDescriptionJob', BulkDescriptionJobSchema);
export const Advertisement = mongoose.model<IAdvertisement>('Advertisement', AdvertisementSchema);
export const FooterSocialMedia = mongoose.model<IFooterSocialMedia>('FooterSocialMedia', FooterSocialMediaSchema);
export const VisitorSession = mongoose.model<IVisitorSession>('VisitorSession', VisitorSessionSchema);
export const SeoMetadata = mongoose.model<ISeoMetadata>('SeoMetadata', SeoMetadataSchema);

// ==================== API Key Management ====================

export interface IApiKey {
  keyHash: string;
  keyPrefix: string;
  name: string;
  email: string;
  appName?: string;
  appUrl?: string;
  usageReason?: string;
  plan: 'demo' | 'free' | 'pro';
  status: 'active' | 'revoked' | 'expired' | 'suspended';
  rateLimitPerMin: number;
  dailyQuota: number;
  monthlyQuota: number;
  usage: {
    todayCount: number;
    monthCount: number;
    totalCount: number;
    lastUsedAt?: Date;
    lastResetDay?: string;
    lastResetMonth?: string;
  };
  createdAt: Date;
  expiresAt?: Date;
  userId?: mongoose.Types.ObjectId;
}

const ApiKeySchema = new Schema<IApiKey>({
  keyHash: { type: String, required: true },
  keyPrefix: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  appName: String,
  appUrl: String,
  usageReason: String,
  plan: { type: String, enum: ['demo', 'free', 'pro'], default: 'free' },
  status: { type: String, enum: ['active', 'revoked', 'expired', 'suspended'], default: 'active' },
  rateLimitPerMin: { type: Number, default: 60 },
  dailyQuota: { type: Number, default: 1000 },
  monthlyQuota: { type: Number, default: 10000 },
  usage: {
    todayCount: { type: Number, default: 0 },
    monthCount: { type: Number, default: 0 },
    totalCount: { type: Number, default: 0 },
    lastUsedAt: Date,
    lastResetDay: String,
    lastResetMonth: String,
  },
  createdAt: { type: Date, default: Date.now },
  expiresAt: Date,
  userId: { type: Schema.Types.ObjectId, ref: 'ApiUser' },
});

ApiKeySchema.index({ keyHash: 1 });
ApiKeySchema.index({ email: 1 });
ApiKeySchema.index({ plan: 1, status: 1 });
ApiKeySchema.index({ keyPrefix: 1 });
ApiKeySchema.index({ plan: 1, expiresAt: 1 });

export const ApiKey = mongoose.model<IApiKey>('ApiKey', ApiKeySchema);

// ==================== Demo Usage (IP-based rate limiting) ====================

export interface IDemoUsage {
  ipHash: string;
  demoKeyHash: string;
  lastIssuedAt: Date;
  expiresAt: Date;
  usageCount: number;
}

const DemoUsageSchema = new Schema<IDemoUsage>({
  ipHash: { type: String, required: true, unique: true },
  demoKeyHash: { type: String, required: true },
  lastIssuedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  usageCount: { type: Number, default: 0 },
});

DemoUsageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DemoUsage = mongoose.model<IDemoUsage>('DemoUsage', DemoUsageSchema);

// ==================== API User (Developer Portal) ====================

export interface IApiUser {
  email: string;
  passwordHash: string;
  name: string;
  company?: string;
  website?: string;
  plan: 'free' | 'pro';
  status: 'active' | 'suspended';
  apiKeys: mongoose.Types.ObjectId[];
  createdAt: Date;
  lastLoginAt?: Date;
}

const ApiUserSchema = new Schema<IApiUser>({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  company: String,
  website: String,
  plan: { type: String, enum: ['free', 'pro'], default: 'free' },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  apiKeys: [{ type: Schema.Types.ObjectId, ref: 'ApiKey' }],
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: Date,
});


export const ApiUser = mongoose.model<IApiUser>('ApiUser', ApiUserSchema);

// ==================== Mobile Auth Tokens ====================

export interface IAuthToken {
  token: string;
  userId: mongoose.Types.ObjectId;
  deviceType: 'mobile' | 'tv' | 'desktop' | 'web';
  deviceName?: string;
  expiresAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
  isRevoked: boolean;
}

const AuthTokenSchema = new Schema<IAuthToken>({
  token: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deviceType: { type: String, enum: ['mobile', 'tv', 'desktop', 'web'], default: 'mobile' },
  deviceName: String,
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  isRevoked: { type: Boolean, default: false },
});

AuthTokenSchema.index({ userId: 1 }); // token already indexed via unique: true on field
AuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthToken = mongoose.model<IAuthToken>('AuthToken', AuthTokenSchema);

// ==================== Cast Sessions (Mobile → TV Streaming) ====================

export interface ICastSession {
  sessionId: string;
  pairingCode: string;
  userId: mongoose.Types.ObjectId;
  mobileDeviceId?: string;
  tvDeviceId?: string;
  status: 'waiting_for_pair' | 'paired' | 'active' | 'expired';
  currentStation?: {
    stationId: string;
    name: string;
    slug?: string;
    streamUrl: string;
    favicon?: string;
  };
  isPlaying: boolean;
  createdAt: Date;
  pairedAt?: Date;
  expiresAt: Date;
  lastActivityAt: Date;
}

const CastSessionSchema = new Schema<ICastSession>({
  sessionId: { type: String, required: true, unique: true },
  pairingCode: { type: String, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  mobileDeviceId: String,
  tvDeviceId: String,
  status: { type: String, enum: ['waiting_for_pair', 'paired', 'active', 'expired'], default: 'waiting_for_pair' },
  currentStation: {
    stationId: String,
    name: String,
    slug: String,
    streamUrl: String,
    favicon: String,
  },
  isPlaying: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  pairedAt: Date,
  expiresAt: { type: Date, required: true },
  lastActivityAt: { type: Date, default: Date.now },
});

CastSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
CastSessionSchema.index({ userId: 1, status: 1 });

export const CastSession = mongoose.model<ICastSession>('CastSession', CastSessionSchema);

// ==================== TV Login Codes (Device Code Auth Flow) ====================

export interface ITvLoginCode {
  code: string;
  deviceId: string;
  platform: 'tizen' | 'webos' | 'other';
  status: 'pending' | 'activated' | 'expired';
  userId?: mongoose.Types.ObjectId;
  token?: string;
  expiresAt: Date;
  createdAt: Date;
  activatedAt?: Date;
}

const TvLoginCodeSchema = new Schema<ITvLoginCode>({
  code: { type: String, required: true },
  deviceId: { type: String, required: true },
  platform: { type: String, enum: ['tizen', 'webos', 'other'], default: 'other' },
  status: { type: String, enum: ['pending', 'activated', 'expired'], default: 'pending' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  token: String,
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  activatedAt: Date,
});

TvLoginCodeSchema.index({ code: 1, status: 1 });
TvLoginCodeSchema.index({ deviceId: 1, status: 1 });
TvLoginCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const TvLoginCode = mongoose.model<ITvLoginCode>('TvLoginCode', TvLoginCodeSchema);

// ==================== User Devices (Paired TV Devices) ====================

export interface IUserDevice {
  userId: mongoose.Types.ObjectId;
  deviceId: string;
  deviceName: string;
  platform: 'tizen' | 'webos' | 'other';
  lastSeenAt: Date;
  pairedAt: Date;
  isActive: boolean;
}

const UserDeviceSchema = new Schema<IUserDevice>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId: { type: String, required: true },
  deviceName: { type: String, required: true },
  platform: { type: String, enum: ['tizen', 'webos', 'other'], default: 'other' },
  lastSeenAt: { type: Date, default: Date.now },
  pairedAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
});

UserDeviceSchema.index({ userId: 1, isActive: 1 });
UserDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

export const UserDevice = mongoose.model<IUserDevice>('UserDevice', UserDeviceSchema);

// ==================== Cast Commands (Polling-based Cast System) ====================

export interface ICastCommand {
  userId: mongoose.Types.ObjectId;
  deviceId?: string;
  type: 'cast:play' | 'cast:pause' | 'cast:resume' | 'cast:stop';
  station?: {
    _id: string;
    name: string;
    url: string;
    url_resolved?: string;
    favicon?: string;
    country?: string;
    language?: string;
    tags?: string;
  };
  timestamp: number;
  consumed: boolean;
  createdAt: Date;
}

const CastCommandSchema = new Schema<ICastCommand>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId: { type: String },
  type: { type: String, enum: ['cast:play', 'cast:pause', 'cast:resume', 'cast:stop'], required: true },
  station: {
    type: {
      _id: String,
      name: String,
      url: String,
      url_resolved: String,
      favicon: String,
      country: String,
      language: String,
      tags: String,
    },
    required: false,
  },
  timestamp: { type: Number, required: true },
  consumed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

CastCommandSchema.index({ userId: 1, consumed: 1, timestamp: -1 });
CastCommandSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

export const CastCommand = mongoose.model<ICastCommand>('CastCommand', CastCommandSchema);

// ==================== Cast Now Playing (TV reports current playback) ====================

export interface ICastNowPlaying {
  userId: mongoose.Types.ObjectId;
  deviceId: string;
  platform: 'tizen' | 'webos' | 'browser';
  stationName?: string;
  title?: string;
  artist?: string;
  isPlaying: boolean;
  updatedAt: Date;
}

const CastNowPlayingSchema = new Schema<ICastNowPlaying>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId: { type: String, required: true },
  platform: { type: String, enum: ['tizen', 'webos', 'browser'], default: 'browser' },
  stationName: String,
  title: String,
  artist: String,
  isPlaying: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
});

CastNowPlayingSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

export const CastNowPlaying = mongoose.model<ICastNowPlaying>('CastNowPlaying', CastNowPlayingSchema);

// ==================== Push Notification Tokens ====================

export interface IPushToken {
  token: string;
  userId?: mongoose.Types.ObjectId | null;
  platform: 'ios' | 'android';
  tokenType: 'expo' | 'apns' | 'fcm';
  deviceName?: string;
  country?: string;
  language?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PushTokenSchema = new Schema<IPushToken>({
  token: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  platform: { type: String, enum: ['ios', 'android'], required: true },
  tokenType: { type: String, enum: ['expo', 'apns', 'fcm'], default: 'expo' },
  deviceName: { type: String, default: '' },
  country: { type: String, default: '' },
  language: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

PushTokenSchema.index({ userId: 1 });
PushTokenSchema.index({ platform: 1, isActive: 1 });
PushTokenSchema.index({ country: 1, isActive: 1 });

export const PushToken = mongoose.model<IPushToken>('PushToken', PushTokenSchema);

// ==================== Remote App Logs ====================

export interface IAppLogEntry {
  level: string;
  message: string;
  timestamp: string;
  data?: Record<string, any>;
}

export interface IAppLog {
  deviceId: string;
  appVersion: string;
  buildNumber?: string;
  platform: 'ios' | 'android';
  logs: IAppLogEntry[];
  apiKeyHash?: string;
  isCarPlayLog?: boolean;
  createdAt: Date;
}

const AppLogSchema = new Schema<IAppLog>({
  deviceId: { type: String, required: true, index: true },
  appVersion: { type: String, required: true },
  buildNumber: { type: String, default: '' },
  platform: { type: String, enum: ['ios', 'android'], required: true },
  logs: [{
    level: { type: String, required: true },
    message: { type: String, required: true },
    timestamp: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
  }],
  apiKeyHash: { type: String, default: '' },
  isCarPlayLog: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, expires: 2592000 },
});

AppLogSchema.index({ createdAt: -1 });
AppLogSchema.index({ platform: 1, createdAt: -1 });
AppLogSchema.index({ deviceId: 1, createdAt: -1 });
AppLogSchema.index({ 'logs.level': 1 });

export const AppLog = mongoose.model<IAppLog>('AppLog', AppLogSchema);
// ==================== Direct Messages ====================

export interface IDirectMessage {
  fromUserId: mongoose.Types.ObjectId;
  toUserId: mongoose.Types.ObjectId;
  content: string;
  messageType?: 'text' | 'image' | 'emoji';
  imageUrl?: string;
  read: boolean;
  createdAt: Date;
}

const DirectMessageSchema = new Schema<IDirectMessage>({
  fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  toUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, maxlength: 2000 },
  messageType: { type: String, enum: ['text', 'image', 'emoji'], default: 'text' },
  imageUrl: { type: String },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

DirectMessageSchema.index({ fromUserId: 1, toUserId: 1, createdAt: -1 });
DirectMessageSchema.index({ toUserId: 1, read: 1 });

export const DirectMessage = mongoose.model<IDirectMessage>('DirectMessage', DirectMessageSchema);

// ==================== SEO Qualified Languages LKG (Last-Known-Good) ====================
// Singleton store of the last-known-good list of qualified SEO languages.
// Used by `server/seo/qualified-languages.ts` as a fail-closed fallback when
// the in-memory cache is cold AND the live computation returns zero results.
// Replaces the old fail-open behavior that emitted ALL 49 ACTIVE_SITEMAP_LANGUAGES,
// which caused Cloudflare to cache a sitemap-index referencing non-existent
// child sitemaps for 24h and produced 1023 Bing crawl errors.
export interface ISeoQualifiedLanguagesLkg extends Document {
  key: string;                 // singleton: 'qualified_languages'
  languages: string[];         // sorted ascending for stable hash
  hash: string;                // sha256(languages.join(','))
  source: 'computed' | 'seed';
  computedAt: Date;
  expiresAt: Date;             // TTL ~30 days
  createdAt: Date;
  updatedAt: Date;
}

const SeoQualifiedLanguagesLkgSchema = new Schema<ISeoQualifiedLanguagesLkg>({
  key: { type: String, required: true, unique: true },
  languages: [{ type: String, required: true }],
  hash: { type: String, required: true },
  source: { type: String, enum: ['computed', 'seed'], required: true },
  computedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

SeoQualifiedLanguagesLkgSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SeoQualifiedLanguagesLkg = mongoose.model<ISeoQualifiedLanguagesLkg>(
  'SeoQualifiedLanguagesLkg',
  SeoQualifiedLanguagesLkgSchema,
);

// ==================== Sitemap Manifest (per-language, per-type chunked plan) ====================
// One document per (type, language, version, status). Status flow:
//   building --(success)--> active --(swap)--> superseded --(TTL)--> deleted
//   building --(failure)--> failed --(TTL)--> deleted
//
// Compound partial-unique indexes guarantee at most one `active` and one
// `building` doc per (type, language) so the atomic swap is safe.
//
// Routes (`/sitemap-index.xml`, `/sitemap-stations-{lang}-{chunk}.xml`,
// `/sitemap-genres-{lang}.xml`, `/sitemap-main-{lang}.xml`) read from `active`
// only — eliminating the old global Math.ceil(50000/1000)=50 chunks-per-language
// strategy that emitted empty chunks for sparse languages.
export interface ISitemapManifestChunk {
  chunk: number;                                     // 1-indexed
  // Mixed: Station._id is ObjectId, Genre._id can be a string slug ('genre-pop')
  // for legacy seed data. Schema uses Mixed; route code casts via String().
  stationIds: Array<mongoose.Types.ObjectId | string>;
  urlCount: number;
  maxUpdatedAt?: Date;                               // for <lastmod>; only set when real station.updatedAt exists
}

export interface ISitemapManifest extends Document {
  type: 'stations' | 'main' | 'genres';
  language: string;
  version: string;                                   // e.g. timestamp-based or content-hash
  status: 'building' | 'active' | 'superseded' | 'failed';
  qualifiedLanguagesHash: string;                    // hash of the qualifiedLanguages snapshot used at build time
  qualifiedLanguages: string[];                      // snapshot for audit
  chunks: ISitemapManifestChunk[];
  totalUrls: number;
  chunkCount: number;
  generatedAt: Date;
  expiresAt: Date;                                   // TTL cleanup for non-active docs
  errorMessage?: string;
}

const SitemapManifestChunkSchema = new Schema<ISitemapManifestChunk>({
  chunk: { type: Number, required: true },
  // Mixed accepts both ObjectId (Station._id) and String (legacy Genre._id like 'genre-pop').
  stationIds: { type: [Schema.Types.Mixed], default: [] },
  urlCount: { type: Number, required: true },
  maxUpdatedAt: { type: Date },
}, { _id: false });

const SitemapManifestSchema = new Schema<ISitemapManifest>({
  type: { type: String, enum: ['stations', 'main', 'genres'], required: true },
  language: { type: String, required: true },
  version: { type: String, required: true },
  status: { type: String, enum: ['building', 'active', 'superseded', 'failed'], required: true },
  qualifiedLanguagesHash: { type: String, required: true },
  qualifiedLanguages: [{ type: String }],
  chunks: { type: [SitemapManifestChunkSchema], default: [] },
  totalUrls: { type: Number, required: true, default: 0 },
  chunkCount: { type: Number, required: true, default: 0 },
  generatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  errorMessage: { type: String },
});

// Primary read index — covers all sitemap-route queries
SitemapManifestSchema.index({ type: 1, language: 1, status: 1, generatedAt: -1 });
// At most ONE building doc per (type, language) — prevents concurrent rebuilds.
// We do NOT enforce a unique active doc; activateManifest() best-effort
// demotes the previous active to superseded, but a brief overlap is tolerated
// when transactions aren't available. Routes pick `findOne(status:active)`
// sorted by generatedAt desc so the newer one wins regardless.
SitemapManifestSchema.index(
  { type: 1, language: 1 },
  { unique: true, partialFilterExpression: { status: 'building' } },
);
SitemapManifestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SitemapManifest = mongoose.model<ISitemapManifest>(
  'SitemapManifest',
  SitemapManifestSchema,
);

// ==================== IAP Audit Events ====================
// Per-call audit trail for /api/iap/validate. Lets admins answer
// "kim ne zaman hangi makbuzla doğruladı" when Apple/Google issue refunds,
// when a user disputes a charge, or when fraud is suspected.
//
// One row per validate attempt — both successful and failed. Auto-expires
// after 365 days (Apple/Google refund windows are < 90 days, plus headroom
// for chargeback disputes).

export type IapEventResult =
  | 'success'              // verify OK + DB persisted
  | 'replay_blocked'       // 409 — receipt attached to another user
  | 'invalid_receipt'      // verify returned valid:false (any provider code)
  | 'expired'              // verify returned expired
  | 'apple_error'          // Apple network/server error
  | 'google_error'         // Google network/server error
  | 'missing_credentials'  // server-side config missing
  | 'bad_request'          // client sent malformed input (400 before verify)
  | 'persist_error'        // verify OK but DB write failed
  | 'fatal_error';         // unhandled exception (500)

export interface IIapEvent {
  userId?: mongoose.Types.ObjectId | null;
  platform: 'ios' | 'android' | 'unknown';
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  // SHA-256 hex of the full receipt/purchaseToken — never store the raw
  // value (it's a credential that can re-validate the purchase server-side).
  receiptHash?: string;
  result: IapEventResult;
  // Provider-specific code from verify (e.g. "expired", "apple_cancelled",
  // "google_consumed", "google_no_expiry").
  providerCode?: string;
  statusCode: number;
  errorMessage?: string;
  // Subscription state computed from the verify result (only set on success
  // or when verify yielded structured data — useful for "what plan was the
  // user about to be granted?").
  plan?: string;
  isTrial?: boolean;
  expiresAt?: Date | null;
  isLifetime?: boolean;
  ip?: string;
  userAgent?: string;
  durationMs?: number;
  createdAt: Date;
}

const IapEventSchema = new Schema<IIapEvent>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  platform: { type: String, enum: ['ios', 'android', 'unknown'], required: true },
  productId: { type: String, default: '' },
  transactionId: { type: String, default: '' },
  originalTransactionId: { type: String, default: '', index: true },
  receiptHash: { type: String, default: '' },
  result: {
    type: String,
    enum: [
      'success',
      'replay_blocked',
      'invalid_receipt',
      'expired',
      'apple_error',
      'google_error',
      'missing_credentials',
      'bad_request',
      'persist_error',
      'fatal_error',
    ],
    required: true,
    index: true,
  },
  providerCode: { type: String, default: '' },
  statusCode: { type: Number, required: true },
  errorMessage: { type: String, default: '' },
  plan: { type: String, default: '' },
  isTrial: { type: Boolean, default: false },
  expiresAt: { type: Date, default: null },
  isLifetime: { type: Boolean, default: false },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  durationMs: { type: Number, default: 0 },
  // 365-day TTL — purges on its own so the collection doesn't grow forever.
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 365 },
});

IapEventSchema.index({ createdAt: -1 });
IapEventSchema.index({ userId: 1, createdAt: -1 });
IapEventSchema.index({ result: 1, createdAt: -1 });
IapEventSchema.index({ platform: 1, createdAt: -1 });
IapEventSchema.index({ productId: 1, createdAt: -1 });
IapEventSchema.index({ originalTransactionId: 1, createdAt: -1 });

export const IapEvent = mongoose.model<IIapEvent>('IapEvent', IapEventSchema);

// =====================================================================
// Admin per-user view preferences
//
// Stores per-admin client UI preferences (filters, sorts, toggles, etc.)
// keyed by a string namespace so the same mechanism can back any admin
// page that needs cross-device sync.
// =====================================================================
export interface IAdminPreference extends Document {
  adminUsername: string;
  key: string;
  value: any;
  updatedAt: Date;
  createdAt: Date;
}

const AdminPreferenceSchema = new Schema<IAdminPreference>({
  adminUsername: { type: String, required: true },
  key: { type: String, required: true },
  value: { type: Schema.Types.Mixed, default: null },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

AdminPreferenceSchema.index({ adminUsername: 1, key: 1 }, { unique: true });

export const AdminPreference = mongoose.model<IAdminPreference>(
  'AdminPreference',
  AdminPreferenceSchema,
);

// =====================================================================
// Admin global settings
//
// Stores team-wide settings that override env defaults at runtime, so
// admins can tune them from the UI without a redeploy. Keyed by a
// stable string namespace (e.g. `coverage-drop-alert`) so the same
// mechanism backs any number of admin settings panels.
// =====================================================================
export interface IAdminSetting extends Document {
  key: string;
  value: any;
  updatedBy?: string;
  updatedAt: Date;
  createdAt: Date;
}

const AdminSettingSchema = new Schema<IAdminSetting>({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, default: null },
  updatedBy: { type: String, default: null },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

export const AdminSetting = mongoose.model<IAdminSetting>(
  'AdminSetting',
  AdminSettingSchema,
);

// =====================================================================
// AdminSettingHistory — append-only audit log of every PUT/DELETE made
// against an `AdminSetting` row (Task #243). Lets the admin UI surface
// "who changed what, when" so threshold tuning is reversible without
// digging through database backups. We persist both the previous and
// next value so the UI can offer a one-click revert without recomputing
// state from a sequence of diffs.
//
// Retention policy (Task #329): the collection is otherwise unbounded
// and a runaway script that hammers PUT /api/admin/settings/* could
// balloon it without limit. A nightly prune job
// (`scheduled-admin-setting-history-prune.ts` in `api-server`) keeps the
// most recent `ADMIN_SETTING_HISTORY_RETENTION_PER_KEY` entries per key
// and trims everything older. This is a per-key cap (rather than a flat
// TTL) so a quiet setting that genuinely only changes once a year keeps
// its full audit trail, while a hot/abused key cannot grow without
// bound. The cap is comfortably above the admin UI's max page size
// (currently 100) so the "Recent changes" panel is never affected.
// =====================================================================
export const ADMIN_SETTING_HISTORY_RETENTION_PER_KEY = 500;

export type AdminSettingHistoryAction = 'update' | 'clear';

export interface IAdminSettingHistory extends Document {
  key: string;
  action: AdminSettingHistoryAction;
  previousValue: any;
  newValue: any;
  changedBy?: string | null;
  changedAt: Date;
}

const AdminSettingHistorySchema = new Schema<IAdminSettingHistory>({
  key: { type: String, required: true, index: true },
  action: { type: String, enum: ['update', 'clear'], required: true },
  previousValue: { type: Schema.Types.Mixed, default: null },
  newValue: { type: Schema.Types.Mixed, default: null },
  changedBy: { type: String, default: null },
  changedAt: { type: Date, default: Date.now, index: true },
});

AdminSettingHistorySchema.index({ key: 1, changedAt: -1 });

export const AdminSettingHistory = mongoose.model<IAdminSettingHistory>(
  'AdminSettingHistory',
  AdminSettingHistorySchema,
);

// =====================================================================
// GenreWhitelistOverride — admin-managed deltas on top of the static
// genre whitelist seed (`seo/genre-whitelist.ts`). Lets the team add or
// remove canonical genre slugs and source→canonical aliases without
// shipping code. The runtime store merges these with the static seed
// (see seo/genre-whitelist-store.ts) and the SSR + sitemap layers read
// the merged set, so removing a slug here gives the same behavior as
// removing it from the static file: dropped from sitemap on next
// rebuild, served noindex by SSR immediately.
// =====================================================================
export type GenreWhitelistOverrideKind =
  | 'slug-add'
  | 'slug-remove'
  | 'alias-add'
  | 'alias-remove';

export interface IGenreWhitelistOverride extends Document {
  kind: GenreWhitelistOverrideKind;
  // For 'slug-add' / 'slug-remove': the canonical genre slug.
  // For 'alias-add' / 'alias-remove': the alias source slug.
  slug: string;
  // For 'alias-add' only: the canonical slug the alias resolves to.
  canonical?: string | null;
  createdBy: string;
  createdAt: Date;
  notes?: string;
}

const GenreWhitelistOverrideSchema = new Schema<IGenreWhitelistOverride>({
  kind: {
    type: String,
    required: true,
    enum: ['slug-add', 'slug-remove', 'alias-add', 'alias-remove'],
  },
  slug: { type: String, required: true, lowercase: true, trim: true },
  canonical: { type: String, default: null, lowercase: true, trim: true },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  notes: { type: String, default: '' },
});

// One row per (kind, slug). For aliases this means at most one
// alias-add OR alias-remove per source slug — adding a new alias for an
// already-aliased source replaces the previous one (upsert).
GenreWhitelistOverrideSchema.index({ kind: 1, slug: 1 }, { unique: true });

export const GenreWhitelistOverride = mongoose.model<IGenreWhitelistOverride>(
  'GenreWhitelistOverride',
  GenreWhitelistOverrideSchema,
);

// =====================================================================
// GenreWhitelistPushLog — persisted history of "push the genre whitelist
// to search engines" outcomes (task #255). The same step-level fields
// the in-memory `genre-whitelist-push-status` singleton tracks for the
// "Last push" admin card, but written to Mongo on completion so they
// survive an api-server restart and so admins can spot a flapping
// IndexNow endpoint or a slug that keeps failing across multiple
// attempts.
//
// We log on completion only (in-progress pushes still come from the
// in-memory singleton). 90-day TTL keeps the collection self-pruning;
// the admin UI renders only the most recent ~20 rows.
// =====================================================================
export type GenreWhitelistPushStepStatus = 'pending' | 'success' | 'failed' | 'skipped';

export interface IGenreWhitelistPushLogStep {
  status: GenreWhitelistPushStepStatus;
  error?: string | null;
  urlCount?: number | null;
}

export interface IGenreWhitelistPushLog extends Document {
  triggeredAt: Date;
  completedAt: Date;
  triggeredBy: string | null;
  trigger: string;
  affectedSlugs: string[];
  sitemapRebuild: IGenreWhitelistPushLogStep;
  indexnowSitemap: IGenreWhitelistPushLogStep;
  indexnowGenreUrls: IGenreWhitelistPushLogStep;
  createdAt: Date;
}

const GenreWhitelistPushLogStepSchema = new Schema<IGenreWhitelistPushLogStep>(
  {
    status: {
      type: String,
      required: true,
      enum: ['pending', 'success', 'failed', 'skipped'],
    },
    error: { type: String, default: null },
    urlCount: { type: Number, default: null },
  },
  { _id: false },
);

const GenreWhitelistPushLogSchema = new Schema<IGenreWhitelistPushLog>({
  triggeredAt: { type: Date, required: true },
  completedAt: { type: Date, required: true },
  triggeredBy: { type: String, default: null },
  trigger: { type: String, required: true },
  affectedSlugs: { type: [String], default: [] },
  sitemapRebuild: { type: GenreWhitelistPushLogStepSchema, required: true },
  indexnowSitemap: { type: GenreWhitelistPushLogStepSchema, required: true },
  indexnowGenreUrls: { type: GenreWhitelistPushLogStepSchema, required: true },
  // 90-day TTL — long enough to spot recurring failures across weeks,
  // bounded so the collection self-prunes without manual intervention.
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
});

GenreWhitelistPushLogSchema.index({ triggeredAt: -1 });

export const GenreWhitelistPushLog = mongoose.model<IGenreWhitelistPushLog>(
  'GenreWhitelistPushLog',
  GenreWhitelistPushLogSchema,
);

// =====================================================================
// AppleWebhookEvent — idempotency store for App Store Server Notifications V2
//
// Apple may retry the same notification many times (network failures, our 5xx,
// out-of-order delivery, etc.). The notificationUUID is the unique payload
// identifier per Apple docs. We do an insert-or-409 on this collection to
// short-circuit replays before mutating User.subscription.
// =====================================================================
export interface IAppleWebhookEvent {
  notificationUUID: string;
  notificationType: string;
  subtype?: string;
  signedDate?: Date;
  originalTransactionId?: string;
  bundleId?: string;
  environment?: string;
  receivedAt: Date;
}

const AppleWebhookEventSchema = new Schema<IAppleWebhookEvent>({
  notificationUUID: { type: String, required: true, unique: true, index: true },
  notificationType: { type: String, required: true },
  subtype: { type: String, default: '' },
  signedDate: { type: Date, default: null },
  originalTransactionId: { type: String, default: '', index: true },
  bundleId: { type: String, default: '' },
  environment: { type: String, default: '' },
  // 90-day TTL — Apple won't retry beyond a few days but we keep a window for forensics.
  receivedAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
});

AppleWebhookEventSchema.index({ originalTransactionId: 1, signedDate: -1 });

export const AppleWebhookEvent = mongoose.model<IAppleWebhookEvent>(
  'AppleWebhookEvent',
  AppleWebhookEventSchema,
);

// =====================================================================
// ClearedOverridesAuditLog — durable audit trail for admin actions on
// country-language mappings. Originally only logged the "Clear overrides"
// bulk action; now also logs per-row create/update/delete and bulk save
// so admins always have a paper trail of every change.
//
// `action` distinguishes the trigger; `changes` captures per-row diffs
// (previous → new) for edit/delete/bulk-save; `snapshot` retains the
// historical clear-overrides/reset-all rows so existing CSV downloads
// continue to work unchanged.
//
// Bounded growth: a 180-day TTL keeps the collection self-pruning, and
// route-level pruning enforces a per-collection MAX_ENTRIES cap so the
// admin panel and backing query stay fast even under heavy usage.
// =====================================================================
export type CountryLanguageMappingAuditAction =
  | 'clear-overrides'
  | 'reset-all'
  | 'edit'
  | 'delete'
  | 'bulk-save';

export interface IClearedOverridesAuditLogEntry {
  countryCode: string;
  countryName: string;
  currentLanguageCode: string;
  defaultLanguageCode: string;
}

export interface ICountryLanguageMappingAuditChange {
  countryCode: string;
  countryName: string;
  previousLanguageCode: string | null;
  newLanguageCode: string | null;
}

export interface IClearedOverridesAuditLog extends Document {
  action: CountryLanguageMappingAuditAction;
  actorEmail: string | null;
  deletedCount: number;
  snapshot: IClearedOverridesAuditLogEntry[];
  changes: ICountryLanguageMappingAuditChange[];
  createdAt: Date;
}

const ClearedOverridesAuditLogEntrySchema = new Schema<IClearedOverridesAuditLogEntry>(
  {
    countryCode: { type: String, required: true },
    countryName: { type: String, required: true },
    currentLanguageCode: { type: String, required: true },
    defaultLanguageCode: { type: String, required: true },
  },
  { _id: false },
);

const CountryLanguageMappingAuditChangeSchema = new Schema<ICountryLanguageMappingAuditChange>(
  {
    countryCode: { type: String, required: true },
    countryName: { type: String, required: true },
    previousLanguageCode: { type: String, default: null },
    newLanguageCode: { type: String, default: null },
  },
  { _id: false },
);

const ClearedOverridesAuditLogSchema = new Schema<IClearedOverridesAuditLog>({
  // Default preserves back-compat for documents written before this field
  // existed — they were all clear-overrides invocations.
  action: {
    type: String,
    enum: ['clear-overrides', 'reset-all', 'edit', 'delete', 'bulk-save'],
    required: true,
    default: 'clear-overrides',
    index: true,
  },
  actorEmail: { type: String, default: null },
  deletedCount: { type: Number, required: true, default: 0 },
  snapshot: { type: [ClearedOverridesAuditLogEntrySchema], default: [] },
  changes: { type: [CountryLanguageMappingAuditChangeSchema], default: [] },
  // 180-day TTL — long enough to cover quarterly audits but bounded so
  // the collection self-prunes without manual intervention.
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
});

ClearedOverridesAuditLogSchema.index({ createdAt: -1 });

export const ClearedOverridesAuditLog = mongoose.model<IClearedOverridesAuditLog>(
  'ClearedOverridesAuditLog',
  ClearedOverridesAuditLogSchema,
);

// =====================================================================
// GenreMergeAuditLog — Task #289 — durable audit trail for the admin
// "merge demoted genre into winner" action exposed at
// POST /api/admin/genres/:id/merge-into-winner.
//
// The merge endpoint deletes the demoted Genre row and rewrites every
// matching station in place, so a single mis-click is otherwise
// unrecoverable from the application logs. Each successful merge writes
// one structured row capturing: the demoted side (id/name/slug), the
// winner side (id/name/slug), whether the winner came from the recorded
// `cleanupDemotion.collisionWinnerId` ("auto-recorded") or was picked
// manually by the admin ("manual"), the count of matched vs re-tagged
// stations, and the acting admin (id + email when available).
//
// Bounded growth: 180-day TTL plus a per-collection MAX_ENTRIES soft cap
// pruned on write so the admin "merge history" panel and backing query
// stay fast even after years of merges.
// =====================================================================
export type GenreMergeAuditTargetSource = 'manual' | 'auto-recorded';

export interface IGenreMergeAuditLog extends Document {
  demotedGenreId: string;
  demotedGenreName: string;
  demotedGenreSlug: string;
  winnerGenreId: string;
  winnerGenreName: string;
  winnerGenreSlug: string;
  targetSource: GenreMergeAuditTargetSource;
  stationsMatched: number;
  stationsRetagged: number;
  actorUserId: string | null;
  actorEmail: string | null;
  createdAt: Date;
}

const GenreMergeAuditLogSchema = new Schema<IGenreMergeAuditLog>({
  demotedGenreId: { type: String, required: true, index: true },
  demotedGenreName: { type: String, required: true },
  demotedGenreSlug: { type: String, default: '' },
  winnerGenreId: { type: String, required: true, index: true },
  winnerGenreName: { type: String, required: true },
  winnerGenreSlug: { type: String, default: '' },
  targetSource: {
    type: String,
    enum: ['manual', 'auto-recorded'],
    required: true,
    index: true,
  },
  stationsMatched: { type: Number, required: true, default: 0 },
  stationsRetagged: { type: Number, required: true, default: 0 },
  actorUserId: { type: String, default: null },
  actorEmail: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
});

GenreMergeAuditLogSchema.index({ createdAt: -1 });

export const GenreMergeAuditLog = mongoose.model<IGenreMergeAuditLog>(
  'GenreMergeAuditLog',
  GenreMergeAuditLogSchema,
);

// =====================================================================
// SharedComparisonPreset — Task #306. Shared admin coverage-compare
// presets that any signed-in admin can pin so the entire team sees the
// same quick-pick chip on /admin/coverage/compare. Per-admin private
// presets continue to live under `AdminPreference` keyed by
// `coverage-compare:presets:v1`; this collection holds only the ones an
// admin has explicitly chosen to share with the rest of the team.
//
// Editing/deleting a shared preset is restricted to the original owner
// (or to a username listed in the optional `SUPER_ADMIN_USERNAMES`
// env var). Other admins can hide a shared preset locally; the hidden
// id list is persisted alongside their private presets in
// AdminPreference and never reaches this collection.
// =====================================================================
export interface ISharedComparisonPreset extends Document {
  name: string;
  countries: string[];
  ownerUsername: string;
  createdAt: Date;
  updatedAt: Date;
}

const SharedComparisonPresetSchema = new Schema<ISharedComparisonPreset>({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  countries: { type: [String], required: true },
  ownerUsername: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Case-insensitive uniqueness on name so admins don't accidentally
// publish two team chips with the same label.
SharedComparisonPresetSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);

export const SharedComparisonPreset = mongoose.model<ISharedComparisonPreset>(
  'SharedComparisonPreset',
  SharedComparisonPresetSchema,
);

// =====================================================================
// 2026-05-12: Consolidated query indexes for collections that lacked
// coverage (Task: "tüm collection'lara detaylı search index ekle").
//
// IMPORTANT: this block only adds indexes for fields that are actually
// queried by api-server (verified against rg "Model.find/findOne/
// countDocuments" call sites). It deliberately AVOIDS:
//   - re-declaring any field already marked `unique: true` or
//     `index: true` inline in its schema (Mongoose would emit
//     "Duplicate schema index" warnings on boot).
//   - unique constraints on User.email / User.googleId / etc. (those
//     are already declared inline; re-adding would warn).
//   - free-text $text indexes (Station.name search uses regex on a
//     small filtered set, not full collection scans — adding $text
//     would force a single-language tokenizer onto a multi-language
//     collection and break the regex queries).
//
// Mongoose applies these via autoIndex on first connection. Atlas M10+
// builds them in the background so adding new indexes is non-blocking.
// =====================================================================

// ---- Station: gap-fill (existing covers name, country, language, tags,
// votes, clickCount, updatedAt, codec, slug, slugAliases, noIndex,
// isFeatured, aiDescriptionSkipped, averageRating, logoAssets.status,
// stationuuid, plus 3 hot compound indexes + 2dsphere on location).
StationSchema.index({ favicon: 1 }, { sparse: true }); // logo-routes "has favicon" countDocuments
StationSchema.index({ tagsCheckedAt: 1 }, { sparse: true }); // admin tag-refresh cooldown filter
StationSchema.index({ state: 1 }, { sparse: true }); // US/CA state-level region pages
StationSchema.index({ hasLogo: 1, lastCheckOk: 1 }); // sitemap "has-logo + working" filter
StationSchema.index({ mediaGroupId: 1 }, { sparse: true }); // sibling-station lookup

// ---- User: gap-fill (existing covers slug, isPublicProfile + inline
// uniques on email, username, googleId, facebookId, appleId).
UserSchema.index({ role: 1 }, { sparse: true }); // admin/moderator role filter
UserSchema.index({ status: 1 }); // active/suspended user filter
UserSchema.index({ createdAt: -1 }); // admin "newest users" listing
UserSchema.index({ 'subscription.plan': 1, 'subscription.isActive': 1 }); // premium-user lookups
UserSchema.index({ 'subscription.expiresAt': 1 }, { sparse: true }); // subscription expiry sweeps

// ---- UserSession: TTL on its own expiresAt field
UserSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ---- AnalyticsEvent: time-series queries by station/user/event
AnalyticsEventSchema.index({ stationId: 1, timestamp: -1 });
AnalyticsEventSchema.index({ userId: 1, timestamp: -1 }, { sparse: true });
AnalyticsEventSchema.index({ event: 1, timestamp: -1 });
AnalyticsEventSchema.index({ timestamp: -1 });

// ---- Feedback: admin queue
FeedbackSchema.index({ status: 1, createdAt: -1 });
FeedbackSchema.index({ userId: 1, createdAt: -1 }, { sparse: true });
FeedbackSchema.index({ type: 1, status: 1 });

// ---- StationComment: per-station comment list + user activity
StationCommentSchema.index({ stationId: 1, createdAt: -1 });
StationCommentSchema.index({ userId: 1, createdAt: -1 });
StationCommentSchema.index({ parentCommentId: 1 }, { sparse: true });
StationCommentSchema.index({ isModerated: 1, createdAt: -1 });

// ---- Notification: per-user feed
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1 });
NotificationSchema.index({ type: 1, createdAt: -1 });

// ---- AdvancedSearch: per-user history + analytics rollups
AdvancedSearchSchema.index({ userId: 1, searchedAt: -1 }, { sparse: true });
AdvancedSearchSchema.index({ searchedAt: -1 });

// ---- StationRequest / StationSubmission: admin moderation queue
StationRequestSchema.index({ status: 1, createdAt: -1 });
StationRequestSchema.index({ submittedByEmail: 1, createdAt: -1 }, { sparse: true });
StationSubmissionSchema.index({ status: 1, createdAt: -1 });
StationSubmissionSchema.index({ email: 1, createdAt: -1 }, { sparse: true });

// ---- Translation infrastructure (keyId+language unique, category,
// already declared earlier in file — only add net-new ones here).
TranslationSchema.index({ language: 1, isCompleted: 1 });
TranslationLanguageSchema.index({ isEnabled: 1 });
TranslationLanguageSchema.index({ isDefault: 1 }, { sparse: true });

// ---- CountryLanguageMapping: gap-fill (countryCode unique already declared).
CountryLanguageMappingSchema.index({ languageCode: 1, isActive: 1 });
CountryLanguageMappingSchema.index({ isActive: 1, priority: -1 });

// ---- UrlTranslation: gap-fill ((languageCode, englishPath) unique
// already declared earlier).
UrlTranslationSchema.index({ languageCode: 1, isActive: 1 });
UrlTranslationSchema.index({ translatedPath: 1 });

// ---- IndexNowLog: gap-fill (timestamp -1, host+timestamp,
// status+timestamp already declared earlier).
IndexNowLogSchema.index({ trigger: 1, timestamp: -1 });
IndexNowLogSchema.index({ runDate: 1 }, { sparse: true });

// ---- Advertisement / FooterSocialMedia: active-list rendering
AdvertisementSchema.index({ position: 1, isActive: 1 });
AdvertisementSchema.index({ isActive: 1 });
FooterSocialMediaSchema.index({ isActive: 1, position: 1 });
FooterSocialMediaSchema.index({ platform: 1 });

// ---- MediaGroup: lookup by name (sibling-station UI)
MediaGroupSchema.index({ name: 1 });

// ---- BlacklistedStation: dedupe lookup by upstream UUID
BlacklistedStationSchema.index({ stationUuid: 1 }, { sparse: true });
BlacklistedStationSchema.index({ radioBrowserId: 1 }, { sparse: true });

// ---- SeoQualifiedLanguagesLkg: TTL purge already declared earlier.
// (no net-new indexes needed — singleton row keyed by `key`).

// ---- AdminSettingHistory: changedAt inline-indexed + (key, changedAt -1)
// compound already declared earlier — no net-new indexes needed.

// ---- ClearedOverridesAuditLog: gap-fill (createdAt -1 already declared).
ClearedOverridesAuditLogSchema.index({ action: 1, createdAt: -1 });
ClearedOverridesAuditLogSchema.index({ actorEmail: 1, createdAt: -1 }, { sparse: true });

// ---- GenreMergeAuditLog: createdAt -1 already declared earlier.

// ---- StationSubmission/StationRequest also lookup by name dupe-check
StationSubmissionSchema.index({ stream_url: 1 });
StationRequestSchema.index({ stationUrl: 1 });

// ---- StationEngagement: stationId is already unique+indexed inline;
// totalFavorites/averageRating/trendingScore are inline-indexed too.
// Add only a real timestamp sort path the recommendation engine uses.
StationEngagementSchema.index({ lastUpdated: -1 });

// ---- PublicUserProfile: slug is already unique+indexed inline,
// sessionId + isPublic are inline-indexed — add a userId lookup for
// "my profile" routes (sparse since anonymous profiles omit it).
PublicUserProfileSchema.index({ userId: 1 }, { sparse: true });

// ---- StationPlaybackCache: time-based cleanup of stale entries
StationPlaybackCacheSchema.index({ updatedAt: -1 });

