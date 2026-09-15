import { useState } from 'react';
import { communityAvatarUrls, type CommunityProfile } from '@/lib/community-profile';

interface PublicProfileAvatarProps {
  profile: Pick<CommunityProfile, 'avatar' | 'profileImageUrl'>;
  name: string;
  className: string;
  size?: number;
}

/** Fixed circular crop; missing/broken photos use a neutral, request-free avatar. */
export function PublicProfileAvatar({ profile, name, className, size = 56 }: PublicProfileAvatarProps) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const src = communityAvatarUrls(profile).find(url => !failedUrls.includes(url));
  return <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#29232b] text-[#ff9aca] ring-1 ring-inset ring-white/10 ${className}`}>
    {src ? <img key={src} width={size} height={size} src={src} alt={name}
      className="block h-full w-full object-cover" loading="lazy" decoding="async"
      onError={() => setFailedUrls(urls => urls.includes(src) ? urls : [...urls, src])}
    /> : <svg role="img" aria-label={name} viewBox="0 0 32 32" fill="currentColor"
      className="h-[68%] w-[68%] text-[#baacb6]" focusable="false">
      <circle cx="16" cy="10" r="6" />
      <path d="M5 30v-3a11 11 0 0 1 22 0v3Z" />
    </svg>}
  </span>;
}
