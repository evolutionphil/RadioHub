import { availableStations } from '@/utils/station-availability';

export const MOOD_GENRES: Record<string, string[]> = {
  energetic: ['rock', 'classic-rock', 'hard-rock', 'metal', 'punk', 'alternative'],
  party: ['dance', 'pop', 'hits', 'disco', 'edm', 'house', 'electronic', 'top-40'],
  relaxed: ['country', 'adult-contemporary', 'soft-rock', 'easy-listening', 'acoustic', 'folk'],
  chill: ['jazz', 'ambient', 'new-age', 'world-music', 'lounge', 'chillout', 'smooth-jazz'],
  focused: ['classical', 'instrumental', 'meditation', 'piano', 'orchestral', 'baroque'],
  nostalgic: ['oldies', 'classic-hits', '80s', '90s', '70s', '60s', 'retro', 'vintage'],
};

export function recommendationGenres(genres: readonly string[]): string[] {
  return [...new Set(genres.map(genre => genre.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(genre => genre && genre.length <= 60))].slice(0, 8).sort();
}
export function recommendationCountry(country = 'all'): string {
  return ['all', 'global', ''].includes(country.trim().toLowerCase()) ? 'all' : country.trim();
}
export const recommendationPoolKey = (country: string, genres: readonly string[] = []) =>
  ['/api/recommendations/pool', recommendationCountry(country), recommendationGenres(genres).join(',')] as const;

export async function fetchRecommendationPool(country: string, genres: readonly string[] = [], signal?: AbortSignal): Promise<any[]> {
  const params = new URLSearchParams({ country: recommendationCountry(country) });
  if (genres.length) params.set('genres', recommendationGenres(genres).join(','));
  const response = await fetch(`/api/recommendations/pool?${params}`, { signal });
  if (!response.ok) throw new Error('Failed to fetch recommendations');
  const result = await response.json();
  return availableStations(Array.isArray(result.stations) ? result.stations : []);
}

/** Stable Fisher-Yates for a visit: no jumping cards on play/favorite/render,
 * but a fresh visit rotates through the bounded top-quality candidate pool. */
export function rotateRecommendations<T extends { _id?: string; id?: string }>(stations: readonly T[], seed: string): T[] {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index++) value = Math.imul(value ^ seed.charCodeAt(index), 16777619);
  const random = () => { value += 0x6D2B79F5; let t = Math.imul(value ^ value >>> 15, 1 | value); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const seen = new Set<string>();
  const result = availableStations(stations).filter(station => {
    const id = station._id || station.id;
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  });
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function recommendationSections(general: any[], preferred: any[], seed: string, hasPreferences: boolean) {
  const used = new Set<string>();
  const take = (pool: any[], size: number, key: string) => rotateRecommendations(pool, `${seed}:${key}`).filter(station => !used.has(station._id)).slice(0, size).map(station => {
    used.add(station._id); return station;
  });
  const personalized = hasPreferences ? take(preferred, 6, 'personalized') : [];
  // Trending samples only the strongest 30 of the country's top 100.
  const trending = take(general.slice(0, 30), 6, 'trending');
  const discovery = take(general, 6, 'discovery');
  const genres = hasPreferences ? take(preferred, 6, 'genres') : [];
  return { personalized, trending, discovery, genres };
}
