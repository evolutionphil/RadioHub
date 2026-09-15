import { useParams, useLocation } from 'wouter';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, ChevronDown, Heart, Loader2, LockKeyhole, RefreshCw, Share2, UserPlus, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import StationCard from '@/components/ui/station-card';
import { PublicProfileAvatar } from '@/components/ui/public-profile-avatar';
import { Button } from '@/components/ui/button';
import AuthModal from '@/components/auth/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, getQueryFn } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { useSeoRouting } from '@/hooks/useSeoRouting';
import { useTranslation } from '@/hooks/useTranslation';
import { communityDisplayName, type CommunityProfile } from '@/lib/community-profile';
import { profileJoinedDate, profileNumber, publicProfileLabels } from '@/lib/public-profile-labels';
import { stationQueryFreshness } from '@/lib/station-query-policy';
import type { AuthQueryResponse } from '@/lib/auth-query';
import NotFound from '@/pages/not-found';
import { useBreadcrumbLastItemName } from '@/components/RouteBreadcrumbs';

interface UserProfileData extends CommunityProfile {
  isPublic?: boolean;
  bio?: string;
  createdAt?: string;
  followersCount?: number;
  isFollowing?: boolean;
  listeningStats?: { joinedDate?: string };
  privacy?: { showFavorites?: boolean; showStatistics?: boolean };
}
interface ProfileStation { _id: string; name: string; [key: string]: unknown }
interface ProfilePage { profile?: UserProfileData; favorites: ProfileStation[]; total?: number; page?: number }
type ProfileQueryKey = readonly [string, { viewer: string }];
interface FollowAction { target: string; follow: boolean; key: ProfileQueryKey; route: string }
const PAGE_SIZE = 20;

export default function UserProfile() {
  const params = useParams<{ idOrSlug: string; id: string }>();
  const [location, setLocation] = useLocation();
  const { cleanPath, getLocalizedUrl } = useSeoRouting();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { language, localeTranslations } = useTranslation();
  const labels = publicProfileLabels(language, localeTranslations);
  const { user: currentUser, isAuthenticated, isLoading: authLoading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [manualShareUrl, setManualShareUrl] = useState('');
  const pendingFollow = useRef<{ target: string; route: string } | null>(null);

  const routeSegment = cleanPath.match(/^\/users\/([^/?#]+)\/?(?:[?#].*)?$/)?.[1]
    || location.match(/\/users\/([^/?#]+)\/?(?:[?#].*)?$/)?.[1] || params.idOrSlug || params.id;
  let userIdOrSlug = routeSegment;
  try { if (routeSegment) userIdOrSlug = decodeURIComponent(routeSegment); } catch { /* Encode malformed input as an API segment. */ }
  const viewer = isAuthenticated && currentUser?._id ? currentUser._id : 'anonymous';
  const endpoint = `/api/user-engagement/profile/${encodeURIComponent(userIdOrSlug || '')}/full`;
  const queryKey: ProfileQueryKey = [endpoint, { viewer }];
  const activeIdentity = useRef({ route: userIdOrSlug, viewer });
  activeIdentity.current = { route: userIdOrSlug, viewer };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    setShowAuthModal(false);
    setManualShareUrl('');
    pendingFollow.current = null;
  }, [userIdOrSlug]);

  const profileQuery = useInfiniteQuery({
    queryKey,
    ...stationQueryFreshness,
    initialPageParam: 1,
    queryFn: async (context): Promise<ProfilePage> => {
      const path = context.pageParam === 1 ? endpoint
        : `/api/user-engagement/profile/${encodeURIComponent(userIdOrSlug || '')}/favorites?page=${context.pageParam}&limit=${PAGE_SIZE}`;
      const result = await getQueryFn<ProfilePage>({ on401: 'throw' })({ ...context, queryKey: [path] });
      return { ...result, favorites: Array.isArray(result.favorites) ? result.favorites : [], page: context.pageParam,
        total: result.total ?? result.profile?.favoriteStationsCount };
    },
    getNextPageParam: lastPage => {
      const page = lastPage.page || 1;
      return lastPage.favorites.length > 0 && typeof lastPage.total === 'number' && page * PAGE_SIZE < lastPage.total ? page + 1 : undefined;
    },
    enabled: !!userIdOrSlug && !authLoading,
    retry: false,
    staleTime: 60_000,
    refetchOnMount: true,
  });
  const userProfile = profileQuery.data?.pages[0]?.profile;
  const unavailableError = profileQuery.error instanceof Error && /^(401|403|404):/.test(profileQuery.error.message);
  const targetUserId = userProfile?._id;
  const isOwnProfile = !!targetUserId && viewer === targetUserId;
  const isPublic = userProfile?.isPublic === true || userProfile?.isPublicProfile === true;
  const showFavorites = isPublic && userProfile?.privacy?.showFavorites !== false;
  const showStatistics = isPublic && userProfile?.privacy?.showStatistics !== false;
  const favoriteStations = showFavorites ? [...new Map((profileQuery.data?.pages.flatMap(page => page.favorites) || [])
    .filter(station => typeof station?._id === 'string').map(station => [station._id, station])).values()] : [];
  const isFollowing = isAuthenticated && (typeof userProfile?.isFollowing === 'boolean' ? userProfile.isFollowing
    : !!(currentUser as typeof currentUser & { following?: string[] })?.following?.includes(targetUserId || ''));

  // Replace ID aliases without adding another history entry or remounting audio.
  useEffect(() => {
    if (/^[0-9a-f]{24}$/i.test(userIdOrSlug || '') && userProfile?.slug && userProfile.slug !== userIdOrSlug) {
      setLocation(getLocalizedUrl(`/users/${encodeURIComponent(userProfile.slug)}`), { replace: true });
    }
  }, [userIdOrSlug, userProfile?.slug, getLocalizedUrl, setLocation]);

  const followMutation = useMutation({
    mutationFn: (action: FollowAction) => apiRequest('POST', `/api/user-engagement/${action.follow ? 'follow' : 'unfollow'}/${encodeURIComponent(action.target)}`),
    onSuccess: async (_response, action) => {
      // Late responses belong only to the viewer/profile that initiated them.
      queryClient.setQueryData<InfiniteData<ProfilePage>>(action.key, old => old ? {
        ...old, pages: old.pages.map((page, index) => index || !page.profile ? page : { ...page, profile: {
          ...page.profile, isFollowing: action.follow,
          followersCount: typeof page.profile.followersCount === 'number'
            ? Math.max(0, page.profile.followersCount + (page.profile.isFollowing === action.follow ? 0 : action.follow ? 1 : -1)) : undefined,
        } }),
      } : old);
      if (activeIdentity.current.route === action.route && activeIdentity.current.viewer === action.key[1].viewer)
        toast({ title: action.follow ? labels.followed : labels.unfollowed });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] }),
        queryClient.invalidateQueries({ queryKey: [action.key[0]] }),
        queryClient.invalidateQueries({ queryKey: ['/api/user/following'] }),
        queryClient.invalidateQueries({ queryKey: [`/api/user/is-following/${action.target}`] }),
      ]);
    },
    onError: (_error, action) => {
      if (activeIdentity.current.route === action.route && activeIdentity.current.viewer === action.key[1].viewer)
        toast({ title: labels.followFailed, variant: 'destructive' });
    },
  });

  const handleFollow = () => {
    if (!targetUserId || isOwnProfile || followMutation.isPending || authLoading) return;
    if (!isAuthenticated) {
      pendingFollow.current = { target: targetUserId, route: userIdOrSlug || '' };
      setShowAuthModal(true);
      return;
    }
    followMutation.mutate({ target: targetUserId, follow: !isFollowing, key: queryKey, route: userIdOrSlug || '' });
  };

  const handleAuthSuccess = () => {
    const pending = pendingFollow.current;
    pendingFollow.current = null;
    setShowAuthModal(false);
    const signedIn = queryClient.getQueryData<AuthQueryResponse>(['/api/auth/me']);
    const signedInId = signedIn?.authenticated ? signedIn.user?._id : undefined;
    if (pending && signedInId && signedInId !== pending.target && pending.route === activeIdentity.current.route)
      followMutation.mutate({ target: pending.target, follow: true, key: [endpoint, { viewer: signedInId }], route: pending.route });
  };

  const displayName = userProfile ? communityDisplayName(userProfile, labels.anonymous) : labels.anonymous;
  useBreadcrumbLastItemName(userProfile && isPublic && !unavailableError ? displayName : undefined);
  const handleShare = async () => {
    if (sharing) return;
    const sharedIdentity = { ...activeIdentity.current };
    const stillViewing = () => activeIdentity.current.route === sharedIdentity.route && activeIdentity.current.viewer === sharedIdentity.viewer;
    const url = `${window.location.origin}${getLocalizedUrl(`/users/${encodeURIComponent(userProfile?.slug || userIdOrSlug || '')}`)}`;
    setSharing(true);
    try {
      if (typeof navigator.share === 'function') {
        try { await navigator.share({ title: `${displayName} · Mega Radio`, url }); return; }
        catch (error) { if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return; }
      }
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      if (stillViewing()) {
        setManualShareUrl('');
        toast({ title: labels.copied });
      }
    } catch {
      if (stillViewing()) {
        setManualShareUrl(url);
        toast({ title: labels.copyFailed, variant: 'destructive' });
      }
    } finally { setSharing(false); }
  };

  if (!userIdOrSlug) return <NotFound />;

  const navigateLink = (event: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault(); setLocation(getLocalizedUrl(path));
    }
  };
  const backLink = <a href={getLocalizedUrl('/users')} onClick={event => navigateLink(event, '/users')} className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-[#A8A8A8] transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199]">
    <ArrowLeft aria-hidden="true" className="h-4 w-4 rtl:rotate-180" />{labels.back}
  </a>;

  if (profileQuery.isLoading || authLoading) return <div className="min-h-[65vh] bg-[#0E0E0E] px-4 py-6 text-white sm:px-6">
    <div className="mx-auto max-w-6xl">{backLink}
      <div role="status" className="mt-5 rounded-3xl border border-white/[0.08] bg-[#171717] p-6 sm:p-10">
        <span className="sr-only">{labels.loading}</span>
        <div aria-hidden="true" className="flex animate-pulse items-center gap-5 motion-reduce:animate-none">
          <div className="h-24 w-24 shrink-0 rounded-full bg-white/[0.07]" />
          <div className="min-w-0 flex-1 space-y-4"><div className="h-4 w-24 rounded bg-white/[0.05]" /><div className="h-8 w-3/4 rounded bg-white/[0.07]" /></div>
        </div>
        <div aria-hidden="true" className="mt-8 h-20 animate-pulse rounded-2xl bg-white/[0.03] motion-reduce:animate-none" />
      </div>
    </div>
  </div>;

  const blockingError = profileQuery.isError && (!profileQuery.isFetchNextPageError || unavailableError);
  if (blockingError || !userProfile || !isPublic) {
    const unavailable = unavailableError || (!blockingError && (!userProfile || !isPublic));
    return <div className="min-h-[65vh] bg-[#0E0E0E] px-4 py-6 text-white sm:px-6"><div className="mx-auto max-w-6xl">{backLink}
      <section className="mt-5 rounded-3xl border border-white/[0.08] bg-[#171717] px-5 py-14 text-center" aria-live="polite">
        <LockKeyhole aria-hidden="true" className="mx-auto mb-5 h-9 w-9 text-[#FF4199]" />
        <h1 className="text-2xl font-bold">{unavailable ? labels.unavailable : labels.error}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#A8A8A8]">{unavailable ? labels.unavailableBody : labels.errorBody}</p>
        {!unavailable && <Button onClick={() => void profileQuery.refetch()} disabled={profileQuery.isFetching} className="mt-6 min-h-11 bg-[#FF4199] text-black hover:bg-[#ff6aae]"><RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />{labels.retry}</Button>}
      </section>
    </div></div>;
  }

  const favoriteCount = profileQuery.data?.pages.at(-1)?.total ?? userProfile.favoriteStationsCount;
  const joinedLabel = profileJoinedDate(userProfile.createdAt || userProfile.listeningStats?.joinedDate, language);
  const bio = userProfile.bio?.trim();
  return <div className="min-h-screen bg-[#0E0E0E] text-white" dir={language === 'ar' || language === 'he' ? 'rtl' : 'ltr'}>
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-4 sm:px-6 sm:pt-6 lg:px-8">
      {backLink}
      <section aria-labelledby="public-profile-name" className="relative mt-4 overflow-hidden rounded-3xl border border-white/[0.09] bg-[#171717]">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-[#FF4199]/60" />
        <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-x-4 gap-y-5 p-5 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-x-6 sm:p-8 lg:grid-cols-[136px_minmax(0,1fr)_auto] lg:gap-x-8 lg:p-10">
          <PublicProfileAvatar profile={userProfile} name={displayName} size={136} className="h-20 w-20 shrink-0 rounded-full ring-4 ring-[#252525] sm:h-28 sm:w-28 lg:row-span-2 lg:h-[136px] lg:w-[136px]" />
          <div className="min-w-0">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#FF7BB8] sm:text-xs">{labels.profile}</p>
            <h1 id="public-profile-name" dir="auto" className="break-words text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-4xl [overflow-wrap:anywhere]">{displayName}</h1>
          </div>
          {bio && <p dir="auto" className="col-span-2 whitespace-pre-line break-words text-sm leading-7 text-[#BEBEBE] lg:col-span-1 lg:col-start-2 lg:row-start-2 [overflow-wrap:anywhere]">{bio}</p>}
          <div className="col-span-2 grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:min-w-[172px] lg:grid-cols-1">
            {isOwnProfile ? <Button asChild className="h-auto min-h-11 whitespace-normal bg-[#FF4199] px-4 py-3 text-center text-sm font-bold text-black hover:bg-[#ff6aae]"><a href={getLocalizedUrl('/profile/settings')} onClick={event => navigateLink(event, '/profile/settings')}>{labels.edit}<ArrowUpRight aria-hidden="true" className="ms-2 h-4 w-4 shrink-0" /></a></Button>
              : <Button onClick={handleFollow} aria-label={isFollowing ? labels.unfollow : labels.follow} aria-pressed={isFollowing} disabled={followMutation.isPending || authLoading || !targetUserId}
                className={`h-auto min-h-11 whitespace-normal px-4 py-3 text-sm font-bold ${isFollowing ? 'border border-[#FF4199]/35 bg-[#FF4199]/10 text-[#FF8BC1] hover:bg-[#FF4199]/20' : 'bg-[#FF4199] text-black hover:bg-[#ff6aae]'}`}>
                {followMutation.isPending ? <Loader2 aria-hidden="true" className="me-2 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" /> : isFollowing ? <Check aria-hidden="true" className="me-2 h-4 w-4 shrink-0" /> : <UserPlus aria-hidden="true" className="me-2 h-4 w-4 shrink-0" />}
                {isFollowing ? labels.following : labels.follow}
              </Button>}
            <Button onClick={() => void handleShare()} disabled={sharing} variant="outline" className="h-auto min-h-11 whitespace-normal border-white/15 bg-transparent px-4 py-3 text-sm text-white hover:bg-white/[0.06] hover:text-white"><Share2 aria-hidden="true" className="me-2 h-4 w-4 shrink-0" />{labels.share}</Button>
          </div>
        </div>
        {manualShareUrl && <label className="mx-5 mb-6 block text-sm text-[#BEBEBE] sm:mx-8 lg:mx-10">{labels.copy}<input readOnly value={manualShareUrl} onFocus={event => event.currentTarget.select()} className="mt-2 min-h-11 w-full rounded-lg border border-white/15 bg-[#0E0E0E] px-3 text-white focus:outline-none focus:ring-2 focus:ring-[#FF4199]" /></label>}
        {showStatistics && <dl className={`grid grid-cols-1 border-t border-white/[0.08] bg-black/10 ${showFavorites ? 'min-[360px]:grid-cols-3' : 'min-[360px]:grid-cols-2'}`}>
          <div className="min-w-0 border-b border-white/[0.07] px-3 py-5 min-[360px]:border-b-0 min-[360px]:border-e sm:px-8">
            <dt className="flex items-center gap-2 text-[11px] leading-4 text-[#A8A8A8] sm:text-xs"><Users aria-hidden="true" className="hidden h-3.5 w-3.5 shrink-0 sm:block" />{labels.followers}</dt>
            <dd className="mt-2 text-2xl font-bold tabular-nums">{profileNumber(userProfile.followersCount, language)}</dd>
          </div>
          {showFavorites && <div className="min-w-0 border-b border-white/[0.07] px-3 py-5 min-[360px]:border-b-0 min-[360px]:border-e sm:px-8">
            <dt className="flex items-center gap-2 text-[11px] leading-4 text-[#A8A8A8] sm:text-xs"><Heart aria-hidden="true" className="hidden h-3.5 w-3.5 shrink-0 sm:block" />{labels.favorites}</dt>
            <dd className="mt-2 text-2xl font-bold tabular-nums">{profileNumber(favoriteCount, language)}</dd>
          </div>}
          <div className="min-w-0 px-3 py-5 sm:px-8">
            <dt className="flex items-center gap-2 text-[11px] leading-4 text-[#A8A8A8] sm:text-xs"><CalendarDays aria-hidden="true" className="hidden h-3.5 w-3.5 shrink-0 sm:block" />{labels.joined}</dt>
            <dd className="mt-2 text-base font-medium leading-8 sm:text-lg">{joinedLabel}</dd>
          </div>
        </dl>}
      </section>

      <section className="mt-10 sm:mt-12" aria-labelledby="public-profile-favorites">
        <div className="mb-6 flex items-center gap-3"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FF4199]/10 text-[#FF4199]"><Heart className="h-4 w-4" /></span><h2 id="public-profile-favorites" className="min-w-0 text-xl font-bold tracking-tight sm:text-2xl">{labels.favorites}</h2></div>
        {!showFavorites ? <div className="rounded-2xl border border-white/[0.08] p-8 text-center text-[#A8A8A8]"><LockKeyhole aria-hidden="true" className="mx-auto mb-3 h-7 w-7" />{labels.favoritesPrivate}</div>
          : favoriteStations.length ? <>
            <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {favoriteStations.map(station => <StationCard key={station._id} station={station} showVotes />)}
            </div>
            {profileQuery.isFetchNextPageError && <p role="alert" className="mt-6 text-center text-sm text-[#FF8BC1]">{labels.moreError}</p>}
            {profileQuery.hasNextPage && <div className="mt-8 text-center"><Button onClick={() => void profileQuery.fetchNextPage()} disabled={profileQuery.isFetching} variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal border-white/15 bg-transparent px-6 py-3 text-white hover:bg-white/[0.06] hover:text-white">
              {profileQuery.isFetchingNextPage ? <Loader2 aria-hidden="true" className="me-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ChevronDown aria-hidden="true" className="me-2 h-4 w-4" />}
              {profileQuery.isFetchingNextPage ? labels.loadingMore : profileQuery.isFetchNextPageError ? labels.retry : labels.more}
            </Button></div>}
          </> : <div className="rounded-2xl border border-dashed border-white/[0.13] px-5 py-12 text-center sm:py-16">
            <Heart aria-hidden="true" className="mx-auto mb-5 h-8 w-8 text-[#666]" /><h3 className="text-lg font-medium">{labels.empty}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#A8A8A8]">{labels.emptyBody}</p>
            <a href={getLocalizedUrl('/radios')} onClick={event => navigateLink(event, '/radios')} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-[#FF7BB8] hover:text-[#FFA2CF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199]">{labels.discover}<ArrowUpRight aria-hidden="true" className="h-4 w-4" /></a>
          </div>}
      </section>
    </div>
    <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onSuccess={handleAuthSuccess} />
  </div>;
}
