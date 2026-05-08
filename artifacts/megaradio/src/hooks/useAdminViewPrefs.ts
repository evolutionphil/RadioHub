import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

const CROSS_TAB_TOAST_MS = 5000;

// Reusable cross-device admin view-prefs sync.
//
// - Hydrates synchronously from localStorage so the UI never flashes
//   defaults if the admin has used this device before.
// - Then fetches the server copy and adopts it (server wins on conflict
//   so switching devices behaves predictably).
// - On first sync, if the server has nothing but localStorage does,
//   seeds the server from localStorage so existing users don't lose
//   their setup.
// - Subsequent local changes are mirrored to localStorage immediately
//   and PUT to the server (debounced) so other devices pick them up.
// - reset() wipes local + server prefs and uses a "generation" token so
//   any GET/PUT in flight when reset fires is ignored, preventing a
//   late response from re-seeding the record we just deleted.
//
// `key` becomes both the localStorage namespace and the server key,
// so any admin page can call this hook with a fresh string and get
// cross-device persistence for free.

const LOCAL_STORAGE_PREFIX = 'admin:';
const SERVER_DEBOUNCE_MS = 600;

function localStorageKey(key: string): string {
  return `${LOCAL_STORAGE_PREFIX}${key}`;
}

function loadLocal<T>(key: string, defaults: T, sanitize: (raw: unknown) => T): T {
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(localStorageKey(key));
    if (raw == null) return defaults;
    const parsed = JSON.parse(raw);
    return sanitize(parsed);
  } catch {
    return defaults;
  }
}

function writeLocal<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(localStorageKey(key), JSON.stringify(value));
  } catch {
    // Quota / privacy mode — best effort only.
  }
}

export interface UseAdminViewPrefsResult<T> {
  prefs: T;
  setPrefs: (next: T | ((prev: T) => T)) => void;
  clearLocal: () => void;
  reset: () => void;
  loaded: boolean;
}

function parseUpdatedAt(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (raw instanceof Date) return raw.getTime();
  return 0;
}

function removeLocal(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(localStorageKey(key));
  } catch {
    // best-effort
  }
}

export function useAdminViewPrefs<T>(
  key: string,
  defaults: T,
  sanitize: (raw: unknown) => T,
): UseAdminViewPrefsResult<T> {
  // Synchronous local hydration so UI doesn't flash defaults.
  const [prefs, setPrefsState] = useState<T>(() => loadLocal(key, defaults, sanitize));
  const [loaded, setLoaded] = useState(false);

  // Track whether the *user* has changed prefs since mount. Only user-driven
  // changes are pushed to the server, never the initial server adoption.
  const userDirtyRef = useRef(false);
  const latestRef = useRef<T>(prefs);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  const initialLoadRef = useRef<AbortController | null>(null);
  // Most recent server-known updatedAt (epoch ms). Used to decide whether
  // a focus-time refetch carries a newer value than what we already have.
  const lastUpdatedAtRef = useRef<number>(0);
  // Bumped whenever reset() runs. Any async work (initial GET, debounced
  // PUT, focus refresh) snapshots the current generation up front and
  // ignores its results if the generation has advanced by the time it
  // resolves. Prevents a late response from re-seeding the server record
  // we just deleted, or re-adopting stale prefs over the freshly-reset UI.
  const resetGenRef = useRef(0);

  // Keep latestRef aligned with state for the debounced flush.
  useEffect(() => {
    latestRef.current = prefs;
  }, [prefs]);

  // Stable handle to "revert to a snapshot and push it to the server now"
  // so the cross-tab/focus toast Undo actions can reach the latest
  // flushToServer without re-binding the storage/visibility listeners on
  // every render.
  const undoToRef = useRef<(previous: T) => void>(() => {});

  // Initial server load + migration from localStorage.
  useEffect(() => {
    let cancelled = false;
    const generation = resetGenRef.current;
    const controller = new AbortController();
    initialLoadRef.current = controller;
    (async () => {
      try {
        const res = await apiRequest(
          'GET',
          `/api/admin/preferences/${encodeURIComponent(key)}`,
          { signal: controller.signal },
        );
        const body = (await res.json()) as { value: unknown };
        if (cancelled || generation !== resetGenRef.current) return;

        const serverUpdatedAt = parseUpdatedAt((body as { updatedAt?: unknown }).updatedAt);
        if (serverUpdatedAt > lastUpdatedAtRef.current) {
          lastUpdatedAtRef.current = serverUpdatedAt;
        }

        if (body.value == null) {
          // Server is empty — migrate any local prefs up so this admin's
          // existing setup follows them on the next device.
          const local = loadLocal(key, defaults, sanitize);
          // Only seed if local actually deviates from defaults; otherwise
          // there's nothing meaningful to upload.
          const localStr = JSON.stringify(local);
          const defaultsStr = JSON.stringify(defaults);
          if (localStr !== defaultsStr && generation === resetGenRef.current) {
            try {
              await apiRequest('PUT', `/api/admin/preferences/${encodeURIComponent(key)}`, {
                body: { value: local },
                signal: controller.signal,
              });
            } catch {
              // Ignore — next user-driven change will retry.
            }
          }
        } else {
          const sanitized = sanitize(body.value);
          // Only adopt server value if the user hasn't already started
          // editing in the meantime, and no reset has happened since
          // this request started.
          if (
            !userDirtyRef.current &&
            !cancelled &&
            generation === resetGenRef.current
          ) {
            setPrefsState(sanitized);
            writeLocal(key, sanitized);
          }
        }
      } catch {
        // Network/auth error or aborted — fall back to localStorage values.
      } finally {
        if (!cancelled && generation === resetGenRef.current) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // Intentionally only on key — defaults/sanitize are expected to be stable
    // per call site (declared at module scope or memoized).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const flushToServer = useCallback(() => {
    if (inFlightRef.current) {
      inFlightRef.current.abort();
    }
    const controller = new AbortController();
    inFlightRef.current = controller;
    const generation = resetGenRef.current;
    const value = latestRef.current;
    apiRequest('PUT', `/api/admin/preferences/${encodeURIComponent(key)}`, {
      body: { value },
      signal: controller.signal,
    })
      .then(async (res) => {
        // If a reset raced ahead of us, ignore the response so we don't
        // re-stamp lastUpdatedAtRef from a write the server just deleted.
        if (generation !== resetGenRef.current) return;
        try {
          const body = (await res.json()) as { updatedAt?: unknown };
          const ts = parseUpdatedAt(body.updatedAt);
          if (ts > lastUpdatedAtRef.current) lastUpdatedAtRef.current = ts;
        } catch {
          // ignore — non-JSON or already consumed
        }
      })
      .catch(() => {
        // Best-effort; localStorage already holds the latest copy so the
        // user doesn't lose anything if the server write fails. If a
        // reset raced ahead of us, the abort above + the generation guard
        // in reset() ensure the server state stays cleared.
      });
  }, [key]);

  // Wire the Undo handler to the latest flushToServer / key. Re-binding
  // a ref (rather than the listeners themselves) keeps the storage and
  // visibility effects from re-subscribing on every render.
  useEffect(() => {
    undoToRef.current = (previous: T) => {
      latestRef.current = previous;
      setPrefsState(previous);
      writeLocal(key, previous);
      // Treat the revert as a user-driven change so it persists across
      // unmount and propagates back to the originating tab on its next
      // sync (focus refresh / fresh GET).
      userDirtyRef.current = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      flushToServer();
    };
  }, [key, flushToServer]);

  // Cross-tab sync: when another tab in the same browser writes to
  // localStorage under our key, mirror the change into this tab's state
  // so admins don't see drifted filters between tabs. We deliberately do
  // NOT mark userDirty or re-PUT — the originating tab already pushed
  // to the server.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storageKey = localStorageKey(key);
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return;
      if (event.key !== storageKey) return;
      if (event.newValue == null) return;
      try {
        const parsed = JSON.parse(event.newValue);
        const sanitized = sanitize(parsed);
        const currentStr = JSON.stringify(latestRef.current);
        const incomingStr = JSON.stringify(sanitized);
        if (currentStr === incomingStr) return;
        const previous = latestRef.current;
        latestRef.current = sanitized;
        setPrefsState(sanitized);
        toast({
          title: 'Filters updated from another tab',
          duration: CROSS_TAB_TOAST_MS,
          action: createElement(
            ToastAction,
            {
              altText: 'Undo filter change',
              onClick: () => undoToRef.current(previous),
            },
            'Undo',
          ),
        });
      } catch {
        // Ignore malformed payloads from other tabs.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Focus refresh: when the user switches back to this tab, ask the server
  // for the latest value and adopt it if it's newer than what we last knew
  // about. This catches changes made in another browser/device while this
  // tab was in the background. We skip if the user has unsaved local edits
  // pending a flush so we don't clobber them.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      if (debounceRef.current) return;
      const generation = resetGenRef.current;
      try {
        const res = await apiRequest(
          'GET',
          `/api/admin/preferences/${encodeURIComponent(key)}`,
        );
        if (generation !== resetGenRef.current) return;
        const body = (await res.json()) as { value?: unknown; updatedAt?: unknown };
        const serverUpdatedAt = parseUpdatedAt(body.updatedAt);
        if (serverUpdatedAt <= lastUpdatedAtRef.current) return;
        lastUpdatedAtRef.current = serverUpdatedAt;
        if (body.value == null) return;
        const sanitized = sanitize(body.value);
        const currentStr = JSON.stringify(latestRef.current);
        const incomingStr = JSON.stringify(sanitized);
        if (currentStr === incomingStr) return;
        const previous = latestRef.current;
        latestRef.current = sanitized;
        setPrefsState(sanitized);
        writeLocal(key, sanitized);
        toast({
          title: 'Filters updated from another tab',
          duration: CROSS_TAB_TOAST_MS,
          action: createElement(
            ToastAction,
            {
              altText: 'Undo filter change',
              onClick: () => undoToRef.current(previous),
            },
            'Undo',
          ),
        });
      } catch {
        // Best-effort — leave existing state untouched.
      }
    };
    const onFocus = () => {
      void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setPrefs = useCallback<UseAdminViewPrefsResult<T>['setPrefs']>(
    (next) => {
      setPrefsState((prev) => {
        const resolved =
          typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        latestRef.current = resolved;
        userDirtyRef.current = true;
        writeLocal(key, resolved);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(flushToServer, SERVER_DEBOUNCE_MS);
        return resolved;
      });
    },
    [key, flushToServer],
  );

  const clearLocal = useCallback(() => {
    removeLocal(key);
  }, [key]);

  const reset = useCallback(() => {
    // Bump the generation first so any in-flight GET/PUT that resolves
    // after this point will see a stale generation and bail out before
    // touching state or the server.
    resetGenRef.current += 1;

    // Cancel any pending debounce so we don't immediately re-create the
    // server record we're about to delete.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // Abort any in-flight PUT so it can't land after our DELETE.
    if (inFlightRef.current) {
      inFlightRef.current.abort();
      inFlightRef.current = null;
    }
    // Abort the initial GET too, so a slow first-load response can't
    // re-adopt stale prefs after a quick reset.
    if (initialLoadRef.current) {
      initialLoadRef.current.abort();
      initialLoadRef.current = null;
    }
    userDirtyRef.current = false;
    latestRef.current = defaults;
    setPrefsState(defaults);
    // If reset fires before the initial GET finishes, that GET is aborted
    // and its `setLoaded(true)` is gated by the now-stale generation, so
    // we settle `loaded` here to keep consumers from waiting forever.
    setLoaded(true);
    removeLocal(key);
    apiRequest('DELETE', `/api/admin/preferences/${encodeURIComponent(key)}`).catch(
      () => {
        // Best-effort; localStorage is already cleared so the UI is in
        // the right state on this device.
      },
    );
  }, [key, defaults]);

  // Flush pending writes on unmount so a quick edit + nav doesn't lose data.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        if (userDirtyRef.current) {
          flushToServer();
        }
      }
    };
  }, [flushToServer]);

  return { prefs, setPrefs, clearLocal, reset, loaded };
}
