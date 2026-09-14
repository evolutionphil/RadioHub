import { useState } from 'react';
import { communityAvatarUrl, type CommunityProfile } from '@/lib/community-profile';

interface PublicProfileAvatarProps {
  profile: Pick<CommunityProfile, 'avatar' | 'profileImageUrl'>;
  name: string;
  className: string;
  size?: number;
}

/** No external placeholder service, DOM injection, or repeated fallback requests. */
export function PublicProfileAvatar({ profile, name, className, size = 56 }: PublicProfileAvatarProps) {
  const avatar = communityAvatarUrl(profile);
  const [failedUrl, setFailedUrl] = useState<string>();
  const src = avatar && avatar !== failedUrl ? avatar : '/no-avatar.svg';
  return <img
    width={size} height={size} src={src} alt={name}
    className={`${className} object-cover`} loading="lazy" decoding="async"
    onError={avatar && src === avatar ? () => setFailedUrl(avatar) : undefined}
  />;
}
