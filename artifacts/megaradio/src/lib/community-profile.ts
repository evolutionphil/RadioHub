import type { QueryClient } from '@tanstack/react-query';
import { getApiProxyUrl, safeBase64Encode } from '@/lib/utils';

/** Public profile endpoints used different aliases before the PostgreSQL move. */
export interface CommunityProfile {
  _id: string;
  slug?: string;
  displayName?: string;
  fullName?: string;
  name?: string;
  username?: string;
  avatar?: string;
  profileImageUrl?: string;
  favoritesCount?: number;
  favoriteStationsCount?: number;
  favoriteCount?: number;
  favorites_count?: number;
  isPublicProfile?: boolean;
}

export function communityDisplayName(profile: CommunityProfile, fallback = 'User'): string {
  // Never infer a real name from a slug or disclose an email address.
  return [profile.displayName, profile.fullName, profile.name, profile.username]
    .find(value => typeof value === 'string' && value.trim() && !/^user_\d+_[a-z0-9]+$/i.test(value))?.trim() || fallback;
}

export function communityFavoriteCount(profile: CommunityProfile): number {
  for (const value of [profile.favoritesCount, profile.favoriteStationsCount, profile.favoriteCount, profile.favorites_count]) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  }
  return 0;
}

export function communityAvatarUrl(profile: Pick<CommunityProfile, 'avatar' | 'profileImageUrl'>): string | undefined {
  return communityAvatarUrls(profile)[0];
}

export function communityAvatarUrls(profile: Pick<CommunityProfile, 'avatar' | 'profileImageUrl'>): string[] {
  const candidates: string[] = [];
  for (const value of [profile.avatar, profile.profileImageUrl]) {
    if (typeof value !== 'string') continue;
    const url = value.trim();
    if (/^\/(?!\/)/.test(url) || /^https:\/\//i.test(url)) candidates.push(url);
    else if (/^http:\/\//i.test(url)) candidates.push(getApiProxyUrl(`/api/image/${safeBase64Encode(url)}`));
  }
  return [...new Set(candidates)];
}

const labels: Record<string, readonly [string, string]> = {
  en: ['radios', 'Recently added favorites'], de: ['Radios', 'Zuletzt favorisiert'],
  tr: ['radyo', 'En son favori ekleyenler'], es: ['radios', 'Favoritos recientes'],
  fr: ['radios', 'Favoris récents'], pt: ['rádios', 'Favoritos recentes'],
  it: ['radio', 'Preferiti recenti'], ru: ['радиостанций', 'Недавно добавленные избранные'],
  ar: ['محطات إذاعية', 'المفضلة المضافة حديثًا'], zh: ['个电台', '最近添加的收藏'],
  ja: ['局', '最近追加されたお気に入り'], ko: ['개 라디오', '최근 추가한 즐겨찾기'],
  hi: ['रेडियो', 'हाल में जोड़े गए पसंदीदा'], he: ['תחנות רדיו', 'מועדפים שנוספו לאחרונה'],
};

export function communityLabels(language: string, translations?: Readonly<Record<string, string>>) {
  const fallback = labels[language] || labels.en;
  return {
    radios: translations?.users_radios?.trim() || fallback[0],
    recentFavorites: translations?.users_recent_favorites?.trim() || fallback[1],
  };
}

export function invalidateCommunityProfiles(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['/api/public-profiles'] });
  void queryClient.invalidateQueries({ queryKey: ['/api/users/search'] });
  // Identity, privacy and favorites edits also affect an already-open profile.
  // The full endpoint is a string key, so an array-prefix match is insufficient.
  void queryClient.invalidateQueries({ predicate: query => typeof query.queryKey[0] === 'string'
    && query.queryKey[0].startsWith('/api/user-engagement/profile/') });
}
