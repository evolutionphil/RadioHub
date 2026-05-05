import { User } from '../../shared/mongo-schemas';

// Check if social auth is configured
export function getSocialAuthStatus() {
  return {
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    facebook: !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    apple: !!((process.env.APPLE_CLIENT_ID || process.env.APPLE_SERVICE_ID) && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY)
  };
}

// Helper function to generate unique username
export async function generateUniqueUsername(baseUsername: string): Promise<string> {
  let username = baseUsername.toLowerCase().replace(/[^a-z0-9_]/g, '');
  let counter = 0;
  
  while (true) {
    const existingUser = await User.findOne({ username });
    if (!existingUser) {
      return username;
    }
    counter++;
    username = `${baseUsername}${counter}`;
  }
}

// Create user from social profile
export async function createUserFromSocialProfile(profile: any, provider: 'google' | 'facebook' | 'apple') {
  const email = profile.emails?.[0]?.value || profile.email;
  const fullName = profile.displayName || 
                   `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() ||
                   profile.name?.firstName + ' ' + profile.name?.lastName || '';
  const username = email?.split('@')[0] || `${provider}_user_${profile.id}`;

  const userData: any = {
    fullName,
    username: await generateUniqueUsername(username),
    email,
    emailVerified: true, // Social emails are pre-verified
    profilePicture: profile.photos?.[0]?.value || profile.picture,
    role: 'user',
    status: 'active',
    followersCount: 0,
    followingCount: 0,
    favoriteStationsCount: 0,
    totalListeningTime: 0,
    stationsCreatedCount: 0,
    stats: {
      totalPlays: 0,
      totalListeningHours: 0,
      favoriteGenres: [],
      joinDate: new Date(),
      lastActiveDate: new Date(),
      streakDays: 0
    }
  };

  // Set the appropriate social ID
  if (provider === 'google') userData.googleId = profile.id;
  if (provider === 'facebook') userData.facebookId = profile.id;
  if (provider === 'apple') userData.appleId = profile.id;

  // Generate unique slug for the new social user
  const generateUserSlug = async (user: any, excludeId?: string): Promise<string> => {
    // Import these functions here since they're server-side
    const generateUniqueSlug = async (name: string, entityType: 'station' | 'genre' | 'user', excludeId?: string): Promise<string> => {
      const baseSlug = name
        .toLowerCase()
        .replace(/[^\w\s-]/g, '') 
        .replace(/\s+/g, '-') 
        .replace(/-+/g, '-') 
        .trim()
        .replace(/^-+|-+$/g, '');

      let uniqueSlug = baseSlug;
      let counter = 1;

      while (true) {
        const filter: any = { slug: uniqueSlug };
        if (excludeId) {
          filter._id = { $ne: excludeId };
        }
        
        const existingUser = await User.findOne(filter);
        if (!existingUser) {
          break;
        }
        
        uniqueSlug = `${baseSlug}-${counter}`;
        counter++;
      }

      return uniqueSlug;
    };

    let slugSource = '';
    if (user.username) {
      slugSource = user.username;
    } else if (user.fullName) {
      slugSource = user.fullName;
    } else if (user.email) {
      slugSource = user.email.split('@')[0];
    } else {
      slugSource = `user-${Date.now()}`;
    }

    return await generateUniqueSlug(slugSource, 'user', excludeId);
  };

  userData.slug = await generateUserSlug(userData);
  console.log(`🔤 Generated slug for social user: "${userData.slug}" (${userData.email})`);

  const user = new User(userData);
  await user.save();
  
  return user;
}