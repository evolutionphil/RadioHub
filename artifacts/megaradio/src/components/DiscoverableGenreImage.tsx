import { useState } from 'react';
import jazzBanner from '@/assets/jazz-discoverable.png';

const LEGACY_JAZZ_IMAGE = '/uploads/genres/discoverable/genre-dfd155a5-8ea0-47f6-8c09-d3ba856c4853.png';

export interface GenreImageSource {
  _id: string;
  slug: string;
  discoverableImage?: string;
}

function isLegacyJazzImage(source: string): boolean {
  try {
    const url = new URL(source, 'https://themegaradio.com');
    return ['themegaradio.com', 'www.themegaradio.com', 'api.themegaradio.com'].includes(url.hostname)
      && url.pathname === LEGACY_JAZZ_IMAGE;
  } catch {
    return false;
  }
}

/** Keep custom artwork; the bundled original repairs missing/old Jazz uploads. */
export function getGenreImageSources(genre: GenreImageSource): string[] {
  const configured = genre.discoverableImage?.trim();
  if (genre.slug !== 'jazz' && genre._id !== 'genre-jazz') {
    return configured ? [configured] : [];
  }
  // Vite fingerprints this asset, avoiding cached HTML/error responses at the
  // old upload path. Leave that original URL available for external consumers.
  const sources = configured && !isLegacyJazzImage(configured)
    ? [configured, jazzBanner]
    : [jazzBanner, LEGACY_JAZZ_IMAGE];
  return [...new Set(sources)];
}

export default function DiscoverableGenreImage({ sources }: { sources: string[] }) {
  const [attempt, setAttempt] = useState(0);
  const source = sources[attempt];
  if (!source) return null;

  return (
    <img
      key={source}
      src={source}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      draggable={false}
      className="absolute inset-0 h-full w-full rounded-xl object-cover"
      // At most one request per candidate: no retry timers or infinite loops.
      // A new source gets a fresh image, never an inherited display:none.
      onError={() => setAttempt(current => current === attempt ? current + 1 : current)}
    />
  );
}
