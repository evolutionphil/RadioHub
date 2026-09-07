import { pgPublicGenres } from '../data/postgres-taxonomy-store';
import { pgSlugCountryNames } from '../data/postgres-seo-indexing-store';
import { MIN_STATIONS_FOR_GENRE_INDEX } from './genre-whitelist';
import { createHash } from 'node:crypto';
import { getMergedWhitelist } from './genre-whitelist-store';
import { canonicalizeCountry, countrySlug, getRegionSlugForCountry } from '@workspace/seo-shared/country-regions';

export const DIRECTORY_GENRE_LIMIT = 60;
export const DIRECTORY_COUNTRIES_PER_REGION = 8;
export const genreDirectoryCacheRevision = (): string => createHash('sha256')
  .update([...getMergedWhitelist()].sort().join('\0')).digest('hex').slice(0, 16);
export const DIRECTORY_REGIONS = [
  { slug: 'africa', name: 'Africa' }, { slug: 'asia', name: 'Asia' },
  { slug: 'europe', name: 'Europe' }, { slug: 'north-america', name: 'North America' },
  { slug: 'south-america', name: 'South America' }, { slug: 'oceania', name: 'Oceania' },
] as const;

/** Read only the curated taxonomy table, never dynamic station tags/catalogue. */
export async function loadGenreDirectoryHub(): Promise<Array<{ slug: string; name: string; stationCount: number }>> {
  return (await pgPublicGenres())
    .filter(genre => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(genre.slug) && genre.stationCount >= MIN_STATIONS_FOR_GENRE_INDEX)
    .sort((a, b) => b.stationCount - a.stationCount || a.slug.localeCompare(b.slug))
    .slice(0, DIRECTORY_GENRE_LIMIT)
    .map(({ slug, name, stationCount }) => ({ slug, name, stationCount }));
}

/** Existing reference-country read (about 237 rows), not a stations GROUP BY.
 * Region pages expose the remaining countries; this hub is deliberately small. */
export async function loadRegionDirectoryHub(): Promise<Array<{ slug: string; name: string; countries: Array<{ slug: string; name: string }> }>> {
  const countries = new Map<string, { slug: string; name: string; region: string }>();
  for (const row of await pgSlugCountryNames()) {
    if (!row.name) continue;
    const name = canonicalizeCountry(row.name);
    const slug = countrySlug(name), region = getRegionSlugForCountry(name);
    if (region && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) countries.set(slug, { name, slug, region });
  }
  return DIRECTORY_REGIONS.map(region => ({ ...region,
    countries: [...countries.values()].filter(country => country.region === region.slug)
      .sort((a, b) => a.slug.localeCompare(b.slug)).slice(0, DIRECTORY_COUNTRIES_PER_REGION)
      .map(({ slug, name }) => ({ slug, name })),
  }));
}
