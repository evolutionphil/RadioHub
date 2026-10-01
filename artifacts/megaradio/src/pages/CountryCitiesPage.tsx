import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Building2, Radio } from 'lucide-react';
import { DirectoryCard, DirectoryPage, DirectoryStatus, DirectoryToolbar } from '@/components/regions/region-directory';
import { useRegionDirectory } from '@/hooks/useRegionDirectory';
import { apiRequest } from '@/lib/queryClient';

interface City {
  name: string;
  slug: string;
  stationCount: number;
}

interface CountryData {
  region: { name: string; slug: string };
  country: { name: string; slug: string };
  cities: City[];
}

function isCountryData(value: unknown): value is CountryData {
  if (!value || typeof value !== 'object') return false;
  const data = value as CountryData;
  return Boolean(data.region && typeof data.region.name === 'string' &&
    typeof data.region.slug === 'string' && data.region.slug &&
    data.country && typeof data.country.name === 'string' && data.country.name.trim() &&
    typeof data.country.slug === 'string' && data.country.slug &&
    Array.isArray(data.cities) && data.cities.every(city => city &&
      typeof city.name === 'string' && city.name.trim() &&
      typeof city.slug === 'string' && city.slug.trim() &&
      typeof city.stationCount === 'number' && Number.isFinite(city.stationCount) && city.stationCount >= 0));
}

export default function CountryCitiesPage() {
  const { language, copy, regionSlug, countrySlug, countryName, formatCount, getLocalizedUrl } = useRegionDirectory();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('stations');
  const hasCountry = Boolean(regionSlug && countrySlug);
  const endpoint = `/api/regions/${encodeURIComponent(regionSlug || '')}/${encodeURIComponent(countrySlug || '')}`;

  useEffect(() => { setSearchTerm(''); }, [regionSlug, countrySlug]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [endpoint],
    enabled: hasCountry,
    queryFn: async ({ signal }): Promise<CountryData> => {
      const response = await apiRequest('GET', endpoint, { signal });
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || !('success' in payload) || payload.success !== true ||
        !('data' in payload) || !isCountryData(payload.data)) {
        throw new Error('Invalid country directory response');
      }
      return payload.data;
    },
  });

  // The API's "all" entry represents stations without city metadata, not a city.
  // Those stations remain reachable through the complete country listing.
  const cities = useMemo(() => (data?.cities || []).filter(city => city.slug !== 'all'), [data]);
  const filteredCities = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase(language);
    return cities.filter(city => city.name.toLocaleLowerCase(language).includes(query))
      .sort((a, b) => sortBy === 'name'
        ? a.name.localeCompare(b.name, language)
        : b.stationCount - a.stationCount || a.name.localeCompare(b.name, language));
  }, [cities, searchTerm, sortBy, language]);

  const fallbackCountry = (countrySlug || '').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const title = countryName(data?.country.name || fallbackCountry) || copy.countries;

  return (
    <DirectoryPage
      title={title}
      description={data ? formatCount(cities.length, 'cities') : copy.cities}
      backHref={getLocalizedUrl(regionSlug ? `/regions/${regionSlug}` : '/regions')}
      backLabel={copy.back}
      summary={data && hasCountry ? (
        <Link
          href={getLocalizedUrl(`/regions/${regionSlug}/${countrySlug}/stations`)}
          className="region-directory-button"
          data-testid="explore-all-country-stations"
        >
          <Radio className="h-4 w-4" aria-hidden="true" />
          {copy.viewAllStations}
        </Link>
      ) : undefined}
    >
      {isLoading ? <DirectoryStatus kind="loading" label={copy.loading} /> : error || !data || !hasCountry ? (
        <DirectoryStatus kind="error" label={copy.error} onRetry={hasCountry ? () => { void refetch(); } : undefined} retryLabel={copy.retry} />
      ) : (
        <>
          {cities.length === 0 ? <DirectoryStatus kind="empty" label={copy.noCities} /> : (
            <>
              <DirectoryToolbar
                search={searchTerm}
                onSearch={setSearchTerm}
                searchLabel={`${copy.search}: ${copy.cities}`}
                sort={sortBy}
                sortLabel={copy.sort}
                onSort={setSortBy}
                sortOptions={[{ value: 'stations', label: copy.popular }, { value: 'name', label: copy.alphabetical }]}
              />
              {filteredCities.length === 0 ? <DirectoryStatus kind="empty" label={copy.empty} /> : (
                <div className="region-directory-grid">
                  {filteredCities.map(city => (
                    <DirectoryCard
                      key={city.slug}
                      href={getLocalizedUrl(`/regions/${regionSlug}/${countrySlug}/${city.slug}/stations`)}
                      title={city.name}
                      description={formatCount(city.stationCount, 'stations')}
                      icon={<Building2 aria-hidden="true" />}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </DirectoryPage>
  );
}
