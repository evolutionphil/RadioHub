import { useState } from 'react';
import { communityAvatarUrls, type CommunityProfile } from '@/lib/community-profile';

interface PublicProfileAvatarProps {
  profile: Pick<CommunityProfile, 'avatar' | 'profileImageUrl'>;
  name: string;
  className: string;
  size?: number;
}

/** Fixed circular crop; exhausted image sources fall back to initials without a request. */
export function PublicProfileAvatar({ profile, name, className, size = 56 }: PublicProfileAvatarProps) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const src = communityAvatarUrls(profile).find(url => !failedUrls.includes(url));
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || '').join('').toLocaleUpperCase();
  return <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#29232b] text-[#ff9aca] ring-1 ring-inset ring-white/10 ${className}`}>
    {src ? <img key={src} width={size} height={size} src={src} alt={name}
      className="block h-full w-full object-cover" loading="lazy" decoding="async"
      onError={() => setFailedUrls(urls => urls.includes(src) ? urls : [...urls, src])}
    /> : <span role="img" aria-label={name} className="select-none font-semibold" style={{ fontSize: Math.max(14, Math.min(size * .32, 40)) }}>{initials || '♪'}</span>}
  </span>;
}
