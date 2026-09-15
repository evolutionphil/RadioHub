import { useInfiniteQuery } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { Search, ArrowUpRight, SlidersHorizontal, ChevronDown, Heart, Users, X, Check, RotateCcw } from 'lucide-react';
import { useSeoRouting } from '@/hooks/useSeoRouting';
import { useTranslation } from '@/hooks/useTranslation';
import { communityDisplayName, communityFavoriteCount, communityLabels, type CommunityProfile } from '@/lib/community-profile';
import { usersDirectoryCopy } from '@/lib/users-directory-copy';
import { PublicProfileAvatar } from '@/components/ui/public-profile-avatar';
import { apiFetch } from '@/lib/queryClient';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface UsersResponse { users: CommunityProfile[]; pagination: { page: number; pages: number }; }

export default function UsersIndex() {
  const { getLocalizedUrl } = useSeoRouting();
  const { language, localeTranslations } = useTranslation();
  const copy = usersDirectoryCopy(language);
  const labels = communityLabels(language, localeTranslations);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent_favorites');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const limit = 20;
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const query = useInfiniteQuery({
    queryKey: ['/api/users/search', { q: debouncedSearch, limit, sortBy }],
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }): Promise<UsersResponse> => {
      const params = new URLSearchParams({ page: pageParam.toString(), limit: String(limit), sortBy,
        ...(debouncedSearch && { q: debouncedSearch }) });
      const response = await apiFetch(`/api/users/search?${params}`, { signal });
      if (!response.ok) throw new Error(`Failed to load users (${response.status})`);
      const result = await response.json();
      if (!Array.isArray(result.users) || !result.pagination || !Number.isFinite(result.pagination.page) || !Number.isFinite(result.pagination.pages)) throw new Error('Invalid users response');
      return result;
    },
    getNextPageParam: last => last.pagination.page < last.pagination.pages ? last.pagination.page + 1 : undefined,
    staleTime: 30_000, refetchOnWindowFocus: true,
  });
  const users = [...new Map((query.data?.pages.flatMap(page => page.users) || []).map(user => [user._id,user])).values()].filter(user => user.isPublicProfile !== false);
  const options = [['recent_favorites',labels.recentFavorites],['newest',copy.newest],['oldest',copy.oldest],['most_radios',copy.most],['least_radios',copy.least]];
  const reset = () => { setSearchQuery(''); setDebouncedSearch(''); setSortBy('recent_favorites'); searchRef.current?.focus(); };
  const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E0E0E]';

  return <div className="bg-[#0E0E0E] pb-16 text-white" data-testid="users-directory">
    <div className="container mx-auto px-4 pt-5 md:pt-8">
      <header className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#171417] px-5 py-7 md:px-8 md:py-9">
        <div aria-hidden="true" className="pointer-events-none absolute -end-12 -top-20 size-64 rounded-full border-[32px] border-[#ff4199]/[.05]" />
        <div className="relative max-w-2xl">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#ff8fbe]"><Users className="size-4" aria-hidden="true" />{copy.community}</p>
          <h1 className="text-2xl font-bold leading-tight tracking-tight md:text-4xl">{copy.title}</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#aaa4ad] md:text-base">{copy.subtitle}</p>
        </div>
      </header>
      <section aria-label={copy.search} className="my-6 grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-h-12 min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-[#222024] px-4 transition-colors focus-within:border-[#ff4199]/70 focus-within:ring-1 focus-within:ring-[#ff4199]/70" data-testid="directory-search-shell">
          <Search className="size-5 shrink-0 text-[#b5aab7]" aria-hidden="true" />
          <input ref={searchRef} type="search" aria-label={copy.search} placeholder={copy.search} value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)} maxLength={100}
            className="block h-12 min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-base text-white placeholder:text-[#aaa4ad] focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden" />
          {searchQuery && <button type="button" aria-label={copy.clear} className={`-me-2 flex size-11 shrink-0 items-center justify-center rounded-xl text-[#b5aab7] hover:bg-white/5 ${focus}`}
            onClick={() => { setSearchQuery(''); setDebouncedSearch(''); searchRef.current?.focus(); }}><X className="size-4" /></button>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" aria-label={`${copy.sort}: ${options.find(([value]) => value === sortBy)?.[1]}`}
            className={`flex min-h-12 w-full min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-[#222024] px-4 py-3 text-start text-sm hover:bg-[#2c2730] ${focus}`}>
            <SlidersHorizontal className="size-4 shrink-0 text-[#ff8fbe]" aria-hidden="true" /><span className="min-w-0 flex-1">{options.find(([value]) => value === sortBy)?.[1]}</span><ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-2rem)] rounded-xl border-white/10 bg-[#222024] p-1.5 text-white">
            {options.map(([value,label]) => <DropdownMenuItem key={value} onSelect={() => setSortBy(value)} className="min-h-11 cursor-pointer gap-3 rounded-lg px-3 text-sm focus:bg-[#ff4199]/15 focus:text-white">
              <span className="flex-1">{label}</span>{sortBy === value && <Check className="size-4 text-[#ff8fbe]" aria-hidden="true" />}
            </DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </section>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3" aria-busy={query.isLoading}>
        {users.map(user => {
          const name = communityDisplayName(user, copy.listener);
          return <Link key={user._id} href={getLocalizedUrl(`/users/${encodeURIComponent(user.slug || user._id)}`)} aria-label={name}
            className={`group flex min-w-0 items-center gap-4 rounded-2xl border border-white/[.07] bg-[#202023] p-4 transition-colors hover:border-[#ff4199]/40 hover:bg-[#262126] md:p-5 ${focus}`}>
            <PublicProfileAvatar profile={user} name={name} size={64} className="size-14 md:size-16" />
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 break-words text-base font-semibold leading-snug text-white group-hover:text-[#ffb7d7] md:text-lg" title={name}>{name}</h2>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-[#aaa4ad]"><Heart aria-hidden="true" className="size-3.5 shrink-0 text-[#d780a9]" />{communityFavoriteCount(user).toLocaleString(language)} {labels.radios}</p>
            </div>
            <ArrowUpRight className="size-4 shrink-0 text-[#8d8390] transition-colors group-hover:text-[#ff8fbe] rtl:-rotate-90" aria-hidden="true" />
          </Link>;
        })}
        {query.isLoading && Array.from({length:6},(_,i) => <div key={i} aria-hidden="true" className="flex h-28 items-center gap-4 rounded-2xl border border-white/5 bg-[#202023] p-4 motion-safe:animate-pulse"><div className="size-14 shrink-0 rounded-full bg-white/5" /><div className="flex-1 space-y-3"><div className="h-4 w-3/4 rounded bg-white/10" /><div className="h-3 w-1/3 rounded bg-white/5" /></div></div>)}
      </div>
      {query.isLoading && <p role="status" className="sr-only">{copy.loading}</p>}
      {query.isError && <div role="alert" className="mt-6 rounded-2xl border border-[#ff4199]/20 bg-[#211820] p-6 text-center">
        <p className="text-sm text-[#d5cbd6]">{copy.error}</p>
        <button type="button" onClick={() => query.isFetchNextPageError ? void query.fetchNextPage() : void query.refetch()} disabled={query.isFetching}
          className={`mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#ff4199] px-5 text-sm font-semibold disabled:opacity-50 ${focus}`}><RotateCcw className="size-4" />{copy.retry}</button>
      </div>}
      {!query.isLoading && !query.isError && users.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 px-5 py-14 text-center">
        <Users className="mx-auto mb-4 size-8 text-[#aa7790]" aria-hidden="true" /><p className="text-[#aaa4ad]">{copy.empty}</p>
        {(searchQuery || sortBy !== 'recent_favorites') && <button type="button" onClick={reset} className={`mt-4 min-h-11 rounded-full px-4 font-medium text-[#ff8fbe] ${focus}`}>{copy.reset}</button>}
      </div>}
      {query.hasNextPage && !query.isLoading && !query.isError && <div className="mt-8 text-center">
        <button type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}
          className={`min-h-12 rounded-full border border-white/15 bg-[#211e23] px-6 text-sm font-semibold hover:border-[#ff4199]/60 disabled:opacity-50 ${focus}`}>{query.isFetchingNextPage ? copy.loading : copy.more}</button>
      </div>}
    </div>
  </div>;
}
