import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/queryClient';

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
  loaded: boolean;
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

  // Keep latestRef aligned with state for the debounced flush.
  useEffect(() => {
    latestRef.current = prefs;
  }, [prefs]);

  // Initial server load + migration from localStorage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest('GET', `/api/admin/preferences/${encodeURIComponent(key)}`);
        const body = (await res.json()) as { value: unknown };
        if (cancelled) return;

        if (body.value == null) {
          // Server is empty — migrate any local prefs up so this admin's
          // existing setup follows them on the next device.
          const local = loadLocal(key, defaults, sanitize);
          // Only seed if local actually deviates from defaults; otherwise
          // there's nothing meaningful to upload.
          const localStr = JSON.stringify(local);
          const defaultsStr = JSON.stringify(defaults);
          if (localStr !== defaultsStr) {
            try {
              await apiRequest('PUT', `/api/admin/preferences/${encodeURIComponent(key)}`, {
                body: { value: local },
              });
            } catch {
              // Ignore — next user-driven change will retry.
            }
          }
        } else {
          const sanitized = sanitize(body.value);
          // Only adopt server value if the user hasn't already started
          // editing in the meantime, to avoid clobbering their edits.
          if (!userDirtyRef.current && !cancelled) {
            setPrefsState(sanitized);
            writeLocal(key, sanitized);
          }
        }
      } catch {
        // Network/auth error — fall back to localStorage values already loaded.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
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
    const value = latestRef.current;
    apiRequest('PUT', `/api/admin/preferences/${encodeURIComponent(key)}`, {
      body: { value },
    }).catch(() => {
      // Best-effort; localStorage already holds the latest copy so the
      // user doesn't lose anything if the server write fails.
    });
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

  return { prefs, setPrefs, loaded };
}
