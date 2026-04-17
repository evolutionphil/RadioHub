import type { Express } from "express";
import mongoose from 'mongoose';
import { User, UserFollow, AuthToken, UserNotification, UserFavorite, StationRating, StationComment, UserListeningHistory, UserProfile, PublicUserProfile, ListeningSession, Recommendation, UserMusicProfile, PushToken, UserDevice, CastSession, DirectMessage, UserSession, Notification, AdvancedSearch, AnalyticsEvent, CastCommand, CastNowPlaying, TvLoginCode } from '../../shared/mongo-schemas';
import { logger } from '../utils/logger';

async function generateAppleClientSecret(): Promise<string> {
  const jose = await import('jose');
  
  const teamId = process.env.APPLE_TEAM_ID || '';
  const clientId = process.env.APPLE_SERVICE_ID || process.env.APPLE_CLIENT_ID || '';
  const keyId = process.env.APPLE_KEY_ID || '';
  let privateKeyPem = process.env.APPLE_PRIVATE_KEY || '';
  
  privateKeyPem = privateKeyPem.replace(/\\n/g, '\n');
  
  const privateKey = await jose.importPKCS8(privateKeyPem, 'ES256');
  
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + 15777000)
    .setAudience('https://appleid.apple.com')
    .setSubject(clientId)
    .sign(privateKey);
  
  return jwt;
}

export function registerUserAuthRoutes(app: Express, deps: any) {
  const { requireAuth, requireAdmin, generateAuthToken, passport } = deps;

  // USER MANAGEMENT API ENDPOINTS — admin only (enumerable PII)
  
  // Get all users with filters and pagination
  app.get("/api/users", requireAdmin, async (req, res) => {
    try {
      // logger.log(' Fetching users...');
      
      const { search, status, role, page = 1, limit = 20, sortBy = 'newest' } = req.query;
      
      // Build filter based on query params
      const filter: any = {};
      
      if (search) {
        filter.$or = [
          { username: { $regex: search, $options: 'i' } },
          { fullName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }
      
      if (status && status !== 'all') {
        filter.status = status;
      }
      
      if (role && role !== 'all') {
        filter.role = role;
      }

      const skip = (Number(page) - 1) * Number(limit);
      
      // Build sort object based on sortBy parameter
      let sortObject: any = {};
      switch (sortBy) {
        case 'oldest':
          sortObject = { createdAt: 1 };
          break;
        case 'most_radios':
          // Will handle with aggregation below
          break;
        case 'least_radios':
          // Will handle with aggregation below  
          break;
        case 'newest':
        default:
          sortObject = { createdAt: -1 };
          break;
      }
      
      let users;
      
      // For sorting by favorite stations count, use aggregation
      if (sortBy === 'most_radios' || sortBy === 'least_radios') {
        const pipeline: any[] = [
          { $match: filter },
          {
            $addFields: {
              favoriteStationsCount: {
                $cond: {
                  if: { $isArray: "$favoriteStations" },
                  then: { $size: "$favoriteStations" },
                  else: 0
                }
              }
            }
          },
          { 
            $sort: sortBy === 'most_radios' 
              ? { favoriteStationsCount: -1, createdAt: -1 }
              : { favoriteStationsCount: 1, createdAt: -1 }
          },
          { $skip: skip },
          { $limit: Number(limit) },
          {
            $project: {
              passwordHash: 0,
              emailVerificationToken: 0,
              resetPasswordToken: 0
            }
          }
        ];
        
        users = await User.aggregate(pipeline);
      } else {
        // Regular sorting for date-based sorting
        users = await User.find(filter)
          .select('-passwordHash -emailVerificationToken -resetPasswordToken')
          .sort(sortObject)
          .skip(skip)
          .limit(Number(limit))
          .lean();
      }

      const total = await User.countDocuments(filter);

      // Calculate enhanced user statistics for each user
      const enhancedUsers = await Promise.all(users.map(async (user: any) => {
        // Calculate favorite stations count (may already be calculated in aggregation)
        const favoriteCount = user.favoriteStationsCount || user.favoriteStations?.length || 0;
        
        // Calculate total listening time from recent plays
        const totalListening = user.recentlyPlayedStations?.reduce((sum: number, play: any) => 
          sum + (play.playDuration || 0), 0) || 0;
        
        // Get user's created stations count
        const Station = mongoose.model('Station');
        const userIdStr = (user._id as any).toString();
        const createdStationsCount = await Station.countDocuments({ 
          createdBy: userIdStr 
        });

        return {
          ...user,
          favoriteStationsCount: favoriteCount,
          totalListeningTime: Math.round(totalListening / 60), // Convert to hours
          stationsCreatedCount: createdStationsCount,
          followersCount: user.followersCount || 0,
          followingCount: user.followingCount || 0,
          stats: {
            ...(user.stats || {}),
            totalPlays: user.recentlyPlayedStations?.length || 0,
            totalListeningHours: Math.round(totalListening / 3600), // Convert to hours
            joinDate: user.createdAt,
            lastActiveDate: user.lastLoginAt || user.createdAt
          }
        };
      }));

      // logger.log(` Found ${users.length} users (${total} total) sorted by ${sortBy}`);
      res.json({ 
        users: enhancedUsers, 
        total, 
        page: Number(page), 
        limit: Number(limit),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
          hasMore: Number(page) < Math.ceil(total / Number(limit))
        }
      });
    } catch (error) {
      // console.error('Error fetching users:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // Get user statistics summary — admin only
  app.get("/api/users/stats", requireAdmin, async (req, res) => {
    try {
      // logger.log(' Fetching user statistics...');
      
      const totalUsers = await User.countDocuments();
      const activeUsers = await User.countDocuments({ status: 'active' });
      const adminUsers = await User.countDocuments({ role: 'admin' });
      const moderatorUsers = await User.countDocuments({ role: 'moderator' });
      const suspendedUsers = await User.countDocuments({ status: 'suspended' });
      
      // Get recent user registrations (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentRegistrations = await User.countDocuments({ 
        createdAt: { $gte: sevenDaysAgo } 
      });
      
      // Get top users by activity
      const topUsersByListening = await User.find()
        .sort({ totalListeningTime: -1 })
        .limit(5)
        .select('username fullName totalListeningTime favoriteStationsCount')
        .lean();

      const stats = {
        totalUsers,
        activeUsers,
        adminUsers,
        moderatorUsers,
        suspendedUsers,
        recentRegistrations,
        activePercentage: totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0,
        topUsersByListening: topUsersByListening.map((user: any) => ({
          username: user.username,
          fullName: user.fullName,
          listeningTime: user.totalListeningTime || 0,
          favoriteStations: user.favoriteStationsCount || 0
        }))
      };

      // logger.log(` User stats - ${totalUsers} total, ${activeUsers} active`);
      res.json(stats);
    } catch (error) {
      // console.error('Error fetching user stats:', error);
      res.status(500).json({ error: 'Failed to fetch user statistics' });
    }
  });

  // Get user activity/recent actions — admin only
  app.get("/api/users/activity", requireAdmin, async (req, res) => {
    try {
      // logger.log(' Fetching user activity...');
      
      const { limit = 10 } = req.query;
      
      // Get recent user logins
      const recentLogins = await User.find({ lastLoginAt: { $exists: true } })
        .sort({ lastLoginAt: -1 })
        .limit(Number(limit))
        .select('username fullName lastLoginAt')
        .lean();

      const activity = recentLogins.map((user: any) => ({
        _id: user._id,
        username: user.username,
        fullName: user.fullName,
        action: 'login',
        timestamp: user.lastLoginAt,
        details: 'User logged in'
      }));

      // logger.log(` Found ${activity.length} recent activities`);
      res.json(activity);
    } catch (error) {
      // console.error('Error fetching user activity:', error);
      res.status(500).json({ error: 'Failed to fetch user activity' });
    }
  });

  // Get single user details with enhanced stats — admin only
  // (public profile pages use a separate sanitized endpoint)
  app.get("/api/users/:userId", requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      // logger.log(` Fetching user details for ${userId}...`);
      
      const user = await User.findById(userId)
        .select('-passwordHash -emailVerificationToken -resetPasswordToken')
        .lean() as any;

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get enhanced statistics
      const Station = mongoose.model('Station');
      const favoriteStations = await Station.find({ 
        _id: { $in: user.favoriteStations || [] } 
      }).select('name country genre').lean();

      const createdStations = await Station.find({ 
        createdBy: userId 
      }).select('name country genre votes').lean();

      // Calculate listening statistics
      const totalListening = user.recentlyPlayedStations?.reduce((sum: number, play: any) => 
        sum + (play.playDuration || 0), 0) || 0;

      const userIdStr = (user._id as any).toString();
      const enhancedUser = {
        ...user,
        favoriteStationsCount: favoriteStations.length,
        stationsCreatedCount: createdStations.length,
        totalListeningTime: Math.round(totalListening / 60), // Convert to hours
        favoriteStations: favoriteStations,
        createdStations: createdStations,
        stats: {
          ...(user.stats || {}),
          totalPlays: user.recentlyPlayedStations?.length || 0,
          totalListeningHours: Math.round(totalListening / 3600),
          joinDate: user.createdAt,
          lastActiveDate: user.lastLoginAt || user.createdAt
        }
      };

      // logger.log(` User details loaded for ${user.username}`);
      res.json(enhancedUser);
    } catch (error) {
      // console.error('Error fetching user details:', error);
      res.status(500).json({ error: 'Failed to fetch user details' });
    }
  });

  // Update user information
  // Authorization: must be the owner OR an admin. Strict field allowlist; privileged fields (role, status)
  // are admin-only. Prevents mass-assignment IDOR.
  app.put("/api/users/:userId", requireAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const sessionUserId = (req.session as any)?.user?.userId || (req.session as any)?.userId;
      const isAdmin = !!(req.session as any)?.adminAuth;

      if (!isAdmin && sessionUserId !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const body = req.body || {};
      // User-editable fields
      const USER_FIELDS = ['fullName', 'username', 'email', 'avatar', 'location', 'isPublicProfile', 'preferences', 'bio'];
      // Admin-only fields
      const ADMIN_FIELDS = ['role', 'status', 'emailVerified'];

      const updates: any = {};
      for (const f of USER_FIELDS) {
        if (body[f] !== undefined) updates[f] = body[f];
      }
      if (isAdmin) {
        for (const f of ADMIN_FIELDS) {
          if (body[f] !== undefined) updates[f] = body[f];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No updatable fields provided' });
      }

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { ...updates, updatedAt: new Date() },
        { new: true, select: '-passwordHash -emailVerificationToken -resetPasswordToken -resetPasswordExpires' }
      ).lean();

      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json(updatedUser);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  // Legacy follow/unfollow endpoints — DEPRECATED, return 410 Gone
  app.post("/api/users/:userId/follow-OLD", (_req, res) => {
    res.status(410).json({ error: 'Deprecated. Use POST /api/user/follow/:userId with Bearer auth.' });
  });
  app.delete("/api/users/:userId/follow", (_req, res) => {
    res.status(410).json({ error: 'Deprecated. Use DELETE /api/user/unfollow/:userId with Bearer auth.' });
  });

  // AUTHENTICATION API ENDPOINTS
  
  // Social Authentication Routes
  // Get user's social connections (followers and following)
  // Requires authentication to avoid enumeration via email
  app.get("/api/user/social/:email", requireAuth, async (req, res) => {
    try {
      const { email } = req.params;
      
      const { CacheKeys, CacheManager } = deps;
      const cacheKey = CacheKeys.userSocial(email);
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const [followersCount, followingCount, followers, following] = await Promise.all([
        UserFollow.countDocuments({ followingUserId: (user._id as any) }),
        UserFollow.countDocuments({ userId: (user._id as any) }),
        UserFollow.find({ followingUserId: (user._id as any) })
          .populate('userId', 'username email fullName avatarUrl')
          .lean(),
        UserFollow.find({ userId: (user._id as any) })
          .populate('followingUserId', 'username email fullName avatarUrl')
          .lean()
      ]);
      
      const result = {
        followersCount,
        followingCount,
        followers: followers.map((f: any) => f.userId),
        following: following.map((f: any) => f.followingUserId)
      };

      await CacheManager.set(cacheKey, result, { ttl: 120 });

      res.json(result);
    } catch (error) {
      console.error('❌ Error fetching user social data:', error);
      res.status(500).json({ error: 'Failed to fetch social data' });
    }
  });

  // Check social authentication status
  app.get("/api/auth/social-status", (req, res) => {
    const { getSocialAuthStatus } = deps;
    const status = getSocialAuthStatus();
    res.json(status);
  });

  // Debug endpoint to show current callback URL for OAuth setup
  app.get("/api/auth/debug/callback-url", (req, res) => {
    let baseUrl = 'http://localhost:3000';
    
    if (process.env.REPLIT_DOMAINS) {
      const domains = process.env.REPLIT_DOMAINS.split(',');
      // Look for production domain (themegaradio.com only)
      const productionDomain = domains.find(domain => 
        domain.includes('themegaradio.com')
      );
      if (productionDomain) {
        baseUrl = `https://${productionDomain}`;
      } else {
        // Look for deployed domain (.replit.app)
        const deployedDomain = domains.find(domain => domain.includes('.replit.app'));
        if (deployedDomain) {
          baseUrl = `https://${deployedDomain}`;
        } else {
          // Fallback to first domain (dev domain)  
          baseUrl = `https://${domains[0]}`;
        }
      }
    }
    
    const callbackUrl = `${baseUrl}/api/auth/google/callback`;
    
    res.json({
      message: 'Add this exact URL to your Google Cloud Console OAuth app as an authorized redirect URI',
      callbackUrl,
      currentDomain: baseUrl,
      allDomains: process.env.REPLIT_DOMAINS?.split(',') || [],
      instructions: [
        '1. Go to https://console.cloud.google.com/',
        '2. Select your project',
        '3. Go to: APIs & Services → Credentials', 
        '4. Click on your OAuth 2.0 client ID',
        '5. Add the callbackUrl above to "Authorized redirect URIs"',
        '6. Save changes'
      ]
    });
  });

  // CRITICAL: Force Cloudflare to bypass cache and WAF security checks for all auth routes.
  // Without this, Cloudflare caches OAuth redirects (with state params) causing 502 errors
  // on subsequent login attempts, and WAF may flag OAuth code params as attacks.
  app.use('/api/auth', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
    next();
  });

  // Social authentication routes with passport integration
  app.get("/api/auth/google", async (req, res, next) => {
    const { getSocialAuthStatus } = deps;
    const status = getSocialAuthStatus();
    if (!status.google) {
      return res.status(501).json({ 
        error: 'Google authentication not configured', 
        message: 'Social login with Google requires API keys to be configured.' 
      });
    }
    
    // Save returnTo URL in session for post-login redirect
    const returnTo = req.query.returnTo as string;
    if (returnTo && req.session) {
      (req.session as any).oauthReturnTo = returnTo;
      logger.log('🔀 Saved OAuth returnTo:', returnTo);
    }
    
    // Save current language/country code in session for OAuth return
    const referer = req.headers.referer || '';
    const urlMatch = referer.match(/\/([a-z]{2})(?:\/|$)/i);
    if (urlMatch && req.session) {
      (req.session as any).oauthReturnLang = urlMatch[1].toLowerCase();
      logger.log('🌍 Saved OAuth return language:', urlMatch[1].toLowerCase());
    }
    
    // Use passport Google authentication
    try {
      passport.authenticate('google', { 
        scope: ['profile', 'email']
      })(req, res, next);
    } catch (error) {
      console.error('Passport auth error:', error);
      res.status(500).json({ error: 'Authentication setup error' });
    }
  });

  app.get("/api/auth/facebook", (req, res) => {
    const { getSocialAuthStatus } = deps;
    const status = getSocialAuthStatus();
    if (!status.facebook) {
      return res.status(501).json({ 
        error: 'Facebook authentication not configured', 
        message: 'Social login with Facebook requires API keys to be configured.' 
      });
    }
    // TODO: Implement Facebook OAuth when credentials are provided
    res.status(501).json({ 
      error: 'Facebook authentication not implemented', 
      message: 'Facebook OAuth flow will be implemented when Facebook credentials are provided.' 
    });
  });

  app.get("/api/auth/apple", async (req, res) => {
    const { getSocialAuthStatus } = deps;
    const status = getSocialAuthStatus();
    if (!status.apple) {
      return res.status(501).json({ 
        error: 'Apple authentication not configured', 
        message: 'Social login with Apple requires API keys to be configured.' 
      });
    }
    
    const returnTo = req.query.returnTo as string;
    if (returnTo && req.session) {
      (req.session as any).oauthReturnTo = returnTo;
    }
    
    const referer = req.headers.referer || '';
    const urlMatch = referer.match(/\/([a-z]{2})(?:\/|$)/i);
    if (urlMatch && req.session) {
      (req.session as any).oauthReturnLang = urlMatch[1].toLowerCase();
    }

    const clientId = process.env.APPLE_SERVICE_ID || process.env.APPLE_CLIENT_ID || '';
    const frontendUrl = process.env.FRONTEND_URL || 'https://themegaradio.com';
    const redirectUri = process.env.APPLE_CALLBACK_URL || `${frontendUrl}/api/auth/apple/callback`;
    
    const crypto = await import('crypto');
    const state = crypto.randomBytes(16).toString('hex');
    if (req.session) {
      (req.session as any).appleOAuthState = state;
    }
    
    await new Promise<void>((resolve, reject) => {
      req.session.save((err: any) => err ? reject(err) : resolve());
    });
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code id_token',
      response_mode: 'form_post',
      scope: 'name email',
      state: state
    });
    
    const appleAuthUrl = `https://appleid.apple.com/auth/authorize?${params.toString()}`;
    logger.log('🍎 Apple OAuth redirect to:', appleAuthUrl);
    res.redirect(appleAuthUrl);
  });

  app.get("/api/auth/google/callback", (req, res, next) => {
    const savedLang = (req.session as any)?.oauthReturnLang || '';
    const langPrefix = savedLang ? `/${savedLang}` : '';
    const frontendBase = process.env.FRONTEND_URL || '';
    
    passport.authenticate('google', { 
      failureRedirect: `${frontendBase}${langPrefix}/?error=google_auth_failed` 
    }, async (err: any, user: any, info: any) => {
      if (err) {
        logger.error('Google OAuth callback error:', err);
        return res.redirect(`${frontendBase}${langPrefix}/?error=google_auth_failed`);
      }
      if (!user) {
        return res.redirect(`${frontendBase}${langPrefix}/?error=google_auth_cancelled`);
      }
      
      try {
        const token = await generateAuthToken(user._id.toString(), 'web');
        logger.log('✅ Google OAuth token generated for:', user.email);
        
        const returnTo = (req.session as any)?.oauthReturnTo;
        delete (req.session as any).oauthReturnTo;
        delete (req.session as any).oauthReturnLang;
        
        if (returnTo && returnTo.startsWith('/')) {
          return res.redirect(`${frontendBase}${returnTo}?auth_token=${token}`);
        }
        res.redirect(`${frontendBase}${langPrefix}/?auth_token=${token}`);
      } catch (tokenErr) {
        logger.error('Google OAuth token generation error:', tokenErr);
        
        req.login(user, (loginErr: any) => {
          if (loginErr) {
            return res.redirect(`${frontendBase}${langPrefix}/?error=login_failed`);
          }
          (req.session as any).user = {
            userId: user._id.toString(),
            email: user.email,
            role: user.role
          };
          req.session.save(() => {
            res.redirect(`${frontendBase}${langPrefix}/?success=google_login`);
          });
        });
      }
    })(req, res, next);
  });

  app.get("/api/auth/facebook/callback", async (req, res) => {
    try {
      res.redirect('/?error=facebook_auth_not_implemented');
    } catch (error) {
      console.error('Facebook OAuth callback error:', error);
      res.redirect('/?error=facebook_auth_failed');
    }
  });

  app.post("/api/auth/apple/callback", async (req, res) => {
    const frontendBase = process.env.FRONTEND_URL || '';
    const savedLang = (req.session as any)?.oauthReturnLang || '';
    const langPrefix = savedLang ? `/${savedLang}` : '';
    
    try {
      const { code, id_token, state, user: userDataStr } = req.body;
      
      if (!code && !id_token) {
        logger.error('🍎 Apple callback: No code or id_token received');
        return res.redirect(`${frontendBase}${langPrefix}/?error=apple_auth_failed`);
      }
      
      const savedState = (req.session as any)?.appleOAuthState;
      delete (req.session as any).appleOAuthState;
      if (!state || !savedState || state !== savedState) {
        logger.error('🍎 Apple OAuth state mismatch or missing', { state: !!state, savedState: !!savedState });
        return res.redirect(`${frontendBase}${langPrefix}/?error=apple_auth_failed`);
      }
      
      const jose = await import('jose');
      let applePayload: any;
      
      if (id_token) {
        try {
          const JWKS = jose.createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
          const clientId = process.env.APPLE_SERVICE_ID || process.env.APPLE_CLIENT_ID || '';
          const { payload } = await jose.jwtVerify(id_token, JWKS, {
            issuer: 'https://appleid.apple.com',
            audience: clientId,
          });
          applePayload = payload;
        } catch (verifyErr) {
          logger.error('🍎 Apple id_token verification failed:', verifyErr);
          return res.redirect(`${frontendBase}${langPrefix}/?error=apple_auth_failed`);
        }
      } else if (code) {
        try {
          const clientSecret = await generateAppleClientSecret();
          const clientId = process.env.APPLE_SERVICE_ID || process.env.APPLE_CLIENT_ID || '';
          const redirectUri = process.env.APPLE_CALLBACK_URL || `${frontendBase}/api/auth/apple/callback`;
          
          const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              code: code,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
            }).toString(),
          });
          
          if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            logger.error('🍎 Apple token exchange failed:', errorText);
            return res.redirect(`${frontendBase}${langPrefix}/?error=apple_auth_failed`);
          }
          
          const tokenData = await tokenResponse.json() as any;
          const JWKS = jose.createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
          const { payload } = await jose.jwtVerify(tokenData.id_token, JWKS, {
            issuer: 'https://appleid.apple.com',
            audience: clientId,
          });
          applePayload = payload;
        } catch (tokenErr) {
          logger.error('🍎 Apple token exchange error:', tokenErr);
          return res.redirect(`${frontendBase}${langPrefix}/?error=apple_auth_failed`);
        }
      }
      
      if (!applePayload || !applePayload.sub) {
        return res.redirect(`${frontendBase}${langPrefix}/?error=apple_auth_failed`);
      }
      
      const appleId = applePayload.sub;
      const appleEmail = applePayload.email;
      let appleFullName: string | undefined;
      
      if (userDataStr) {
        try {
          const userData = typeof userDataStr === 'string' ? JSON.parse(userDataStr) : userDataStr;
          if (userData.name) {
            appleFullName = [userData.name.firstName, userData.name.lastName].filter(Boolean).join(' ');
          }
        } catch (e) {}
      }
      
      logger.log('🍎 Apple OAuth callback for:', appleId, appleEmail);
      
      let user = await User.findOne({ appleId: appleId });
      
      if (user) {
        user.lastLoginAt = new Date();
        if (appleFullName && !user.fullName) {
          user.fullName = appleFullName;
        }
        await user.save();
      } else {
        if (appleEmail) {
          user = await User.findOne({ email: appleEmail });
        }
        
        if (user) {
          (user as any).appleId = appleId;
          user.lastLoginAt = new Date();
          if (appleFullName && !user.fullName) {
            user.fullName = appleFullName;
          }
          await user.save();
        } else {
          const generateSlug = (name: string, emailStr: string): string => {
            let slugSource = name || emailStr?.split('@')[0] || 'apple-user';
            return slugSource.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim().replace(/^-+|-+$/g, '');
          };
          
          const baseSlug = generateSlug(appleFullName || '', appleEmail || '');
          let userSlug = baseSlug || 'apple-user';
          let counter = 1;
          while (await User.findOne({ slug: userSlug })) {
            userSlug = `${baseSlug || 'apple-user'}-${counter}`;
            counter++;
          }
          
          const newUser = new User({
            appleId: appleId,
            email: appleEmail || undefined,
            fullName: appleFullName || undefined,
            username: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            slug: userSlug,
            passwordHash: '',
            emailVerified: true,
            lastLoginAt: new Date()
          });
          
          await newUser.save();
          user = newUser;
          logger.log(`✅ New Apple user created: "${userSlug}" (${appleEmail || 'no email'})`);
        }
      }
      
      try {
        const token = await generateAuthToken((user as any)._id.toString(), 'web');
        logger.log('✅ Apple OAuth token generated for:', (user as any).email);
        
        const returnTo = (req.session as any)?.oauthReturnTo;
        delete (req.session as any).oauthReturnTo;
        delete (req.session as any).oauthReturnLang;
        
        if (returnTo && returnTo.startsWith('/')) {
          return res.redirect(`${frontendBase}${returnTo}?auth_token=${token}`);
        }
        res.redirect(`${frontendBase}${langPrefix}/?auth_token=${token}`);
      } catch (tokenErr) {
        logger.error('🍎 Apple OAuth token generation error:', tokenErr);
        res.redirect(`${frontendBase}${langPrefix}/?error=apple_auth_failed`);
      }
    } catch (error) {
      logger.error('🍎 Apple OAuth callback error:', error);
      res.redirect(`${frontendBase}${langPrefix}/?error=apple_auth_failed`);
    }
  });

  // MOBILE AUTH: Google Sign-In with idToken (POST - for mobile apps)
  app.post("/api/auth/google", async (req, res) => {
    try {
      const { idToken, email, name, googleId, platform = 'mobile' } = req.body;

      if (!idToken) {
        return res.status(400).json({ success: false, error: 'idToken is required' });
      }

      const { OAuth2Client } = await import('google-auth-library');
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

      const GOOGLE_AUDIENCES = [
        process.env.GOOGLE_CLIENT_ID,
        '246210957471-18662dh38h9tmlk7nppdk15ucbha4emk.apps.googleusercontent.com',
        '246210957471-4dmnb95bcduaocr8toiphv3guq9a8htl.apps.googleusercontent.com',
        '957628580421-1gj9mmbq20o9jva6olb28t2un6vb6jqh.apps.googleusercontent.com',
      ].filter(Boolean) as string[];

      let payload: any;
      try {
        const ticket = await client.verifyIdToken({
          idToken,
          audience: GOOGLE_AUDIENCES,
        });
        payload = ticket.getPayload();
      } catch (verifyErr) {
        logger.error('Google idToken verification failed:', verifyErr);
        return res.status(401).json({ success: false, error: 'Invalid or expired Google token' });
      }

      if (!payload || !payload.sub) {
        return res.status(401).json({ success: false, error: 'Invalid token payload' });
      }

      const verifiedGoogleId = payload.sub;
      const verifiedEmail = payload.email;
      const verifiedName = payload.name || name;
      const avatar = payload.picture;

      if (!verifiedEmail) {
        return res.status(400).json({ success: false, error: 'Google account does not have a verified email' });
      }

      let user = await User.findOne({ googleId: verifiedGoogleId });

      if (user) {
        if (user.status !== 'active') {
          return res.status(403).json({ success: false, error: 'Account is suspended or inactive' });
        }
        user.lastLoginAt = new Date();
        if (avatar && !user.avatar) {
          (user as any).avatar = avatar;
        }
        await user.save();
      } else {
        user = await User.findOne({ email: verifiedEmail });

        if (user) {
          if (user.status !== 'active') {
            return res.status(403).json({ success: false, error: 'Account is suspended or inactive' });
          }
          user.googleId = verifiedGoogleId;
          user.lastLoginAt = new Date();
          if (avatar && !(user as any).avatar) {
            (user as any).avatar = avatar;
          }
          if (!user.fullName && verifiedName) {
            user.fullName = verifiedName;
          }
          await user.save();
        } else {
          const generateSlug = (displayName: string, emailStr: string): string => {
            let slugSource = displayName || emailStr.split('@')[0];
            return slugSource.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim().replace(/^-+|-+$/g, '');
          };

          const baseSlug = generateSlug(verifiedName || '', verifiedEmail);
          let userSlug = baseSlug;
          let counter = 1;
          while (await User.findOne({ slug: userSlug })) {
            userSlug = `${baseSlug}-${counter}`;
            counter++;
          }

          user = new User({
            googleId: verifiedGoogleId,
            email: verifiedEmail,
            fullName: verifiedName || verifiedEmail.split('@')[0],
            avatar,
            username: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            slug: userSlug,
            passwordHash: '',
            emailVerified: true,
            lastLoginAt: new Date()
          });
          await user.save();
          logger.log(`✅ New Google mobile user created: "${userSlug}" (${verifiedEmail})`);
        }
      }

      const deviceType = platform === 'tv' ? 'tv' : 'mobile';
      const token = await generateAuthToken(user._id.toString(), deviceType);

      res.json({
        success: true,
        token,
        expiresIn: '90 days',
        user: {
          _id: user._id,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          role: user.role,
          avatar: (user as any).avatar,
        }
      });
    } catch (error) {
      logger.error('Mobile Google auth error:', error);
      res.status(500).json({ success: false, error: 'Authentication failed' });
    }
  });

  // MOBILE AUTH: Apple Sign-In with identityToken (POST - for mobile apps)
  app.post("/api/auth/apple", async (req, res) => {
    try {
      const { identityToken, authorizationCode, fullName, email, user: appleUserId, platform = 'mobile' } = req.body;

      if (!identityToken) {
        return res.status(400).json({ success: false, error: 'identityToken is required' });
      }

      const jose = await import('jose');

      let applePayload: any;
      try {
        const JWKS = jose.createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
        const { payload } = await jose.jwtVerify(identityToken, JWKS, {
          issuer: 'https://appleid.apple.com',
          audience: process.env.APPLE_CLIENT_ID || process.env.APPLE_SERVICE_ID || 'com.visiongo.megaradio',
        });
        applePayload = payload;
      } catch (verifyErr) {
        logger.error('Apple identityToken verification failed:', verifyErr);
        return res.status(401).json({ success: false, error: 'Invalid or expired Apple token' });
      }

      if (!applePayload || !applePayload.sub) {
        return res.status(401).json({ success: false, error: 'Invalid token payload' });
      }

      const verifiedAppleId = applePayload.sub;
      const verifiedEmail = applePayload.email;
      const displayName = fullName
        ? [fullName.givenName, fullName.familyName].filter(Boolean).join(' ')
        : undefined;

      let user = await User.findOne({ appleId: verifiedAppleId });

      if (user) {
        if (user.status !== 'active') {
          return res.status(403).json({ success: false, error: 'Account is suspended or inactive' });
        }
        user.lastLoginAt = new Date();
        if (displayName && !user.fullName) {
          user.fullName = displayName;
        }
        await user.save();
      } else {
        user = verifiedEmail ? await User.findOne({ email: verifiedEmail }) : null;

        if (user) {
          if (user.status !== 'active') {
            return res.status(403).json({ success: false, error: 'Account is suspended or inactive' });
          }
          (user as any).appleId = verifiedAppleId;
          user.lastLoginAt = new Date();
          if (displayName && !user.fullName) {
            user.fullName = displayName;
          }
          await user.save();
        } else {
          const generateSlug = (name: string, emailStr: string): string => {
            let slugSource = name || emailStr?.split('@')[0] || 'apple-user';
            return slugSource.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim().replace(/^-+|-+$/g, '');
          };

          const baseSlug = generateSlug(displayName || '', verifiedEmail || '');
          let userSlug = baseSlug || 'apple-user';
          let counter = 1;
          while (await User.findOne({ slug: userSlug })) {
            userSlug = `${baseSlug || 'apple-user'}-${counter}`;
            counter++;
          }

          user = new User({
            appleId: verifiedAppleId,
            email: verifiedEmail || undefined,
            fullName: displayName || 'Apple User',
            username: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            slug: userSlug,
            passwordHash: '',
            emailVerified: !!verifiedEmail,
            lastLoginAt: new Date()
          });
          await user.save();
          logger.log(`✅ New Apple mobile user created: "${userSlug}" (${verifiedEmail || 'no-email'})`);
        }
      }

      const deviceType = platform === 'tv' ? 'tv' : 'mobile';
      const token = await generateAuthToken(user._id.toString(), deviceType);

      res.json({
        success: true,
        token,
        expiresIn: '90 days',
        user: {
          _id: user._id,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          role: user.role,
          avatar: (user as any).avatar,
        }
      });
    } catch (error) {
      logger.error('Mobile Apple auth error:', error);
      res.status(500).json({ success: false, error: 'Authentication failed' });
    }
  });

  // MOBILE AUTH: Login with token response
  app.post("/api/auth/mobile/login", async (req, res) => {
    try {
      const { email, password, deviceType = 'mobile', deviceName } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const bcrypt = await import('bcrypt');
      const isValid = await bcrypt.default.compare(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (user.status !== 'active') {
        return res.status(403).json({ error: 'Account is suspended or inactive' });
      }

      // Update last login
      user.lastLoginAt = new Date();
      await user.save();

      const token = await generateAuthToken(user._id.toString(), deviceType, deviceName);

      res.json({
        success: true,
        token,
        expiresIn: '90 days',
        user: {
          _id: user._id,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
        }
      });
    } catch (error) {
      console.error('Mobile login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // User Signup
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { fullName, username, email, password } = req.body;

      if (!fullName || !username || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
      }
      if (username.length < 3 || username.length > 30) {
        return res.status(400).json({ error: 'Username must be 3-30 characters long' });
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
        return res.status(400).json({ error: 'Username may only contain letters, numbers, underscores, dots, and hyphens' });
      }

      // Check if user exists
      const existingUser = await User.findOne({ $or: [{ email: email.toLowerCase().trim() }, { username }] });
      if (existingUser) {
        return res.status(400).json({ error: 'User with this email or username already exists' });
      }

      // Hash password
      const bcrypt = await import('bcrypt');
      const saltRounds = 12;
      const passwordHash = await bcrypt.default.hash(password, saltRounds);

      // Create user slug
      const userSlug = username.toLowerCase().replace(/[^a-z0-9]/g, '-');

      const normalizedEmail = email.toLowerCase().trim();

      // Create new user
      const newUser = new User({
        fullName: fullName.trim(),
        username,
        email: normalizedEmail,
        passwordHash,
        slug: userSlug,
        role: 'user',
        status: 'active',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        stats: {
          totalPlays: 0,
          totalListeningHours: 0,
          favoriteStationsCount: 0,
          favoriteGenres: [],
          joinDate: new Date(),
          lastActiveDate: new Date(),
          streakDays: 0
        }
      } as any);

      await newUser.save();
      logger.log(`✅ User created with slug: "${userSlug}" (${email})`);

      // Return user data (without sensitive fields)
      const userData = {
        _id: newUser._id,
        fullName: newUser.fullName,
        username: newUser.username,
        email: newUser.email,
        emailVerified: newUser.emailVerified,
        role: newUser.role,
        status: newUser.status,
        createdAt: newUser.createdAt
      };

      res.status(201).json({ 
        message: 'Account created successfully', 
        user: userData,
        emailVerificationRequired: true
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });

  // User login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password, rememberMe } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      // Find user by email
      const user = await User.findOne({ email: email.toLowerCase().trim() });
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Check password
      const bcrypt = await import('bcrypt');
      const isValidPassword = await bcrypt.default.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Check if account is active
      if (user.status !== 'active') {
        return res.status(403).json({ error: 'Account is suspended or inactive' });
      }

      // Update last login
      user.lastLoginAt = new Date();
      if (!user.stats) user.stats = {} as any;
      user.stats.lastActiveDate = new Date();
      await user.save();

      const userData = {
        _id: user._id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        location: user.location,
        isPublicProfile: user.isPublicProfile,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        favoriteStationsCount: user.favoriteStationsCount,
        totalListeningTime: user.totalListeningTime,
        lastLoginAt: user.lastLoginAt
      };

      // Use Passport's req.login()
      req.login(user, async (err) => {
        if (err) {
          console.error('Session login error:', err);
          return res.status(500).json({ error: 'Failed to create session' });
        }
        
        // Custom session data
        (req.session as any).user = {
          userId: user._id.toString(),
          email: user.email,
          role: user.role,
          rememberMe
        };

        const deviceType = req.body.deviceType || (req.headers['x-device-type'] as string) || 'web';
        const deviceName = req.body.deviceName || req.headers['x-device-name'] as string;

        if (deviceType === 'mobile' || deviceType === 'tv') {
          const authToken = await generateAuthToken(user._id.toString(), deviceType, deviceName);
          res.json({ 
            message: 'Login successful', 
            user: userData,
            authenticated: true,
            token: authToken,
            tokenExpiresIn: '90 days'
          });
        } else {
          res.json({ 
            message: 'Login successful', 
            user: userData,
            authenticated: true
          });
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to login' });
    }
  });

  app.post("/api/auth/token-session", async (req, res) => {
    try {
      const { token } = req.body;
      // CRITICAL: type guard before Mongoose query. Without this, an attacker
      // can send `{"token":{"$ne":null}}` and match any non-revoked token,
      // turning this into an account takeover. We also bound the length to
      // avoid DoS via huge keys.
      if (typeof token !== 'string' || token.length < 16 || token.length > 512) {
        return res.status(400).json({ success: false, error: 'Token is required' });
      }

      const authToken = await AuthToken.findOne({ token, isRevoked: false });
      if (!authToken) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
      }
      
      if (authToken.expiresAt && new Date(authToken.expiresAt) < new Date()) {
        authToken.isRevoked = true;
        await authToken.save();
        return res.status(401).json({ success: false, error: 'Token expired' });
      }
      
      const user = await User.findById(authToken.userId);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      
      (req.session as any).user = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role
      };
      
      req.session.save((err: any) => {
        if (err) {
          logger.error('Token-session save error:', err);
          return res.status(500).json({ success: false, error: 'Session save failed' });
        }
        logger.log('✅ Token-session created for:', user.email);
        res.json({ success: true, authenticated: true });
      });
    } catch (error) {
      logger.error('Token-session error:', error);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  });

  // Get current user (check authentication)
  app.get("/api/auth/me", async (req, res) => {
    try {
      if (!req.session?.user?.userId && !(req as any).user) {
        return res.json({ user: null, authenticated: false });
      }

      const userId = req.session?.user?.userId || (req as any).user?._id;

      const [user, followingList, actualFollowersCount] = await Promise.all([
        User.findById(userId)
          .select('fullName username email emailVerified role status avatar location isPublicProfile preferences followersCount followingCount favoriteStationsCount totalListeningTime lastLoginAt createdAt')
          .lean() as any,
        UserFollow.find({ userId })
          .select('followingUserId')
          .lean(),
        UserFollow.countDocuments({ followingUserId: userId })
      ]);

      if (!user) {
        if (req.session) {
          req.session.user = undefined;
        }
        return res.json({ user: null, authenticated: false });
      }

      const following = followingList.map((f: any) => f.followingUserId.toString());
      const actualFollowingCount = following.length;
      
      if (user.followersCount !== actualFollowersCount || user.followingCount !== actualFollowingCount) {
        User.findByIdAndUpdate(user._id, {
          followersCount: actualFollowersCount,
          followingCount: actualFollowingCount
        }).catch(() => {});
      }

      const userData = {
        _id: user._id,
        id: user._id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        location: user.location,
        isPublicProfile: user.isPublicProfile,
        preferences: user.preferences,
        followersCount: actualFollowersCount,
        followingCount: actualFollowingCount,
        favoriteStationsCount: user.favoriteStationsCount,
        totalListeningTime: user.totalListeningTime,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        following: following
      };

      res.json({ user: userData, authenticated: true });
    } catch (error) {
      res.json({ user: null, authenticated: false });
    }
  });

  // User logout
  app.post("/api/auth/logout", async (req, res) => {
    try {
      if (req.session) {
        req.session.destroy((err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to logout' });
          }
          res.clearCookie('connect.sid');
          res.json({ message: 'Logout successful', authenticated: false });
        });
      } else {
        res.json({ message: 'Logout successful', authenticated: false });
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to logout' });
    }
  });

  // Update user profile
  app.put("/api/auth/profile", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const { fullName, email, location, preferences, password } = req.body;
      
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (fullName !== undefined) user.fullName = fullName;
      if (email !== undefined) user.email = email;
      if (location !== undefined) user.location = location;
      if (req.body.isPublicProfile !== undefined) user.isPublicProfile = req.body.isPublicProfile;
      
      if (preferences) {
        user.preferences = { ...user.preferences, ...preferences };
      }

      if (password && password.trim() !== '') {
        const bcrypt = await import('bcrypt');
        const saltRounds = 12;
        user.passwordHash = await bcrypt.default.hash(password, saltRounds);
      }

      user.updatedAt = new Date();
      await user.save();

      const userData = {
        _id: user._id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        location: user.location,
        isPublicProfile: user.isPublicProfile,
        preferences: user.preferences,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        favoriteStationsCount: user.favoriteStationsCount,
        totalListeningTime: user.totalListeningTime,
        lastLoginAt: user.lastLoginAt
      };

      res.json({ 
        message: 'Profile updated successfully', 
        user: userData
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  // Forgot password
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      logger.log(`🔑 Password reset request for: ${email}`);

      const user = await User.findOne({ email });
      if (!user) {
        return res.json({ message: 'If an account exists with this email, you will receive reset instructions.' });
      }

      const crypto = await import('crypto');
      const resetToken = crypto.default.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.default.createHash('sha256').update(resetToken).digest('hex');
      const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

      // Store only the hash in DB — original token goes out via email only
      user.resetPasswordToken = resetTokenHash;
      (user as any).resetPasswordExpires = resetTokenExpiry;
      await user.save();

      const sgMail = (await import('@sendgrid/mail')).default;
      sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

      const resetUrl = `https://themegaradio.com/reset-password?token=${resetToken}`;
      
      const msg = {
        to: email,
        from: 'noreply@themegaradio.com',
        subject: 'Reset Your Password - Mega Radio',
        html: `
          <div style="font-family: 'Ubuntu', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0E0E0E; color: white;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #FF4199; margin: 0;">Mega Radio</h1>
            </div>
            <div style="background-color: #1a1a1a; padding: 30px; border-radius: 10px;">
              <h2 style="color: white; margin-top: 0;">Reset Your Password</h2>
              <p style="color: #ccc; line-height: 1.6;">Click the button below to reset your password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background-color: #FF4199; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block;">Reset Password</a>
              </div>
              <p style="color: #888; font-size: 14px;">This link expires in 1 hour.</p>
            </div>
          </div>
        `,
      };

      await sgMail.send(msg);
      res.json({ message: 'If an account exists with this email, you will receive reset instructions.' });
    } catch (error) {
      res.json({ message: 'If an account exists with this email, you will receive reset instructions.' });
    }
  });

  // Reset password with token
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Invalid password' });
      }

      const crypto = await import('crypto');
      const tokenHash = crypto.default.createHash('sha256').update(String(token)).digest('hex');

      const user = await User.findOne({
        resetPasswordToken: tokenHash,
        resetPasswordExpires: { $gt: new Date() }
      });

      if (!user) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }

      const bcrypt = await import('bcrypt');
      user.passwordHash = await bcrypt.default.hash(newPassword, 12);
      user.resetPasswordToken = undefined;
      (user as any).resetPasswordExpires = undefined;
      await user.save();

      res.json({ message: 'Password has been reset successfully.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  // User Following System
  app.post("/api/user/follow/:userId", requireAuth, async (req, res) => {
    try {
      const followingUserId = req.params.userId;
      const currentUserId = (req.session as any).userId;

      if (!mongoose.Types.ObjectId.isValid(followingUserId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      if (followingUserId === currentUserId) {
        return res.status(400).json({ error: "You cannot follow yourself" });
      }

      const userToFollow = await User.findById(followingUserId);
      if (!userToFollow) {
        return res.status(404).json({ error: "User not found" });
      }

      const existingFollow = await UserFollow.findOne({
        userId: currentUserId,
        followingUserId: followingUserId
      });

      if (existingFollow) {
        return res.status(400).json({ error: "Already following this user" });
      }

      await UserFollow.create({
        userId: currentUserId,
        followingUserId: followingUserId
      });

      await User.findByIdAndUpdate(currentUserId, { $inc: { followingCount: 1 } });
      await User.findByIdAndUpdate(followingUserId, { $inc: { followersCount: 1 } });

      const UserNotification = mongoose.model('UserNotification');
      const currentUser = await User.findById(currentUserId) as any;
      await UserNotification.create({
        userId: followingUserId,
        fromUserId: currentUserId,
        type: 'follow',
        title: 'New Follower',
        message: `${currentUser?.fullName || currentUser?.username || 'Someone'} started following you`,
        data: { followerId: currentUserId }
      });

      const { invalidateSocialCacheForUser } = deps;
      await Promise.all([
        invalidateSocialCacheForUser(currentUserId, currentUser?.email),
        invalidateSocialCacheForUser(followingUserId, (userToFollow as any)?.email)
      ]);

      res.json({ success: true, message: "User followed successfully" });
    } catch (error: any) {
      logger.error('Follow error:', error?.message || error);
      res.status(500).json({ error: 'Failed to follow user' });
    }
  });

  app.delete("/api/user/unfollow/:userId", requireAuth, async (req, res) => {
    try {
      const followingUserId = req.params.userId;
      const currentUserId = (req.session as any).userId;

      if (!mongoose.Types.ObjectId.isValid(followingUserId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      const deleted = await UserFollow.findOneAndDelete({
        userId: currentUserId,
        followingUserId: followingUserId
      });

      if (!deleted) {
        return res.status(400).json({ error: "Not following this user" });
      }

      await User.findByIdAndUpdate(currentUserId, { $inc: { followingCount: -1 } });
      await User.findByIdAndUpdate(followingUserId, { $inc: { followersCount: -1 } });

      const UserNotification = mongoose.model('UserNotification');
      const currentUser = await User.findById(currentUserId) as any;
      await UserNotification.create({
        userId: followingUserId,
        fromUserId: currentUserId,
        type: 'unfollow',
        title: 'User Unfollowed',
        message: `${currentUser?.fullName || currentUser?.username || 'Someone'} unfollowed you`,
        data: { followerId: currentUserId }
      });

      const { invalidateSocialCacheForUser } = deps;
      const unfollowedUser = await User.findById(followingUserId).select('email').lean() as any;
      await Promise.all([
        invalidateSocialCacheForUser(currentUserId, currentUser?.email),
        invalidateSocialCacheForUser(followingUserId, unfollowedUser?.email)
      ]);

      res.json({ success: true, message: "User unfollowed successfully" });
    } catch (error: any) {
      logger.error('Unfollow error:', error?.message || error);
      res.status(500).json({ error: 'Failed to unfollow user' });
    }
  });

  app.get("/api/user/is-following/:userId", requireAuth, async (req, res) => {
    try {
      const targetUserId = req.params.userId;
      const currentUserId = (req.session as any).userId;

      if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      const follow = await UserFollow.findOne({
        userId: currentUserId,
        followingUserId: targetUserId
      }).lean();

      res.json({ isFollowing: !!follow });
    } catch (error) {
      res.status(500).json({ error: 'Failed to check follow status' });
    }
  });

  app.get("/api/user/followers/:userId", async (req, res) => {
    try {
      const userId = req.params.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const { CacheKeys, CacheManager } = deps;
      const cacheKey = CacheKeys.userFollowers(userId, page, limit);
      const cached = await CacheManager.get(cacheKey);
      if (cached) return res.json(cached);

      const [followers, total] = await Promise.all([
        UserFollow.find({ followingUserId: userId })
          .populate('userId', 'fullName username email avatar location followersCount followingCount')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        UserFollow.countDocuments({ followingUserId: userId })
      ]);

      const result = {
        followers: followers.map((f: any) => ({
          user: f.userId,
          followedAt: f.createdAt
        })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      };

      await CacheManager.set(cacheKey, result, { ttl: 120 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get followers' });
    }
  });

  app.get("/api/user/following/:userId", async (req, res) => {
    try {
      const userId = req.params.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const { CacheKeys, CacheManager } = deps;
      const cacheKey = CacheKeys.userFollowing(userId, page, limit);
      const cached = await CacheManager.get(cacheKey);
      if (cached) return res.json(cached);

      const [following, total] = await Promise.all([
        UserFollow.find({ userId: userId })
          .populate('followingUserId', 'fullName username email avatar location followersCount followingCount')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        UserFollow.countDocuments({ userId: userId })
      ]);

      const result = {
        following: following.map((f: any) => ({
          user: f.followingUserId,
          followedAt: f.createdAt
        })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      };

      await CacheManager.set(cacheKey, result, { ttl: 120 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get following' });
    }
  });

  // ============================================================
  // AVATAR UPLOAD & DELETE
  // ============================================================

  app.post("/api/user/avatar", requireAuth, async (req, res) => {
    try {
      const multer = (await import('multer')).default;
      const sharp = (await import('sharp')).default;
      const { uploadToS3, deleteFromS3 } = await import('../services/s3-storage');

      const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
          const allowed = ['image/jpeg', 'image/png', 'image/webp'];
          if (allowed.includes(file.mimetype)) cb(null, true);
          else cb(new Error('Invalid file type. Allowed: jpeg, png, webp'));
        }
      }).single('avatar');

      upload(req, res, async (uploadErr: any) => {
        if (uploadErr) {
          if (uploadErr.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large. Maximum size: 5MB' });
          }
          return res.status(400).json({ error: uploadErr.message || 'Upload failed' });
        }

        if (!req.file) {
          return res.status(400).json({ error: 'No avatar file provided' });
        }

        const userId = (req.session as any)?.user?.userId || (req as any).user?._id?.toString();
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        const metadata = await sharp(req.file.buffer).metadata();
        if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100) {
          return res.status(400).json({ error: 'Image too small. Minimum size: 100x100px' });
        }

        const webpBuffer = await sharp(req.file.buffer)
          .resize(400, 400, { fit: 'cover', position: 'centre' })
          .webp({ quality: 80 })
          .toBuffer();

        const shortId = userId.slice(-8);
        const s3Key = `avatars/user_${shortId}_${Date.now()}.webp`;
        const avatarUrl = await uploadToS3(s3Key, webpBuffer, 'image/webp');

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const oldAvatar = user.avatar;
        user.avatar = avatarUrl;
        user.updatedAt = new Date();
        await user.save();

        if (oldAvatar && oldAvatar.includes('.s3.') && oldAvatar.includes('/avatars/')) {
          try {
            const oldKey = oldAvatar.split('.amazonaws.com/')[1];
            if (oldKey) await deleteFromS3(oldKey);
          } catch {}
        }

        res.json({ success: true, avatar: avatarUrl });
      });
    } catch (error: any) {
      logger.log('Avatar upload error:', error.message);
      res.status(500).json({ error: 'Avatar upload failed' });
    }
  });

  app.delete("/api/user/avatar", requireAuth, async (req, res) => {
    try {
      const { deleteFromS3 } = await import('../services/s3-storage');

      const userId = (req.session as any)?.user?.userId || (req as any).user?._id?.toString();
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const oldAvatar = user.avatar;

      if (oldAvatar && oldAvatar.includes('.s3.') && oldAvatar.includes('/avatars/')) {
        try {
          const oldKey = oldAvatar.split('.amazonaws.com/')[1];
          if (oldKey) await deleteFromS3(oldKey);
        } catch {}
      }

      user.avatar = undefined;
      user.updatedAt = new Date();
      await user.save();

      res.json({ success: true, message: 'Avatar removed' });
    } catch (error: any) {
      logger.log('Avatar delete error:', error.message);
      res.status(500).json({ error: 'Avatar delete failed' });
    }
  });

  app.delete("/api/user/delete-account", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId || (req.session as any)?.user?.userId;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const userIdStr = userId.toString();
      const userObjectId = new mongoose.Types.ObjectId(userIdStr);

      const deleteResults = await Promise.allSettled([
        UserFavorite.deleteMany({ userId: userIdStr }),
        StationRating.deleteMany({ userId: userIdStr }),
        StationComment.deleteMany({ userId: userIdStr }),
        UserListeningHistory.deleteMany({ $or: [{ sessionId: userIdStr }, { userId: userIdStr }] }),
        UserProfile.deleteMany({ userId: userIdStr }),
        PublicUserProfile.deleteMany({ userId: userIdStr }),
        ListeningSession.deleteMany({ userId: userIdStr }),
        Recommendation.deleteMany({ userId: userIdStr }),
        UserMusicProfile.deleteMany({ userId: userIdStr }),
        UserFollow.deleteMany({ $or: [{ userId: userObjectId }, { followingUserId: userObjectId }] }),
        UserNotification.deleteMany({ userId: userIdStr }),
        Notification.deleteMany({ userId: userIdStr }),
        UserSession.deleteMany({ userId: userIdStr }),
        AuthToken.deleteMany({ userId: userObjectId }),
        PushToken.deleteMany({ userId: userIdStr }),
        UserDevice.deleteMany({ userId: userIdStr }),
        CastSession.deleteMany({ userId: userIdStr }),
        CastCommand.deleteMany({ userId: userIdStr }),
        CastNowPlaying.deleteMany({ userId: userIdStr }),
        TvLoginCode.deleteMany({ userId: userIdStr }),
        DirectMessage.deleteMany({ $or: [{ fromUserId: userObjectId }, { toUserId: userObjectId }] }),
        AdvancedSearch.deleteMany({ userId: userIdStr }),
        AnalyticsEvent.deleteMany({ userId: userIdStr }),
      ]);

      const failures = deleteResults.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        logger.warn(`⚠️ Account deletion: ${failures.length} sub-deletions failed for user ${userIdStr}`);
      }

      if (user.avatar) {
        try {
          const { deleteFromS3 } = await import('../services/s3-service');
          const avatarKey = user.avatar.replace(/^https?:\/\/[^/]+\//, '');
          if (avatarKey) await deleteFromS3(avatarKey);
        } catch {}
      }

      await User.findByIdAndDelete(userId);

      const CacheManagerModule = (await import('../cache')).default;
      await CacheManagerModule.clearByPattern(`user-favorites:${userIdStr}`);
      await CacheManagerModule.del(`user_profile_${userIdStr}`);

      logger.log(`🗑️ Account deleted: user ${userIdStr} (${failures.length} sub-deletion failures)`);

      if (req.session) {
        req.session.destroy(() => {});
      }

      res.json({ success: true, message: 'Account deleted successfully' });
    } catch (error: any) {
      logger.error('Account deletion error:', error.message);
      res.status(500).json({ success: false, message: 'Could not delete account' });
    }
  });
}
