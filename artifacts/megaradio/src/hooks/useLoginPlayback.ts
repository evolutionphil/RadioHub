import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StationWithCountry as Station } from '@workspace/db-shared/schema';
import { authQueryOptions } from '@/lib/auth-query';
import { apiRequest } from '@/lib/queryClient';
import { isExplicitlyFailedStation } from '@/utils/station-availability';

export interface LoginPlaybackUser {
  _id: string;
  preferences?: {
    autoplay?: boolean;
    playAtLogin?: 'LAST_PLAYED' | 'RANDOM' | 'FAVORITE';
  };
}

export async function selectLoginStation(user: LoginPlaybackUser, signal?: AbortSignal): Promise<Station | null> {
  if (user.preferences?.autoplay !== true) return null;
  const mode = user.preferences.playAtLogin || 'LAST_PLAYED';
  const endpoint = mode === 'FAVORITE' ? '/api/user/favorites?sort=newest&page=1&limit=20'
    : mode === 'RANDOM' ? '/api/stations?limit=50&excludeBroken=true'
      : '/api/recently-played';
  const response = await apiRequest('GET', endpoint, { signal });
  const body = await response.json();
  const rows: unknown[] = Array.isArray(body) ? body : Array.isArray(body?.stations) ? body.stations : [];
  const stations = rows.filter((value): value is Station => !!value && typeof value === 'object'
    && typeof (value as Station)._id === 'string' && typeof (value as Station).name === 'string'
    && !isExplicitlyFailedStation(value));
  if (!stations.length) return null;
  return mode === 'RANDOM' ? stations[Math.floor(Math.random() * stations.length)] : stations[0];
}

/** One observer in the player runtime owns login playback; useAuth stays read-only. */
export function useLoginPlayback(player: {
  isReady: boolean;
  currentStation: Station | null;
  playStation: (station: Station) => Promise<void>;
}) {
  const { data, error, isLoading } = useQuery(authQueryOptions);
  const queryClient = useQueryClient();
  const latest = useRef({ data, player });
  latest.current = { data, player };
  const attemptedAccount = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  const playAtLogin = useCallback(async (user: LoginPlaybackUser) => {
    const state = latest.current;
    if (!state.player.isReady || state.data?.authenticated !== true || state.data.user?._id !== user._id
      || attemptedAccount.current === user._id) return;
    attemptedAccount.current = user._id;
    pending.current?.abort();
    if (user.preferences?.autoplay !== true || state.player.currentStation) return;
    const controller = new AbortController();
    pending.current = controller;
    try {
      const station = await selectLoginStation(user, controller.signal);
      const current = latest.current;
      // Query notifications can be batched after an account/settings save;
      // inspect the latest cache before any asynchronous result starts audio.
      const currentAuth = queryClient.getQueryData(authQueryOptions.queryKey);
      const currentUser = currentAuth?.user as LoginPlaybackUser | undefined;
      if (!station || controller.signal.aborted || currentAuth?.authenticated !== true
        || currentUser?._id !== user._id || currentUser.preferences?.autoplay !== true
        || (currentUser.preferences.playAtLogin || 'LAST_PLAYED') !== (user.preferences.playAtLogin || 'LAST_PLAYED')
        || current.player.currentStation) return;
      await current.player.playStation(station);
    } catch {
      // Failed requests and browser autoplay blocks leave the regular play control available.
    }
  }, [queryClient]);

  useEffect(() => {
    if (isLoading || error || data?._pendingTokenExchange || !player.isReady) return;
    if (data?.authenticated !== true || !data.user) {
      attemptedAccount.current = null;
      pending.current?.abort();
      return;
    }
    void playAtLogin(data.user as LoginPlaybackUser);
  }, [data, error, isLoading, player.isReady, playAtLogin]);

  useEffect(() => () => {
    pending.current?.abort();
    attemptedAccount.current = null;
  }, []);

  return playAtLogin;
}
