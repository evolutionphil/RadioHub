import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { DirectoryCard, DirectoryPage, DirectoryStatus, DirectoryToolbar } from '@/components/regions/region-directory';
import { useRegionDirectory } from '@/hooks/useRegionDirectory';
import { apiRequest } from '@/lib/queryClient';

interface Country {
  name: string;
  slug: string;
  stationCount: number;
}

interface RegionData {
  region: { name: string; slug: string };
  countries: Country[];
}

function isRegionData(value: unknown): value is RegionData {
  if (!value || typeof value !== 'object') return false;
  const data = value as RegionData;
  return Boolean(data.region && typeof data.region.name === 'string' &&
    typeof data.region.slug === 'string' && data.region.slug &&
    Array.isArray(data.countries) && data.countries.every(country => country &&
      typeof country.name === 'string' && country.name.trim() &&
      typeof country.slug === 'string' && country.slug.trim() &&
      typeof country.stationCount === 'number' && Number.isFinite(country.stationCount) && country.stationCount >= 0));
}

export default function RegionCountriesPage() {
  const { language, copy, regionSlug, regionName, countryName, formatCount, getLocalizedUrl } = useRegionDirectory();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('stations');
  const hasRegion = Boolean(regionSlug);
  const endpoint = `/api/regions/${encodeURIComponent(regionSlug || '')}`;

  useEffect(() => { setSearchTerm(''); }, [regionSlug]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [endpoint],
    enabled: hasRegion,
    queryFn: async ({ signal }): Promise<RegionData> => {
      const response = await apiRequest('GET', endpoint, { signal });
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || !('success' in payload) || payload.success !== true ||
        !('data' in payload) || !isRegionData(payload.data)) {
        throw new Error('Invalid region directory response');
      }
      return payload.data;
    },
  });

  const countries = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase(language);
    return (data?.countries || [])
      .map(country => ({ ...country, displayName: countryName(country.name) }))
      .filter(country => country.displayName.toLocaleLowerCase(language).includes(query) ||
        country.name.toLocaleLowerCase(language).includes(query))
      .sort((a, b) => sortBy === 'name'
        ? a.displayName.localeCompare(b.displayName, language)
        : b.stationCount - a.stationCount || a.displayName.localeCompare(b.displayName, language));
  }, [data, searchTerm, sortBy, language, countryName]);

  return (
    <DirectoryPage
      title={regionSlug ? regionName(regionSlug, data?.region.name) : copy.title}
      description={data ? formatCount(data.countries.length, 'countries') : copy.countries}
      backHref={getLocalizedUrl('/regions')}
      backLabel={copy.back}
    >
      {isLoading ? <DirectoryStatus kind="loading" label={copy.loading} /> : error || !data || !hasRegion ? (
        <DirectoryStatus kind="error" label={copy.error} onRetry={hasRegion ? () => { void refetch(); } : undefined} retryLabel={copy.retry} />
      ) : (
        <>
          <DirectoryToolbar
            search={searchTerm}
            onSearch={setSearchTerm}
            searchLabel={`${copy.search}: ${copy.countries}`}
            sort={sortBy}
            sortLabel={copy.sort}
            onSort={setSortBy}
            sortOptions={[{ value: 'stations', label: copy.popular }, { value: 'name', label: copy.alphabetical }]}
          />
          {countries.length === 0 ? <DirectoryStatus kind="empty" label={copy.empty} /> : (
            <div className="region-directory-grid">
              {countries.map(country => (
                <DirectoryCard
                  key={country.slug}
                  href={getLocalizedUrl(`/regions/${regionSlug}/${country.slug}`)}
                  title={country.displayName}
                  description={formatCount(country.stationCount, 'stations')}
                  icon={<MapPin aria-hidden="true" />}
                />
              ))}
            </div>
          )}
        </>
      )}
    </DirectoryPage>
  );
}
