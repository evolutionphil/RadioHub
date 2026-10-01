import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe2 } from 'lucide-react';
import { useRegionDirectory } from '@/hooks/useRegionDirectory';
import { apiRequest } from '@/lib/queryClient';
import { parseRegionsResponse } from '@/utils/region-directory';
import { DirectoryCard, DirectoryPage, DirectoryStatus, DirectoryToolbar } from '@/components/regions/region-directory';

export default function RegionsPage() {
  const { copy, language, regionName, formatCount, getLocalizedUrl } = useRegionDirectory();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const { data: regions, isPending, isError, refetch } = useQuery({
    queryKey: ['/api/regions', 'directory-v2'],
    queryFn: async ({ signal }) => parseRegionsResponse(await (await apiRequest('GET', '/api/regions', { signal })).json()),
    staleTime: 5 * 60 * 1000, retry: 1,
  });
  const visibleRegions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase(language);
    return (regions || []).map(region => ({ ...region, displayName: regionName(region.slug, region.name) }))
      .filter(region => !term || [region.name, region.displayName].some(name => name.toLocaleLowerCase(language).includes(term)))
      .sort((a, b) => (sort === 'count' ? b.countryCount - a.countryCount : 0) || a.displayName.localeCompare(b.displayName, language));
  }, [regions, search, sort, language]);
  return <DirectoryPage title={copy.title} description={copy.subtitle}
    summary={regions?.length ? formatCount(regions.reduce((sum, region) => sum + region.countryCount, 0), 'countries') : undefined}>
    <DirectoryToolbar search={search} onSearch={setSearch} searchLabel={copy.search} sort={sort} onSort={setSort} sortLabel={copy.sort}
      sortOptions={[{ value: 'name', label: copy.alphabetical }, { value: 'count', label: copy.countries }]} />
    {isPending ? <DirectoryStatus kind="loading" label={copy.loading} />
      : isError ? <DirectoryStatus kind="error" label={copy.error} onRetry={() => { void refetch(); }} retryLabel={copy.retry} />
      : visibleRegions.length ? <div className="region-directory-grid">
        {visibleRegions.map(region => <DirectoryCard key={region.slug} href={getLocalizedUrl(`/regions/${region.slug}`)}
          title={region.displayName} description={formatCount(region.countryCount, 'countries')} icon={<Globe2 size={26} />} />)}
      </div> : <DirectoryStatus kind="empty" label={copy.empty} />}
  </DirectoryPage>;
}
