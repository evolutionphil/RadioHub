import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearch } from 'wouter';
import type { StationWithCountry as Station } from '@workspace/db-shared/schema';
import { useGlobalPlayer } from '@/hooks/useGlobalPlayer';
import { useRegionDirectory } from '@/hooks/useRegionDirectory';
import StationCard from '@/components/ui/station-card';
import { DirectoryPage, DirectoryStatus, DirectoryToolbar } from '@/components/regions/region-directory';
import { apiRequest } from '@/lib/queryClient';

const PAGE_SIZE = 60;
const MAX_OFFSET = 1_000_000;
type Sort = 'votes' | 'name';
type Directory = ReturnType<typeof useRegionDirectory>;

interface StationsPage {
  stations: Station[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  countryName?: string;
  cityName?: string;
}

function readPage(search: string): number {
  const value = new URLSearchParams(search).get('page') || '1';
  const page = /^\d+$/.test(value) ? Number(value) : 1;
  return Number.isSafeInteger(page) && page > 0 && page <= Math.floor(MAX_OFFSET / PAGE_SIZE) + 1 ? page : 1;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/** Keep both API contracts during rolling deployments; never rebuild a station
 * from selected fields, as that drops its canonical slug and stored logo. */
function readStationsPage(response: any, requestedOffset: number): StationsPage {
  const data = response?.data ?? response;
  if (response?.success === false || !Array.isArray(data?.stations)) throw new Error('Invalid region stations response');
  const stations = data.stations.map((station: any): Station => {
    const id = station?._id ?? station?.id ?? station?.stationuuid;
    if (!station || typeof station.name !== 'string' || !id) throw new Error('Invalid region station');
    return station._id ? station : { ...station, _id: String(id) };
  });
  const offset = nonNegativeNumber(data.pagination?.offset ?? data.offset, requestedOffset);
  const limit = nonNegativeNumber(data.pagination?.limit ?? data.limit, PAGE_SIZE) || PAGE_SIZE;
  const total = nonNegativeNumber(data.pagination?.total ?? data.total, offset + stations.length);
  const hasMore = typeof data.pagination?.hasMore === 'boolean'
    ? data.pagination.hasMore
    : offset + stations.length < total;
  return {
    stations, total, limit, offset, hasMore,
    countryName: data.country?.name ?? data.countryName,
    cityName: data.city?.name ?? data.cityName,
  };
}

export default function RegionStationsPage() {
  const directory = useRegionDirectory();
  const requestedPage = readPage(useSearch());
  // A country/city or crawlable ?page=N change is a new list, not another page
  // to append. Unmounting its observer also aborts an in-flight old request.
  const scope = [directory.language, directory.regionSlug, directory.countrySlug, directory.citySlug, requestedPage].join(':');
  return <RegionStationList key={scope} directory={directory} requestedPage={requestedPage} />;
}

function RegionStationList({ directory, requestedPage }: { directory: Directory; requestedPage: number }) {
  const { language, copy, regionSlug, countrySlug, citySlug, countryName, regionName, getLocalizedUrl, formatCount } = directory;
  const { playStation } = useGlobalPlayer();
  const [search, setSearch] = useState('');
  const [criteria, setCriteria] = useState({ search: '', sort: 'votes' as Sort, startPage: requestedPage });

  useEffect(() => {
    const nextSearch = search.trim();
    if (nextSearch === criteria.search) return;
    const timeout = setTimeout(() => setCriteria(previous => ({ ...previous, search: nextSearch, startPage: 1 })), 300);
    return () => clearTimeout(timeout);
  }, [search, criteria.search]);

  const segments = [regionSlug, countrySlug, ...(citySlug ? [citySlug] : [])];
  const validScope = Boolean(regionSlug && countrySlug);
  const apiUrl = `/api/regions/${segments.map(segment => encodeURIComponent(segment || '')).join('/')}/stations`;
  const query = useInfiniteQuery({
    queryKey: ['region-directory-stations', apiUrl, criteria],
    initialPageParam: (criteria.startPage - 1) * PAGE_SIZE,
    queryFn: async ({ pageParam, signal }): Promise<StationsPage> => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE), offset: String(pageParam), sortBy: criteria.sort,
        order: criteria.sort === 'votes' ? 'desc' : 'asc',
        ...(criteria.search ? { search: criteria.search } : {}),
      });
      const response = await apiRequest('GET', `${apiUrl}?${params}`, { signal });
      return readStationsPage(await response.json(), pageParam);
    },
    getNextPageParam: last => last.hasMore && last.stations.length > 0 && last.offset + last.limit <= MAX_OFFSET
      ? last.offset + last.limit : undefined,
    enabled: validScope,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const stations = useMemo(() => {
    const unique = new Map<string, Station>();
    for (const page of query.data?.pages ?? []) {
      for (const station of page.stations) unique.set(String(station._id), station);
    }
    return [...unique.values()];
  }, [query.data]);
  const firstPage = query.data?.pages[0];
  const lastPage = query.data?.pages[query.data.pages.length - 1];
  const pendingSearch = search.trim() !== criteria.search;
  const waiting = (validScope && query.isPending) || pendingSearch;
  const fallbackCountry = (countrySlug || '').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const displayCountry = countryName(firstPage?.countryName || fallbackCountry);
  const displayCity = firstPage?.cityName || (citySlug || '').replace(/-/g, ' ');
  const title = citySlug && citySlug.toLowerCase() !== 'all' ? displayCity : displayCountry;
  const backHref = getLocalizedUrl(validScope ? `/regions/${regionSlug}/${countrySlug}` : '/regions');
  const description = [citySlug && citySlug.toLowerCase() !== 'all' ? displayCountry : '', regionName(regionSlug || ''), copy.stations].filter(Boolean).join(' · ');

  const loadMore = () => {
    if (!query.isFetching && !pendingSearch && query.hasNextPage) void query.fetchNextPage();
  };
  const retry = () => {
    if (query.isFetching || pendingSearch) return;
    if (query.isFetchNextPageError) void query.fetchNextPage();
    else void query.refetch();
  };

  // SSR and SeoPageWrapper own the localized, query-aware canonical and schema.
  // Opening a directory never changes playback; only a StationCard action does.
  return <DirectoryPage title={title || copy.stations} description={description} backHref={backHref} backLabel={copy.back}
    summary={!waiting && lastPage ? formatCount(lastPage.total, 'stations') : undefined}>
    <DirectoryToolbar search={search} onSearch={setSearch} searchLabel={copy.search} sort={criteria.sort} sortLabel={copy.sort}
      onSort={value => setCriteria(previous => ({ ...previous, sort: value === 'name' ? 'name' : 'votes', startPage: 1 }))}
      sortOptions={[{ value: 'votes', label: copy.mostPopular }, { value: 'name', label: copy.alphabetical }]} />

    {waiting ? <DirectoryStatus kind="loading" label={copy.loading} /> : <>
      {stations.length > 0 && <div className="region-directory-grid" aria-label={copy.stations} aria-busy={query.isFetching}>
        {stations.map(station => <StationCard key={station._id} station={station} playlistName="regions"
          onPlay={() => playStation(station, stations)} showVotes />)}
      </div>}
      {!validScope && <DirectoryStatus kind="error" label={copy.error} />}
      {validScope && query.isError && <DirectoryStatus kind="error" label={copy.error} onRetry={retry} retryLabel={copy.retry} />}
      {validScope && !query.isError && stations.length === 0 && <DirectoryStatus kind="empty" label={copy.empty} />}
      {query.hasNextPage && stations.length > 0 && !query.isFetchNextPageError && <div className="mt-8 flex justify-center">
        <button type="button" onClick={loadMore} disabled={query.isFetching} data-testid="load-more-stations"
          className="inline-flex min-h-12 max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-white/15 bg-[#2d2d2d] px-7 py-3 text-sm font-semibold text-white transition-colors hover:border-[#ff2d96] hover:bg-[#343434] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2d96] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0e0e] disabled:cursor-wait disabled:opacity-60">
          <span>{query.isFetchingNextPage ? copy.loading : copy.loadMore}</span>
          <span className="font-normal text-[#a8a8a8]">{stations.length.toLocaleString(language)} / {lastPage?.total.toLocaleString(language)}</span>
        </button>
      </div>}
    </>}
  </DirectoryPage>;
}
