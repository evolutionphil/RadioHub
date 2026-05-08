import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest, resolveApiUrl } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { useAdminViewPrefs } from '@/hooks/useAdminViewPrefs';
import { ResetViewButton } from '@/components/admin/ResetViewButton';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Search, Save, RefreshCw, CheckCircle2, XCircle, Wand2, Trash2, Trash, AlertTriangle, ChevronUp, ChevronDown, ChevronsUpDown, X, History, Undo2, Download } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Country {
  name: string;
  code: string;
}

interface Language {
  code: string;
  name: string;
}

interface CountryLanguageMapping {
  _id?: string;
  countryCode: string;
  countryName: string;
  languageCode: string;
  isActive: boolean;
  notes?: string;
  updatedAt?: string;
}

interface CountryLanguageDefault {
  countryCode: string;
  languageCode: string;
}

// Namespaced under `country-language-mappings:` so the same admin
// preferences endpoint can serve other admin pages later. The shared
// hook automatically prefixes with `admin:` for localStorage.
const VIEW_PREFS_KEY = 'country-language-mappings:view-prefs:v1';

type SortColumn = 'code' | 'country' | 'status' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

interface ViewPrefs {
  searchTerm: string;
  overwriteExisting: boolean;
  showOverridesOnly: boolean;
  sort: { column: SortColumn; direction: SortDirection } | null;
}

const DEFAULT_VIEW_PREFS: ViewPrefs = {
  searchTerm: '',
  overwriteExisting: false,
  showOverridesOnly: false,
  sort: null,
};

function sanitizeViewPrefs(raw: unknown): ViewPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_VIEW_PREFS;
  const obj = raw as Record<string, unknown>;

  // Back-compat: previous schema stored only `updatedAtSort` (a direction),
  // which corresponds to the new `{ column: 'updatedAt', direction }` shape.
  let sort: ViewPrefs['sort'] = null;
  const sortRaw = obj.sort as Record<string, unknown> | undefined;
  if (
    sortRaw &&
    typeof sortRaw === 'object' &&
    (sortRaw.column === 'code' ||
      sortRaw.column === 'country' ||
      sortRaw.column === 'status' ||
      sortRaw.column === 'updatedAt') &&
    (sortRaw.direction === 'asc' || sortRaw.direction === 'desc')
  ) {
    sort = {
      column: sortRaw.column as SortColumn,
      direction: sortRaw.direction as SortDirection,
    };
  } else if (obj.updatedAtSort === 'asc' || obj.updatedAtSort === 'desc') {
    sort = { column: 'updatedAt', direction: obj.updatedAtSort as SortDirection };
  }

  return {
    searchTerm: typeof obj.searchTerm === 'string' ? obj.searchTerm : '',
    overwriteExisting: obj.overwriteExisting === true,
    showOverridesOnly: obj.showOverridesOnly === true,
    sort,
  };
}

export default function AdminCountryLanguageMappings() {
  const { toast } = useToast();
  const {
    prefs,
    setPrefs,
    reset: resetViewPrefs,
  } = useAdminViewPrefs<ViewPrefs>(
    VIEW_PREFS_KEY,
    DEFAULT_VIEW_PREFS,
    sanitizeViewPrefs,
  );

  const searchTerm = prefs.searchTerm;
  const overwriteExisting = prefs.overwriteExisting;
  const showOverridesOnly = prefs.showOverridesOnly;
  const sort = prefs.sort;

  const setSearchTerm = (value: string) =>
    setPrefs((p) => ({ ...p, searchTerm: value }));
  const setOverwriteExisting = (value: boolean) =>
    setPrefs((p) => ({ ...p, overwriteExisting: value }));
  const setShowOverridesOnly = (value: boolean) =>
    setPrefs((p) => ({ ...p, showOverridesOnly: value }));
  const setSort = (
    updater:
      | ViewPrefs['sort']
      | ((prev: ViewPrefs['sort']) => ViewPrefs['sort']),
  ) =>
    setPrefs((p) => ({
      ...p,
      sort: typeof updater === 'function' ? (updater as any)(p.sort) : updater,
    }));

  const [pendingChanges, setPendingChanges] = useState<Map<string, string>>(new Map());
  const [pendingDelete, setPendingDelete] = useState<Country | null>(null);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [confirmClearOverrides, setConfirmClearOverrides] = useState(false);
  const [confirmDiscardPending, setConfirmDiscardPending] = useState(false);
  const [skipDiscardConfirm, setSkipDiscardConfirm] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem('admin-mappings:skipDiscardConfirm') === '1';
  });
  const [skipResetAllConfirm, setSkipResetAllConfirm] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem('admin-mappings:skipResetAllConfirm') === '1';
  });
  const [rememberDiscardChoice, setRememberDiscardChoice] = useState(false);
  const [rememberResetAllChoice, setRememberResetAllChoice] = useState(false);

  // Log of recently cleared/reset mapping snapshots so admins who miss the
  // ~10s Undo toast can still recover. Capped to the last 5 entries and
  // persisted in localStorage scoped to the admin user, so a reload or
  // coming back hours later still surfaces still-recoverable actions.
  // `kind` distinguishes the two destructive actions so the panel can label
  // them ("Cleared overrides" vs "Reset all mappings").
  type RecentClearKind = 'cleared-overrides' | 'reset-all';
  interface RecentClearAction {
    id: string;
    kind: RecentClearKind;
    timestamp: number;
    snapshot: CountryLanguageMapping[];
    restoring?: boolean;
  }
  const RECENT_CLEAR_ACTIONS_LIMIT = 5;
  // Drop entries older than this so the panel doesn't accumulate stale clears
  // from days ago when an admin returns. 24h is long enough to span an admin's
  // working day(s) but short enough that snapshots stay actionable.
  const RECENT_CLEAR_ACTIONS_TTL_MS = 24 * 60 * 60 * 1000;
  const { user } = useAuth();
  const recentClearsStorageKey = user?._id
    ? `admin:country-language-mappings:recent-clears:v1:${user._id}`
    : null;
  const [recentClearedActions, setRecentClearedActions] = useState<RecentClearAction[]>([]);
  // Track when we've hydrated from localStorage so writes don't clobber the
  // persisted value with the initial empty state before hydration runs.
  const [recentClearsHydrated, setRecentClearsHydrated] = useState(false);

  // Hydrate recent cleared actions from localStorage once the admin user is
  // known. Re-runs if the user changes (e.g. switching accounts) so each
  // admin only sees their own snapshots.
  useEffect(() => {
    if (!recentClearsStorageKey) {
      setRecentClearedActions([]);
      setRecentClearsHydrated(false);
      return;
    }
    if (typeof window === 'undefined') {
      setRecentClearsHydrated(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(recentClearsStorageKey);
      if (!raw) {
        setRecentClearedActions([]);
      } else {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const now = Date.now();
          const sanitized: RecentClearAction[] = parsed
            .filter((e): e is RecentClearAction =>
              !!e &&
              typeof e === 'object' &&
              typeof e.id === 'string' &&
              typeof e.timestamp === 'number' &&
              Array.isArray(e.snapshot) &&
              (e.kind === 'cleared-overrides' || e.kind === 'reset-all'),
            )
            .filter(e => now - e.timestamp < RECENT_CLEAR_ACTIONS_TTL_MS)
            .map(e => ({
              id: e.id,
              kind: e.kind,
              timestamp: e.timestamp,
              snapshot: e.snapshot,
            }))
            .slice(0, RECENT_CLEAR_ACTIONS_LIMIT);
          setRecentClearedActions(sanitized);
        } else {
          setRecentClearedActions([]);
        }
      }
    } catch {
      setRecentClearedActions([]);
    }
    setRecentClearsHydrated(true);
    // RECENT_CLEAR_ACTIONS_TTL_MS / LIMIT are stable constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentClearsStorageKey]);

  // Mirror state to localStorage whenever it changes, but only after the
  // initial hydration so we don't overwrite a persisted list with [] on mount.
  useEffect(() => {
    if (!recentClearsHydrated || !recentClearsStorageKey) return;
    if (typeof window === 'undefined') return;
    try {
      if (recentClearedActions.length === 0) {
        window.localStorage.removeItem(recentClearsStorageKey);
      } else {
        // Strip transient fields like `restoring` before persisting.
        const persistable = recentClearedActions.map(e => ({
          id: e.id,
          kind: e.kind,
          timestamp: e.timestamp,
          snapshot: e.snapshot,
        }));
        window.localStorage.setItem(recentClearsStorageKey, JSON.stringify(persistable));
      }
    } catch {
      // Quota / privacy mode — best-effort only.
    }
  }, [recentClearedActions, recentClearsHydrated, recentClearsStorageKey]);

  const hasNonDefaultViewPrefs =
    searchTerm.trim() !== '' ||
    sort !== null ||
    showOverridesOnly ||
    overwriteExisting !== DEFAULT_VIEW_PREFS.overwriteExisting;

  const performDiscardPending = () => {
    setPendingChanges((prev) => {
      const count = prev.size;
      if (count > 0) {
        toast({
          title: 'Pending changes discarded',
          description: `Cleared ${count} unsaved row${count === 1 ? '' : 's'}.`,
        });
      }
      return new Map();
    });
  };

  const handleDiscardPendingClick = () => {
    if (skipDiscardConfirm) {
      performDiscardPending();
    } else {
      setRememberDiscardChoice(false);
      setConfirmDiscardPending(true);
    }
  };

  // Server-side audit trail of cleared-overrides actions. Persisted in
  // Mongo (in addition to the opt-in audit email) so admins who don't get
  // the email can review history and re-download the original CSV later.
  interface ClearedOverridesAuditEntry {
    id: string;
    actorEmail: string | null;
    deletedCount: number;
    createdAt: string;
  }
  interface ClearedOverridesAuditPage {
    entries: ClearedOverridesAuditEntry[];
    total: number;
    limit: number;
    offset: number;
  }

  // Filters for the cleared-overrides history panel. Live in component
  // state (not view prefs) since they're inherently transient: admins
  // typically narrow down to find a specific clear, not save the filter.
  const AUDIT_LOG_PAGE_SIZE = 25;
  const [auditFilterActor, setAuditFilterActor] = useState('');
  const [auditFilterCountry, setAuditFilterCountry] = useState('');
  const [auditFilterFrom, setAuditFilterFrom] = useState('');
  const [auditFilterTo, setAuditFilterTo] = useState('');
  const [auditPageOffset, setAuditPageOffset] = useState(0);

  // Reset offset alongside any filter change in the same event so we don't
  // fire a transient request with new filters + stale offset before a
  // useEffect could correct it.
  const updateAuditFilterActor = (value: string) => {
    setAuditFilterActor(value);
    setAuditPageOffset(0);
  };
  const updateAuditFilterCountry = (value: string) => {
    setAuditFilterCountry(value);
    setAuditPageOffset(0);
  };
  const updateAuditFilterFrom = (value: string) => {
    setAuditFilterFrom(value);
    setAuditPageOffset(0);
  };
  const updateAuditFilterTo = (value: string) => {
    setAuditFilterTo(value);
    setAuditPageOffset(0);
  };

  const auditLogQueryParams = useMemo(() => {
    const params: Record<string, string | number> = {
      limit: AUDIT_LOG_PAGE_SIZE,
      offset: auditPageOffset,
    };
    const actor = auditFilterActor.trim();
    if (actor) params.actorEmail = actor;
    const country = auditFilterCountry.trim();
    if (country) params.country = country;
    if (auditFilterFrom) params.from = auditFilterFrom;
    if (auditFilterTo) params.to = auditFilterTo;
    return params;
  }, [
    auditFilterActor,
    auditFilterCountry,
    auditFilterFrom,
    auditFilterTo,
    auditPageOffset,
  ]);

  const {
    data: clearedOverridesAuditLogPage,
    isLoading: isLoadingAuditLog,
    isError: isAuditLogError,
    refetch: refetchAuditLog,
  } = useQuery<ClearedOverridesAuditPage>({
    queryKey: [
      '/api/admin/country-language-mappings/cleared-overrides-log',
      auditLogQueryParams,
    ],
    placeholderData: (prev) => prev,
  });
  const clearedOverridesAuditLog = clearedOverridesAuditLogPage?.entries;
  const auditLogTotal = clearedOverridesAuditLogPage?.total ?? 0;
  const auditFiltersActive =
    auditFilterActor.trim() !== '' ||
    auditFilterCountry.trim() !== '' ||
    auditFilterFrom !== '' ||
    auditFilterTo !== '';
  const handleResetAuditFilters = () => {
    setAuditFilterActor('');
    setAuditFilterCountry('');
    setAuditFilterFrom('');
    setAuditFilterTo('');
    setAuditPageOffset(0);
  };
  const [downloadingAuditId, setDownloadingAuditId] = useState<string | null>(null);

  const handleDownloadAuditCsv = async (entry: ClearedOverridesAuditEntry) => {
    if (downloadingAuditId) return;
    setDownloadingAuditId(entry.id);
    try {
      const url = resolveApiUrl(
        `/api/admin/country-language-mappings/cleared-overrides-log/${entry.id}/csv`,
      );
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const when = new Date(entry.createdAt);
      const yyyy = when.getFullYear();
      const mm = String(when.getMonth() + 1).padStart(2, '0');
      const dd = String(when.getDate()).padStart(2, '0');
      const filename = `country-overrides-${yyyy}-${mm}-${dd}.csv`;
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unable to download audit CSV';
      toast({
        title: 'Failed to download CSV',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setDownloadingAuditId(null);
    }
  };

  // Fetch available countries
  const { data: countries, isLoading: isLoadingCountries } = useQuery<Country[]>({
    queryKey: ['/api/admin/available-countries'],
  });

  // Fetch available languages
  const { data: languages, isLoading: isLoadingLanguages } = useQuery<Language[]>({
    queryKey: ['/api/admin/available-languages'],
  });

  // Fetch existing mappings
  const { data: existingMappings, isLoading: isLoadingMappings } = useQuery<CountryLanguageMapping[]>({
    queryKey: ['/api/admin/country-language-mappings'],
  });

  // Fetch hardcoded country-language defaults (COUNTRY_TO_LANGUAGE)
  const { data: countryLanguageDefaults, isLoading: isLoadingDefaults } = useQuery<CountryLanguageDefault[]>({
    queryKey: ['/api/admin/country-language-defaults'],
  });

  // Create a map of existing mappings for quick lookup
  const mappingsMap = useMemo(() => {
    const map = new Map<string, string>();
    existingMappings?.forEach(mapping => {
      map.set(mapping.countryCode, mapping.languageCode);
    });
    return map;
  }, [existingMappings]);

  // Create a map of countryCode -> updatedAt for quick lookup
  const updatedAtMap = useMemo(() => {
    const map = new Map<string, string>();
    existingMappings?.forEach(mapping => {
      if (mapping.updatedAt) {
        map.set(mapping.countryCode, mapping.updatedAt);
      }
    });
    return map;
  }, [existingMappings]);

  // Create a map of hardcoded defaults for quick lookup
  const defaultsMap = useMemo(() => {
    const map = new Map<string, string>();
    countryLanguageDefaults?.forEach(d => {
      map.set(d.countryCode, d.languageCode);
    });
    return map;
  }, [countryLanguageDefaults]);

  // Create a map of language code -> language name for quick lookup
  const languageNameMap = useMemo(() => {
    const map = new Map<string, string>();
    languages?.forEach(lang => {
      map.set(lang.code, lang.name);
    });
    return map;
  }, [languages]);

  // Bulk save mutation
  const bulkSaveMutation = useMutation({
    mutationFn: async (mappings: Array<{ countryCode: string; countryName: string; languageCode: string }>) => {
      return await apiRequest('POST', '/api/admin/country-language-mappings/bulk', {
        body: { mappings },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/country-language-mappings'] });
      setPendingChanges(new Map());
      toast({
        title: 'Success',
        description: 'Country-language mappings saved successfully',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save mappings',
        variant: 'destructive',
      });
    },
  });

  // Delete a single country-language mapping
  const deleteMappingMutation = useMutation({
    mutationFn: async (countryCode: string) => {
      return await apiRequest(
        'DELETE',
        `/api/admin/country-language-mappings/${countryCode}`,
      );
    },
    onSuccess: (_data, countryCode) => {
      // Drop any pending change for this country so the UI returns to "unmapped"
      setPendingChanges(prev => {
        if (!prev.has(countryCode)) return prev;
        const next = new Map(prev);
        next.delete(countryCode);
        return next;
      });
      // Optimistically remove the deleted mapping from the cache so the row's
      // dropdown and trash button update immediately, without waiting for the
      // invalidated query to refetch.
      queryClient.setQueryData<CountryLanguageMapping[]>(
        ['/api/admin/country-language-mappings'],
        (old) => (old ? old.filter(m => m.countryCode !== countryCode) : old),
      );
      queryClient.invalidateQueries({ queryKey: ['/api/admin/country-language-mappings'] });
      toast({
        title: 'Mapping cleared',
        description: 'The country mapping was removed and will fall back to the default language.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to clear mapping',
        variant: 'destructive',
      });
    },
  });

  // Restore a previously-cleared snapshot of overridden mappings. Powers the
  // "Undo" action shown in the toast after Clear overrides.
  const restoreOverridesMutation = useMutation<
    { success: boolean; restoredCount: number; mappings?: CountryLanguageMapping[] },
    Error,
    CountryLanguageMapping[]
  >({
    mutationFn: async (snapshot) => {
      const payload = snapshot.map(m => ({
        countryCode: m.countryCode,
        countryName: m.countryName,
        languageCode: m.languageCode,
        isActive: m.isActive,
        notes: m.notes,
      }));
      const res = await apiRequest('POST', '/api/admin/country-language-mappings/restore', {
        body: { mappings: payload },
      });
      return (await res.json()) as {
        success: boolean;
        restoredCount: number;
        mappings?: CountryLanguageMapping[];
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/country-language-mappings'] });
      const restored = data?.restoredCount ?? 0;
      toast({
        title: 'Mappings restored',
        description:
          restored > 0
            ? `Restored ${restored} ${restored === 1 ? 'mapping' : 'mappings'}.`
            : 'Nothing to restore.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to restore mappings',
        variant: 'destructive',
      });
    },
  });

  // Delete only the overridden mappings (those whose language differs from the
  // hardcoded COUNTRY_TO_LANGUAGE default). Other mappings are left intact.
  // We capture the full overridden documents in `onMutate` so the toast's
  // "Undo" action can restore them exactly as they were (countryCode →
  // languageCode, plus countryName / notes / isActive).
  const clearOverridesMutation = useMutation<
    { success: boolean; deletedCount: number },
    Error,
    void,
    { snapshot: CountryLanguageMapping[] }
  >({
    mutationFn: async () => {
      const res = await apiRequest('DELETE', '/api/admin/country-language-mappings/overrides');
      return (await res.json()) as { success: boolean; deletedCount: number };
    },
    onMutate: () => {
      const snapshot = (existingMappings ?? []).filter(m => {
        const def = defaultsMap.get(m.countryCode);
        return !!def && m.languageCode !== def;
      });
      return { snapshot };
    },
    onSuccess: (data, _vars, context) => {
      const deleted = data?.deletedCount ?? 0;
      // Drop pending edits for any country whose DB mapping was just removed,
      // so the row returns to "Default" instead of showing a stale pending value.
      setPendingChanges(prev => {
        if (prev.size === 0) return prev;
        const next = new Map<string, string>();
        prev.forEach((value, code) => {
          const existing = mappingsMap.get(code);
          const def = defaultsMap.get(code);
          const wasOverride = !!existing && !!def && existing !== def;
          if (!wasOverride) next.set(code, value);
        });
        return next;
      });
      // Optimistically drop overridden mappings from the cache so the
      // overrides-only filter shows the empty state immediately.
      queryClient.setQueryData<CountryLanguageMapping[]>(
        ['/api/admin/country-language-mappings'],
        (old) => {
          if (!old) return old;
          return old.filter(m => {
            const def = defaultsMap.get(m.countryCode);
            return !def || m.languageCode === def;
          });
        },
      );
      queryClient.invalidateQueries({ queryKey: ['/api/admin/country-language-mappings'] });
      // The server persists an audit entry on every Clear overrides — refresh
      // the in-page history panel so the new row shows up immediately.
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/country-language-mappings/cleared-overrides-log'],
      });

      const snapshot = context?.snapshot ?? [];
      const canUndo = deleted > 0 && snapshot.length > 0;

      // Log this clear into the recent-actions panel so it remains
      // recoverable after the toast's ~10s Undo window expires. We hold
      // onto the new entry's id so the toast's Undo button can drop the
      // matching panel row when it restores — keeping the panel strictly
      // a list of *still-recoverable* clears.
      const recentEntryId = canUndo
        ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : null;
      if (canUndo && recentEntryId) {
        setRecentClearedActions(prev => {
          const entry: RecentClearAction = {
            id: recentEntryId,
            kind: 'cleared-overrides',
            timestamp: Date.now(),
            snapshot,
          };
          return [entry, ...prev].slice(0, RECENT_CLEAR_ACTIONS_LIMIT);
        });
      }

      const { dismiss } = toast({
        title: deleted > 0 ? 'Overrides cleared' : 'No overrides to clear',
        description:
          deleted > 0
            ? `Removed ${deleted} ${deleted === 1 ? 'override' : 'overrides'}. Affected countries will fall back to their default language.`
            : 'No mappings differed from their hardcoded default.',
        // Give admins ~10s to react. Radix's default auto-close is ~5s, so
        // we explicitly extend the duration on the Toast.Root via this prop
        // (the underlying ToastPrimitives.Root forwards `duration`).
        duration: canUndo ? 10000 : 5000,
        action: canUndo ? (
          <ToastAction
            altText="Undo clearing overrides"
            data-testid="button-undo-clear-overrides"
            onClick={() => {
              restoreOverridesMutation.mutate(snapshot, {
                onSuccess: () => {
                  // Drop the matching panel entry so the history only
                  // shows clears that haven't been restored yet.
                  if (recentEntryId) {
                    setRecentClearedActions(prev =>
                      prev.filter(e => e.id !== recentEntryId),
                    );
                  }
                },
              });
              dismiss();
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to clear overrides',
        variant: 'destructive',
      });
    },
  });

  // Delete all country-language mappings. Captures the full snapshot in
  // `onMutate` so the toast's "Undo" action can restore every mapping
  // (countryCode, countryName, languageCode, isActive, notes) exactly as
  // it was, reusing the existing /restore endpoint.
  const resetAllMutation = useMutation<
    { success: boolean; deletedCount: number },
    Error,
    void,
    { snapshot: CountryLanguageMapping[] }
  >({
    mutationFn: async () => {
      const res = await apiRequest('DELETE', '/api/admin/country-language-mappings');
      return (await res.json()) as { success: boolean; deletedCount: number };
    },
    onMutate: () => {
      const snapshot = (existingMappings ?? []).map(m => ({ ...m }));
      return { snapshot };
    },
    onSuccess: (data, _vars, context) => {
      // Clear any pending changes since the table is now empty
      setPendingChanges(new Map());
      // Optimistically empty the cache so the UI updates immediately
      queryClient.setQueryData<CountryLanguageMapping[]>(
        ['/api/admin/country-language-mappings'],
        [],
      );
      queryClient.invalidateQueries({ queryKey: ['/api/admin/country-language-mappings'] });
      const count = data?.deletedCount ?? 0;

      const snapshot = context?.snapshot ?? [];
      const canUndo = count > 0 && snapshot.length > 0;

      // Mirror the Clear-overrides flow: log a snapshot into the recent
      // bulk actions panel so admins can recover the full mappings list
      // after the toast Undo window expires. Reset all is the most
      // destructive action on the page, so this safety net matters most
      // here.
      const recentEntryId = canUndo
        ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : null;
      if (canUndo && recentEntryId) {
        setRecentClearedActions(prev => {
          const entry: RecentClearAction = {
            id: recentEntryId,
            kind: 'reset-all',
            timestamp: Date.now(),
            snapshot,
          };
          return [entry, ...prev].slice(0, RECENT_CLEAR_ACTIONS_LIMIT);
        });
      }

      const { dismiss } = toast({
        title: count > 0 ? 'All mappings cleared' : 'No mappings to clear',
        description: count > 0
          ? `Removed ${count} ${count === 1 ? 'mapping' : 'mappings'}. All countries will fall back to defaults.`
          : 'All mappings have been removed.',
        duration: canUndo ? 10000 : 5000,
        action: canUndo ? (
          <ToastAction
            altText="Undo resetting all mappings"
            data-testid="button-undo-reset-all"
            onClick={() => {
              restoreOverridesMutation.mutate(snapshot, {
                onSuccess: () => {
                  if (recentEntryId) {
                    setRecentClearedActions(prev =>
                      prev.filter(e => e.id !== recentEntryId),
                    );
                  }
                },
              });
              dismiss();
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to clear all mappings',
        variant: 'destructive',
      });
    },
  });

  const hasPendingChanges = pendingChanges.size > 0;
  const isSaving = bulkSaveMutation.isPending || deleteMappingMutation.isPending;

  // Detect macOS so the Save Changes tooltip shows ⌘S there and Ctrl+S
  // everywhere else. Guard against SSR / non-browser envs.
  const isMacPlatform = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const platform = navigator.platform || '';
    const ua = navigator.userAgent || '';
    return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(ua);
  }, []);
  const saveShortcutLabel = isMacPlatform ? '⌘S' : 'Ctrl+S';
  const saveShortcutHint = `Save changes (${saveShortcutLabel})`;

  // Ctrl+S / Cmd+S triggers the same save flow as the Save Changes button.
  // We only intercept (and suppress the browser's Save Page dialog) when
  // there's actually something to save and no save is already in flight.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isSaveShortcut =
        (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's';
      if (!isSaveShortcut) return;
      if (!hasPendingChanges || isSaving) return;
      e.preventDefault();
      void handleBulkSave();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Warn before leaving the page (tab close / reload / external navigation)
  // and before in-app navigation when there are unsaved per-row edits.
  useEffect(() => {
    if (!hasPendingChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for Chrome to show the prompt; modern browsers display
      // their own generic message regardless of the string returned.
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    const confirmMessage =
      'You have unsaved mapping changes. If you leave this page, those changes will be lost. Continue?';

    // Suppresses a redundant prompt from the pushState wrapper when an
    // in-app link click has already been confirmed in the click handler.
    // wouter's <Link> calls history.pushState synchronously after the
    // click event resolves, so a short-lived flag is sufficient.
    let suppressNextPushPrompt = false;

    // 1) Capture-phase click handler for in-app <a href> links (wouter's
    //    <Link> renders standard anchors). Runs before wouter's handler
    //    so we can preventDefault on cancel without mutating history.
    const handleLinkClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.origin !== window.location.origin) return;
      // Pure hash / same-route changes don't unmount this page.
      if (
        anchor.pathname === window.location.pathname &&
        anchor.search === window.location.search
      ) {
        return;
      }

      if (!window.confirm(confirmMessage)) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        // Already confirmed — suppress the duplicate prompt that
        // wouter's pushState call would otherwise trigger.
        suppressNextPushPrompt = true;
        // Clear the flag after the current task in case wouter's
        // pushState never runs (e.g. router prevents it for some
        // reason), so we don't accidentally swallow a later prompt.
        queueMicrotask(() => {
          suppressNextPushPrompt = false;
        });
      }
    };
    document.addEventListener('click', handleLinkClick, true);

    // 2) Programmatic navigation: wouter's setLocation calls
    //    history.pushState. We narrowly wrap pushState to confirm only
    //    when the target URL is a real route change (different
    //    pathname/search), avoiding false positives for same-route
    //    state updates (e.g. ?tab= toggles handled in-place).
    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    const isRealRouteChange = (urlArg: unknown): boolean => {
      if (urlArg == null) return false;
      try {
        const next = new URL(String(urlArg), window.location.href);
        if (next.origin !== window.location.origin) return false;
        return (
          next.pathname !== window.location.pathname ||
          next.search !== window.location.search
        );
      } catch {
        return false;
      }
    };
    window.history.pushState = function patchedPushState(
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      if (suppressNextPushPrompt) {
        suppressNextPushPrompt = false;
        return originalPushState(data, unused, url);
      }
      if (isRealRouteChange(url) && !window.confirm(confirmMessage)) {
        return;
      }
      return originalPushState(data, unused, url);
    } as typeof window.history.pushState;
    window.history.replaceState = function patchedReplaceState(
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      if (suppressNextPushPrompt) {
        suppressNextPushPrompt = false;
        return originalReplaceState(data, unused, url);
      }
      if (isRealRouteChange(url) && !window.confirm(confirmMessage)) {
        return;
      }
      return originalReplaceState(data, unused, url);
    } as typeof window.history.replaceState;

    // 3) Browser back/forward: popstate fires *after* the URL changes,
    //    so we can't preventDefault. On cancel, push the mappings URL
    //    onto the stack so the user lands back on this page. We only
    //    add an entry on an *active* cancel — no entries are added
    //    proactively, so saving and leaving cleanly leaves no stray
    //    history entries.
    const guardedHref = window.location.href;
    const handlePopState = () => {
      if (window.confirm(confirmMessage)) {
        return; // let navigation proceed; component will unmount
      }
      originalPushState(null, '', guardedHref);
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleLinkClick, true);
      window.removeEventListener('popstate', handlePopState);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, [hasPendingChanges]);

  // Restore a single entry from the recent-cleared-actions panel. Reuses
  // the existing restore mutation, then drops the entry on success so the
  // panel reflects what's still recoverable.
  const handleRestoreRecent = async (id: string) => {
    const entry = recentClearedActions.find(e => e.id === id);
    if (!entry || entry.restoring) return;
    setRecentClearedActions(prev =>
      prev.map(e => (e.id === id ? { ...e, restoring: true } : e)),
    );
    try {
      await restoreOverridesMutation.mutateAsync(entry.snapshot);
      setRecentClearedActions(prev => prev.filter(e => e.id !== id));
    } catch {
      setRecentClearedActions(prev =>
        prev.map(e => (e.id === id ? { ...e, restoring: false } : e)),
      );
    }
  };

  const handleDismissRecent = (id: string) => {
    setRecentClearedActions(prev => prev.filter(e => e.id !== id));
  };

  // Restore every still-recoverable entry in the recent bulk actions panel
  // sequentially. Failures are surfaced per-entry and leave that row in the
  // panel so the admin can retry, while successful entries are removed from
  // both state and persisted localStorage.
  const [isRestoringAllRecent, setIsRestoringAllRecent] = useState(false);
  const handleRestoreAllRecent = async () => {
    if (isRestoringAllRecent) return;
    const targets = recentClearedActions.filter(e => !e.restoring);
    if (targets.length === 0) return;
    setIsRestoringAllRecent(true);
    setRecentClearedActions(prev =>
      prev.map(e =>
        targets.some(t => t.id === e.id) ? { ...e, restoring: true } : e,
      ),
    );
    let successCount = 0;
    let restoredMappingCount = 0;
    const failures: { entry: RecentClearAction; message: string }[] = [];
    // Call the restore endpoint directly here (instead of going through
    // restoreOverridesMutation) so we don't fire one success toast per
    // entry — the bulk action emits a single summary toast at the end.
    for (const entry of targets) {
      try {
        const payload = entry.snapshot.map(m => ({
          countryCode: m.countryCode,
          countryName: m.countryName,
          languageCode: m.languageCode,
          isActive: m.isActive,
          notes: m.notes,
        }));
        const res = await apiRequest(
          'POST',
          '/api/admin/country-language-mappings/restore',
          { body: { mappings: payload } },
        );
        const data = (await res.json()) as {
          success: boolean;
          restoredCount: number;
        };
        setRecentClearedActions(prev => prev.filter(e => e.id !== entry.id));
        successCount += 1;
        restoredMappingCount += data?.restoredCount ?? 0;
      } catch (err: any) {
        const message = err?.message || 'Failed to restore mappings';
        const when = new Date(entry.timestamp).toLocaleString();
        const label =
          entry.kind === 'reset-all' ? 'Reset all mappings' : 'Cleared overrides';
        toast({
          title: `Failed to restore ${label}`,
          description: `${when} (${entry.snapshot.length} ${entry.snapshot.length === 1 ? 'entry' : 'entries'}): ${message}`,
          variant: 'destructive',
        });
        setRecentClearedActions(prev =>
          prev.map(e => (e.id === entry.id ? { ...e, restoring: false } : e)),
        );
        failures.push({ entry, message });
      }
    }
    setIsRestoringAllRecent(false);
    if (successCount > 0) {
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/country-language-mappings'],
      });
      toast({
        title:
          failures.length > 0
            ? 'Restored with some failures'
            : 'All recent clears restored',
        description: `Restored ${restoredMappingCount} ${restoredMappingCount === 1 ? 'mapping' : 'mappings'} from ${successCount} of ${targets.length} ${targets.length === 1 ? 'entry' : 'entries'}.${failures.length > 0 ? ` ${failures.length} left in the panel to retry.` : ''}`,
        variant: failures.length > 0 ? 'destructive' : undefined,
      });
    }
  };

  // Handle language change for a country
  const handleLanguageChange = (countryCode: string, languageCode: string) => {
    const newChanges = new Map(pendingChanges);
    // Sentinel value "__none__" means "no mapping" — store as empty string in pending changes
    newChanges.set(countryCode, languageCode === '__none__' ? '' : languageCode);
    setPendingChanges(newChanges);
  };

  // Get effective language for a country (pending change or existing mapping)
  const getEffectiveLanguage = (countryCode: string): string => {
    return pendingChanges.get(countryCode) || mappingsMap.get(countryCode) || '';
  };

  // Auto-fill from hardcoded defaults
  const handleAutoFill = () => {
    if (!countries || countries.length === 0) {
      toast({
        title: 'No countries loaded',
        description: 'Country list is not available yet',
        variant: 'destructive',
      });
      return;
    }

    if (defaultsMap.size === 0) {
      toast({
        title: 'No defaults available',
        description: 'Hardcoded country-language defaults could not be loaded',
        variant: 'destructive',
      });
      return;
    }

    const newChanges = new Map(pendingChanges);
    let filledCount = 0;

    countries.forEach(country => {
      const defaultLanguage = defaultsMap.get(country.code);
      if (!defaultLanguage) return;

      const existingMapping = mappingsMap.get(country.code);
      const hasPending = pendingChanges.has(country.code);

      if (overwriteExisting) {
        // Overwrite mode: only set if it would actually change something
        const currentEffective = hasPending
          ? pendingChanges.get(country.code)
          : existingMapping || '';
        if (currentEffective !== defaultLanguage) {
          newChanges.set(country.code, defaultLanguage);
          filledCount++;
        }
      } else {
        // Default mode: only fill countries with no DB mapping AND no pending change
        if (!existingMapping && !hasPending) {
          newChanges.set(country.code, defaultLanguage);
          filledCount++;
        }
      }
    });

    if (filledCount === 0) {
      toast({
        title: 'Nothing to fill',
        description: overwriteExisting
          ? 'All countries already match their default language'
          : 'All countries already have a mapping or pending change. Enable "Overwrite existing" to replace them.',
      });
      return;
    }

    setPendingChanges(newChanges);
    toast({
      title: 'Auto-filled defaults',
      description: `Auto-filled ${filledCount} ${filledCount === 1 ? 'country' : 'countries'} — review and click Save Changes`,
    });
  };

  // Handle bulk save
  const handleBulkSave = async () => {
    if (pendingChanges.size === 0) {
      toast({
        title: 'No changes',
        description: 'No changes to save',
      });
      return;
    }

    // Split pending changes:
    //   - rows where the user picked "No mapping" (empty languageCode) must be
    //     DELETED via the per-country DELETE endpoint, otherwise the bulk save
    //     would silently no-op (the API rejects empty languageCode).
    //   - everything else is bulk-saved.
    const entries = Array.from(pendingChanges.entries());
    const toDelete = entries
      .filter(([countryCode, languageCode]) => !languageCode && mappingsMap.has(countryCode))
      .map(([countryCode]) => countryCode);
    const toUpsert = entries
      .filter(([, languageCode]) => !!languageCode)
      .map(([countryCode, languageCode]) => {
        const country = countries?.find(c => c.code === countryCode);
        return {
          countryCode,
          countryName: country?.name || countryCode,
          languageCode,
          isActive: true,
        };
      });

    try {
      // Run deletes sequentially so any error surfaces clearly.
      for (const countryCode of toDelete) {
        await deleteMappingMutation.mutateAsync(countryCode);
      }
      if (toUpsert.length > 0) {
        await bulkSaveMutation.mutateAsync(toUpsert);
      } else if (toDelete.length > 0) {
        // bulkSaveMutation's onSuccess clears pending changes; if we only
        // deleted, do the same here so the dirty-state badge resets.
        setPendingChanges(new Map());
      }
    } catch {
      // Individual mutation onError handlers already toast — nothing to do.
    }
  };

  // Filter countries based on search term
  const filteredCountries = useMemo(() => {
    if (!countries) return [];

    const term = searchTerm.trim().toLowerCase();
    let filtered = term
      ? countries.filter(
          country =>
            country.name.toLowerCase().includes(term) ||
            country.code.toLowerCase().includes(term)
        )
      : countries;

    if (showOverridesOnly) {
      filtered = filtered.filter(country => {
        const effective =
          pendingChanges.get(country.code) ?? mappingsMap.get(country.code) ?? '';
        const defaultLanguage = defaultsMap.get(country.code);
        return !!effective && !!defaultLanguage && effective !== defaultLanguage;
      });
    }

    if (!sort) return filtered;

    if (sort.column === 'updatedAt') {
      // Partition: rows with a valid updatedAt vs. rows without one.
      // Rows without updatedAt are always grouped at the bottom (alphabetical),
      // regardless of sort direction.
      const withDate: Array<{ country: Country; time: number }> = [];
      const withoutDate: Country[] = [];

      filtered.forEach(country => {
        const raw = updatedAtMap.get(country.code);
        const time = raw ? new Date(raw).getTime() : NaN;
        if (raw && !isNaN(time)) {
          withDate.push({ country, time });
        } else {
          withoutDate.push(country);
        }
      });

      withDate.sort((a, b) =>
        sort.direction === 'desc' ? b.time - a.time : a.time - b.time,
      );

      return [...withDate.map(entry => entry.country), ...withoutDate];
    }

    if (sort.column === 'country') {
      const sorted = [...filtered].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
      if (sort.direction === 'desc') sorted.reverse();
      return sorted;
    }

    if (sort.column === 'code') {
      const sorted = [...filtered].sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { sensitivity: 'base' }),
      );
      if (sort.direction === 'desc') sorted.reverse();
      return sorted;
    }

    // sort.column === 'status'
    // Status precedence (asc): Pending → Override → Mapped → Default.
    const statusRank = (country: Country): number => {
      if (pendingChanges.has(country.code)) return 0;
      const effective = mappingsMap.get(country.code) || '';
      if (!effective) return 3; // Default (no mapping)
      const def = defaultsMap.get(country.code);
      if (def && effective !== def) return 1; // Override
      return 2; // Mapped
    };

    const sorted = [...filtered].sort((a, b) => {
      const ra = statusRank(a);
      const rb = statusRank(b);
      if (ra !== rb) {
        return sort.direction === 'asc' ? ra - rb : rb - ra;
      }
      // Stable secondary sort by country name for predictability within a group.
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return sorted;
  }, [countries, searchTerm, sort, updatedAtMap, pendingChanges, mappingsMap, defaultsMap, showOverridesOnly]);

  const handleToggleSort = (column: SortColumn) => {
    setSort(prev => {
      if (!prev || prev.column !== column) {
        return { column, direction: 'desc' };
      }
      return { column, direction: prev.direction === 'desc' ? 'asc' : 'desc' };
    });
  };

  const renderSortIcon = (column: SortColumn) => {
    if (!sort || sort.column !== column) {
      return (
        <ChevronsUpDown
          className="h-4 w-4 opacity-50"
          data-testid={`icon-sort-${column}-none`}
          aria-hidden="true"
        />
      );
    }
    if (sort.direction === 'desc') {
      return (
        <ChevronDown
          className="h-4 w-4 text-foreground"
          data-testid={`icon-sort-${column}-desc`}
          aria-hidden="true"
        />
      );
    }
    return (
      <ChevronUp
        className="h-4 w-4 text-foreground"
        data-testid={`icon-sort-${column}-asc`}
        aria-hidden="true"
      />
    );
  };

  const ariaSortFor = (column: SortColumn): 'ascending' | 'descending' | 'none' => {
    if (!sort || sort.column !== column) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  };

  // Loading state
  if (isLoadingCountries || isLoadingLanguages || isLoadingMappings) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-10 w-full mb-4" />
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasChanges = hasPendingChanges;
  const mappedCount = countries?.filter(c => getEffectiveLanguage(c.code)).length || 0;
  const unmappedCount = (countries?.length || 0) - mappedCount;
  const overrideCount =
    countries?.filter(c => {
      const effective = getEffectiveLanguage(c.code);
      const def = defaultsMap.get(c.code);
      return !!effective && !!def && effective !== def;
    }).length || 0;
  // Counts only persisted DB mappings whose languageCode differs from the
  // hardcoded default. This is what the "Clear overrides" backend deletes,
  // so it must drive the button enabled state and the confirmation copy —
  // unsaved pending edits don't get touched by that action.
  const persistedOverrideCount =
    existingMappings?.filter(m => {
      const def = defaultsMap.get(m.countryCode);
      return !!def && m.languageCode !== def;
    }).length || 0;

  // Detailed list of overrides shown in the "Clear overrides" confirmation
  // dialog so admins can see exactly which countries will be reset and what
  // language each one will fall back to. Sorted alphabetically by country
  // name for predictable scanning.
  const persistedOverrides = useMemo(() => {
    if (!existingMappings) return [];
    return existingMappings
      .filter(m => {
        const def = defaultsMap.get(m.countryCode);
        return !!def && m.languageCode !== def;
      })
      .map(m => ({
        countryCode: m.countryCode,
        countryName: m.countryName || m.countryCode,
        currentLanguageCode: m.languageCode,
        defaultLanguageCode: defaultsMap.get(m.countryCode) || '',
      }))
      .sort((a, b) => a.countryName.localeCompare(b.countryName));
  }, [existingMappings, defaultsMap]);

  // Detailed list of every persisted mapping shown in the "Reset all mappings"
  // confirmation dialog so admins can audit exactly what will be deleted and
  // what each country will fall back to. Sorted alphabetically by country name.
  const persistedAllMappings = useMemo(() => {
    if (!existingMappings) return [];
    const countryNameMap = new Map<string, string>();
    countries?.forEach((c) => countryNameMap.set(c.code, c.name));
    return existingMappings
      .map((m) => ({
        countryCode: m.countryCode,
        countryName:
          countryNameMap.get(m.countryCode) || m.countryName || m.countryCode,
        currentLanguageCode: m.languageCode,
        defaultLanguageCode: defaultsMap.get(m.countryCode) || '',
      }))
      .sort((a, b) => a.countryName.localeCompare(b.countryName));
  }, [existingMappings, countries, defaultsMap]);

  const downloadOverridesCsv = () => {
    if (persistedOverrides.length === 0) return;
    const escape = (value: string) => {
      const needsQuoting = /[",\n\r]/.test(value);
      const escaped = value.replace(/"/g, '""');
      return needsQuoting ? `"${escaped}"` : escaped;
    };
    const header = ['Country Code', 'Country Name', 'Current Language', 'Fallback Language'];
    const rows = persistedOverrides.map((o) => {
      const currentName = languageNameMap.get(o.currentLanguageCode);
      const defaultName = languageNameMap.get(o.defaultLanguageCode);
      const current = currentName
        ? `${currentName} (${o.currentLanguageCode})`
        : o.currentLanguageCode;
      const fallback = defaultName
        ? `${defaultName} (${o.defaultLanguageCode})`
        : o.defaultLanguageCode;
      return [o.countryCode, o.countryName, current, fallback];
    });
    const csv = [header, ...rows]
      .map((cols) => cols.map((c) => escape(String(c))).join(','))
      .join('\r\n');
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const filename = `country-overrides-${yyyy}-${mm}-${dd}.csv`;
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Country-Language Mappings</CardTitle>
          <CardDescription>
            Configure which language each country should use for SEO and localization.
            Database mappings override hardcoded defaults.
          </CardDescription>
          <div className="flex items-center gap-4 mt-4">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>{mappedCount} Mapped</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <XCircle className="h-4 w-4 text-gray-400" />
              <span>{unmappedCount} Unmapped</span>
            </div>
            <div
              className="flex items-center gap-2 text-sm"
              data-testid="summary-overrides"
            >
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>{overrideCount} Overrides</span>
            </div>
            {hasChanges && (
              <div className="flex items-center gap-2 text-sm text-orange-500">
                <RefreshCw className="h-4 w-4" />
                <span>{pendingChanges.size} Pending Changes</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Search and Actions */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                data-testid="input-search-countries"
                placeholder="Search countries..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <ResetViewButton
              hasNonDefaultPrefs={hasNonDefaultViewPrefs}
              reset={resetViewPrefs}
              toastDescription="Search, sort, and toggles restored to defaults on this device and your account."
              title="Clear search, sort, and toggles on this device and your account"
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="show-overrides-only"
                data-testid="checkbox-show-overrides-only"
                checked={showOverridesOnly}
                onCheckedChange={(checked) => setShowOverridesOnly(checked === true)}
              />
              <Label
                htmlFor="show-overrides-only"
                className="text-sm font-normal cursor-pointer whitespace-nowrap"
              >
                Show overrides only
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="overwrite-existing"
                data-testid="checkbox-overwrite-existing"
                checked={overwriteExisting}
                onCheckedChange={(checked) => setOverwriteExisting(checked === true)}
              />
              <Label
                htmlFor="overwrite-existing"
                className="text-sm font-normal cursor-pointer whitespace-nowrap"
              >
                Overwrite existing
              </Label>
            </div>
            <Button
              data-testid="button-autofill-defaults"
              variant="outline"
              onClick={handleAutoFill}
              disabled={isLoadingDefaults || !countries || bulkSaveMutation.isPending}
            >
              <Wand2 className="mr-2 h-4 w-4" />
              Auto-fill from defaults
            </Button>
            <Button
              data-testid="button-clear-overrides"
              variant="outline"
              onClick={() => setConfirmClearOverrides(true)}
              disabled={
                persistedOverrideCount === 0 ||
                clearOverridesMutation.isPending ||
                resetAllMutation.isPending ||
                bulkSaveMutation.isPending
              }
              className="text-destructive hover:text-destructive"
            >
              {clearOverridesMutation.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Clear overrides
            </Button>
            <Button
              data-testid="button-reset-all-mappings"
              variant="outline"
              onClick={() => {
                if (skipResetAllConfirm) {
                  resetAllMutation.mutate();
                } else {
                  setRememberResetAllChoice(false);
                  setConfirmResetAll(true);
                }
              }}
              disabled={
                (existingMappings?.length || 0) === 0 ||
                resetAllMutation.isPending ||
                bulkSaveMutation.isPending
              }
              className="text-destructive hover:text-destructive"
            >
              {resetAllMutation.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash className="mr-2 h-4 w-4" />
              )}
              Reset all mappings
            </Button>
            {(skipDiscardConfirm || skipResetAllConfirm) && (
              <div
                data-testid="indicator-skip-confirm"
                className="flex items-center gap-1 text-xs text-muted-foreground"
                title="Confirmation dialogs were silenced for this session"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                <span className="hidden sm:inline">Confirmations off:</span>
                {skipDiscardConfirm && (
                  <Button
                    data-testid="button-reenable-discard-confirm"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs underline-offset-2 hover:underline"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.sessionStorage.removeItem('admin-mappings:skipDiscardConfirm');
                      }
                      setSkipDiscardConfirm(false);
                      toast({
                        title: 'Discard confirmation turned back on',
                      });
                    }}
                  >
                    Re-enable Discard
                  </Button>
                )}
                {skipResetAllConfirm && (
                  <Button
                    data-testid="button-reenable-reset-all-confirm"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs underline-offset-2 hover:underline"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.sessionStorage.removeItem('admin-mappings:skipResetAllConfirm');
                      }
                      setSkipResetAllConfirm(false);
                      toast({
                        title: 'Reset all confirmation turned back on',
                      });
                    }}
                  >
                    Re-enable Reset all
                  </Button>
                )}
              </div>
            )}
            {hasPendingChanges && (
              <Button
                data-testid="button-discard-pending"
                variant="outline"
                onClick={handleDiscardPendingClick}
                disabled={bulkSaveMutation.isPending}
              >
                <X className="mr-2 h-4 w-4" />
                Discard pending changes
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-testid="button-save-mappings"
                  onClick={handleBulkSave}
                  disabled={!hasChanges || bulkSaveMutation.isPending}
                  className="min-w-32"
                  aria-keyshortcuts={isMacPlatform ? 'Meta+S' : 'Control+S'}
                  title={saveShortcutHint}
                >
                  {bulkSaveMutation.isPending ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Changes
                      <kbd
                        data-testid="kbd-save-shortcut"
                        className="ml-2 hidden rounded border border-white/30 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium leading-none sm:inline-block"
                      >
                        {saveShortcutLabel}
                      </kbd>
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent data-testid="tooltip-save-shortcut">
                {saveShortcutHint}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Cleared overrides history: durable server-side audit trail of
               every Clear overrides action. Survives reloads, sessions, and
               admin device changes — separate from the local "Recent bulk
               actions" panel below which only powers the Undo flow. */}
          <div
            data-testid="panel-cleared-overrides-audit-log"
            className="mb-4 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/40"
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                <History className="h-4 w-4" />
                <span>Cleared overrides history</span>
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="text-cleared-overrides-audit-count"
                >
                  (server log, {auditLogTotal}
                  {auditFiltersActive ? ' match' : ' total'}
                  {auditLogTotal === 1 ? '' : auditFiltersActive ? 'es' : ''})
                </span>
              </div>
              <Button
                data-testid="button-refresh-cleared-overrides-audit"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => void refetchAuditLog()}
                disabled={isLoadingAuditLog}
              >
                <RefreshCw
                  className={`mr-2 h-3 w-3 ${isLoadingAuditLog ? 'animate-spin' : ''}`}
                />
                Refresh
              </Button>
            </div>
            {/* Filters: actor email, country (matched against snapshot
                country code/name), and a date range. All optional;
                changing any one resets back to page 1. */}
            <div
              data-testid="cleared-overrides-audit-filters"
              className="flex flex-wrap items-end gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700"
            >
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor="audit-filter-actor"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Actor email
                </Label>
                <Input
                  id="audit-filter-actor"
                  data-testid="input-audit-filter-actor"
                  type="search"
                  value={auditFilterActor}
                  onChange={(e) => updateAuditFilterActor(e.target.value)}
                  placeholder="e.g. alex@"
                  className="h-8 w-44 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor="audit-filter-country"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Country (code or name)
                </Label>
                <Input
                  id="audit-filter-country"
                  data-testid="input-audit-filter-country"
                  type="search"
                  value={auditFilterCountry}
                  onChange={(e) => updateAuditFilterCountry(e.target.value)}
                  placeholder="e.g. FR or France"
                  className="h-8 w-44 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor="audit-filter-from"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  From
                </Label>
                <Input
                  id="audit-filter-from"
                  data-testid="input-audit-filter-from"
                  type="date"
                  value={auditFilterFrom}
                  onChange={(e) => updateAuditFilterFrom(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor="audit-filter-to"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  To
                </Label>
                <Input
                  id="audit-filter-to"
                  data-testid="input-audit-filter-to"
                  type="date"
                  value={auditFilterTo}
                  onChange={(e) => updateAuditFilterTo(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
              </div>
              <Button
                data-testid="button-reset-audit-filters"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={handleResetAuditFilters}
                disabled={!auditFiltersActive}
              >
                <X className="mr-1 h-3 w-3" />
                Reset filters
              </Button>
            </div>
            {isLoadingAuditLog ? (
              <div
                className="px-4 py-3 text-sm text-muted-foreground"
                data-testid="text-cleared-overrides-audit-loading"
              >
                Loading history...
              </div>
            ) : isAuditLogError ? (
              <div
                className="px-4 py-3 text-sm text-destructive"
                data-testid="text-cleared-overrides-audit-error"
              >
                Failed to load history.
              </div>
            ) : !clearedOverridesAuditLog || clearedOverridesAuditLog.length === 0 ? (
              <div
                className="px-4 py-3 text-sm text-muted-foreground"
                data-testid="text-cleared-overrides-audit-empty"
              >
                {auditFiltersActive
                  ? 'No clears match the current filters.'
                  : 'No clears recorded yet.'}
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {clearedOverridesAuditLog.map((entry) => {
                  const when = new Date(entry.createdAt);
                  const whenValid = !isNaN(when.getTime());
                  const isDownloading = downloadingAuditId === entry.id;
                  return (
                    <li
                      key={entry.id}
                      data-testid={`row-cleared-overrides-audit-${entry.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-gray-700 dark:text-gray-200">
                        <Trash2 className="h-4 w-4 text-amber-500" />
                        <span>
                          Cleared {entry.deletedCount}{' '}
                          {entry.deletedCount === 1 ? 'override' : 'overrides'}
                        </span>
                        {whenValid && (
                          <span
                            className="text-xs text-muted-foreground"
                            title={when.toLocaleString()}
                            data-testid={`text-cleared-overrides-audit-time-${entry.id}`}
                          >
                            · {formatDistanceToNow(when, { addSuffix: true })}
                          </span>
                        )}
                        <span
                          className="text-xs text-muted-foreground"
                          data-testid={`text-cleared-overrides-audit-actor-${entry.id}`}
                        >
                          · by {entry.actorEmail || '(unknown admin)'}
                        </span>
                      </div>
                      <Button
                        data-testid={`button-download-cleared-overrides-audit-${entry.id}`}
                        size="sm"
                        variant="outline"
                        onClick={() => void handleDownloadAuditCsv(entry)}
                        disabled={isDownloading || entry.deletedCount === 0}
                      >
                        {isDownloading ? (
                          <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-3 w-3" />
                        )}
                        Download CSV
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            {/* Pagination footer. Shown whenever there's more than one
                page of matches (current limit covers fewer rows than the
                total). Uses prev/next buttons over a fixed page size. */}
            {!isLoadingAuditLog && !isAuditLogError && auditLogTotal > AUDIT_LOG_PAGE_SIZE && (
              <div
                data-testid="cleared-overrides-audit-pagination"
                className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-2 text-xs text-muted-foreground dark:border-gray-700"
              >
                <span data-testid="text-audit-pagination-range">
                  Showing {auditPageOffset + 1}–
                  {Math.min(
                    auditPageOffset + AUDIT_LOG_PAGE_SIZE,
                    auditLogTotal,
                  )}{' '}
                  of {auditLogTotal}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    data-testid="button-audit-page-prev"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() =>
                      setAuditPageOffset((o) =>
                        Math.max(0, o - AUDIT_LOG_PAGE_SIZE),
                      )
                    }
                    disabled={auditPageOffset === 0 || isLoadingAuditLog}
                  >
                    Previous
                  </Button>
                  <Button
                    data-testid="button-audit-page-next"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() =>
                      setAuditPageOffset(
                        (o) => o + AUDIT_LOG_PAGE_SIZE,
                      )
                    }
                    disabled={
                      auditPageOffset + AUDIT_LOG_PAGE_SIZE >= auditLogTotal ||
                      isLoadingAuditLog
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Recent bulk actions: snapshots of recently cleared overrides
               with per-entry Restore so admins can recover after the toast
               Undo window expires. */}
          {recentClearedActions.length > 0 && (
            <div
              data-testid="panel-recent-bulk-actions"
              className="mb-4 rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40"
            >
              <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                  <History className="h-4 w-4" />
                  <span>Recent bulk actions</span>
                  <span className="text-xs text-muted-foreground">
                    (last {RECENT_CLEAR_ACTIONS_LIMIT})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    data-testid="button-restore-all-recent-actions"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void handleRestoreAllRecent()}
                    disabled={
                      isRestoringAllRecent ||
                      recentClearedActions.length === 0 ||
                      recentClearedActions.every(e => e.restoring)
                    }
                  >
                    {isRestoringAllRecent ? (
                      <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
                    ) : (
                      <Undo2 className="mr-2 h-3 w-3" />
                    )}
                    Restore all
                  </Button>
                  <Button
                    data-testid="button-clear-recent-actions"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setRecentClearedActions([])}
                    disabled={isRestoringAllRecent}
                  >
                    Clear history
                  </Button>
                </div>
              </div>
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {recentClearedActions.map((entry) => {
                  const count = entry.snapshot.length;
                  const when = new Date(entry.timestamp);
                  const isResetAll = entry.kind === 'reset-all';
                  const ActionIcon = isResetAll ? Trash : Trash2;
                  const iconColor = isResetAll ? 'text-destructive' : 'text-amber-500';
                  const label = isResetAll
                    ? `Reset all mappings (${count} ${count === 1 ? 'mapping' : 'mappings'})`
                    : `Cleared overrides (${count} ${count === 1 ? 'override' : 'overrides'})`;
                  return (
                    <li
                      key={entry.id}
                      data-testid={`row-recent-action-${entry.id}`}
                      data-action-kind={entry.kind}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                        <ActionIcon className={`h-4 w-4 ${iconColor}`} />
                        <span>{label}</span>
                        <span
                          className="text-xs text-muted-foreground"
                          title={when.toLocaleString()}
                        >
                          · {formatDistanceToNow(when, { addSuffix: true })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          data-testid={`button-restore-recent-${entry.id}`}
                          size="sm"
                          variant="outline"
                          onClick={() => void handleRestoreRecent(entry.id)}
                          disabled={entry.restoring}
                        >
                          {entry.restoring ? (
                            <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
                          ) : (
                            <Undo2 className="mr-2 h-3 w-3" />
                          )}
                          Restore
                        </Button>
                        <Button
                          data-testid={`button-dismiss-recent-${entry.id}`}
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground"
                          onClick={() => handleDismissRecent(entry.id)}
                          disabled={entry.restoring}
                          aria-label="Dismiss recent action"
                          title="Dismiss"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Unsaved changes banner */}
          {hasPendingChanges && (
            <div
              data-testid="banner-unsaved-changes"
              role="status"
              aria-live="polite"
              className="sticky top-0 z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-orange-500/40 bg-orange-50 px-4 py-3 shadow-sm dark:bg-orange-950/40"
            >
              <div className="flex items-center gap-2 text-sm text-orange-900 dark:text-orange-100">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                <span>
                  You have {pendingChanges.size} unsaved{' '}
                  {pendingChanges.size === 1 ? 'change' : 'changes'}.
                </span>
              </div>
              <div className="flex items-center gap-2">
              <Button
                data-testid="button-discard-pending-banner"
                size="sm"
                variant="outline"
                onClick={handleDiscardPendingClick}
                disabled={bulkSaveMutation.isPending}
              >
                <X className="mr-2 h-4 w-4" />
                Discard
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid="button-save-mappings-banner"
                    size="sm"
                    onClick={handleBulkSave}
                    disabled={bulkSaveMutation.isPending}
                    aria-keyshortcuts={isMacPlatform ? 'Meta+S' : 'Control+S'}
                    title={saveShortcutHint}
                  >
                    {bulkSaveMutation.isPending ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Changes
                        <kbd
                          data-testid="kbd-save-shortcut-banner"
                          className="ml-2 hidden rounded border border-white/30 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium leading-none sm:inline-block"
                        >
                          {saveShortcutLabel}
                        </kbd>
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent data-testid="tooltip-save-shortcut-banner">
                  {saveShortcutHint}
                </TooltipContent>
              </Tooltip>
              </div>
            </div>
          )}

          {/* Mappings Table */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="w-24 p-0" aria-sort={ariaSortFor('code')}>
                    <button
                      type="button"
                      data-testid="button-sort-code"
                      onClick={() => handleToggleSort('code')}
                      aria-label={
                        sort?.column === 'code' && sort.direction === 'desc'
                          ? 'Sorted by code, Z to A. Click to sort A to Z.'
                          : sort?.column === 'code' && sort.direction === 'asc'
                            ? 'Sorted by code, A to Z. Click to sort Z to A.'
                            : 'Sort by code'
                      }
                      className="inline-flex w-full items-center justify-start gap-1 px-4 py-3 text-sm font-medium hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    >
                      <span>Code</span>
                      {renderSortIcon('code')}
                    </button>
                  </TableHead>
                  <TableHead className="p-0" aria-sort={ariaSortFor('country')}>
                    <button
                      type="button"
                      data-testid="button-sort-country"
                      onClick={() => handleToggleSort('country')}
                      aria-label={
                        sort?.column === 'country' && sort.direction === 'desc'
                          ? 'Sorted by country, Z to A. Click to sort A to Z.'
                          : sort?.column === 'country' && sort.direction === 'asc'
                            ? 'Sorted by country, A to Z. Click to sort Z to A.'
                            : 'Sort by country'
                      }
                      className="inline-flex w-full items-center justify-start gap-1 px-4 py-3 text-sm font-medium hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    >
                      <span>Country</span>
                      {renderSortIcon('country')}
                    </button>
                  </TableHead>
                  <TableHead className="w-64">Language</TableHead>
                  <TableHead className="w-24 p-0" aria-sort={ariaSortFor('status')}>
                    <button
                      type="button"
                      data-testid="button-sort-status"
                      onClick={() => handleToggleSort('status')}
                      aria-label={
                        sort?.column === 'status' && sort.direction === 'desc'
                          ? 'Sorted by status, reverse order. Click to group by status.'
                          : sort?.column === 'status' && sort.direction === 'asc'
                            ? 'Grouped by status. Click to reverse order.'
                            : 'Sort by status'
                      }
                      className="inline-flex w-full items-center justify-start gap-1 px-4 py-3 text-sm font-medium hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    >
                      <span>Status</span>
                      {renderSortIcon('status')}
                    </button>
                  </TableHead>
                  <TableHead
                    className="w-40 text-right p-0"
                    aria-sort={ariaSortFor('updatedAt')}
                  >
                    <button
                      type="button"
                      data-testid="button-sort-updated-at"
                      onClick={() => handleToggleSort('updatedAt')}
                      aria-label={
                        sort?.column === 'updatedAt' && sort.direction === 'desc'
                          ? 'Sorted by last updated, newest first. Click to sort oldest first.'
                          : sort?.column === 'updatedAt' && sort.direction === 'asc'
                            ? 'Sorted by last updated, oldest first. Click to sort newest first.'
                            : 'Sort by last updated'
                      }
                      className="inline-flex w-full items-center justify-end gap-1 px-4 py-3 text-sm font-medium hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    >
                      <span>Last updated</span>
                      {renderSortIcon('updatedAt')}
                    </button>
                  </TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCountries.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-8 text-muted-foreground"
                      data-testid="text-empty-state"
                    >
                      {showOverridesOnly
                        ? searchTerm.trim()
                          ? 'No overrides match your search.'
                          : 'No overrides yet — every mapped country uses its default language.'
                        : 'No countries found'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCountries.map((country, index) => {
                    const effectiveLanguage = getEffectiveLanguage(country.code);
                    const hasPendingChange = pendingChanges.has(country.code);
                    const isMapped = !!effectiveLanguage;
                    const hasDbMapping = mappingsMap.has(country.code);
                    const isClearingThis =
                      deleteMappingMutation.isPending &&
                      deleteMappingMutation.variables === country.code;
                    const defaultLanguageCode = defaultsMap.get(country.code);
                    const defaultLanguageName = defaultLanguageCode
                      ? languageNameMap.get(defaultLanguageCode) || defaultLanguageCode
                      : null;
                    const noMappingLabel = defaultLanguageName
                      ? `No mapping (default: ${defaultLanguageName})`
                      : 'No mapping (Default to English)';
                    const updatedAtRaw = updatedAtMap.get(country.code);
                    const updatedAtDate = updatedAtRaw ? new Date(updatedAtRaw) : null;
                    const updatedAtValid =
                      updatedAtDate && !isNaN(updatedAtDate.getTime()) ? updatedAtDate : null;
                    const isOverride =
                      isMapped &&
                      !!defaultLanguageCode &&
                      effectiveLanguage !== defaultLanguageCode;
                    const overrideTitle =
                      isOverride && defaultLanguageName
                        ? `Overrides default (${defaultLanguageName})`
                        : undefined;

                    return (
                      <TableRow
                        key={country.code}
                        data-testid={`row-country-${country.code}`}
                        className={hasPendingChange ? 'bg-orange-50 dark:bg-orange-950/20' : ''}
                      >
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-mono text-sm">{country.code}</TableCell>
                        <TableCell className="font-medium">{country.name}</TableCell>
                        <TableCell>
                          <Select
                            data-testid={`select-language-${country.code}`}
                            value={effectiveLanguage || '__none__'}
                            onValueChange={(value) => handleLanguageChange(country.code, value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select language..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">{noMappingLabel}</SelectItem>
                              {languages?.map((lang) => (
                                <SelectItem key={lang.code} value={lang.code}>
                                  {lang.name} ({lang.code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {hasPendingChange ? (
                            <span className="inline-flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                              <RefreshCw className="h-3 w-3" />
                              Pending
                            </span>
                          ) : isOverride ? (
                            <span
                              data-testid={`status-override-${country.code}`}
                              title={overrideTitle}
                              className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Override
                            </span>
                          ) : isMapped ? (
                            <span
                              data-testid={`status-mapped-${country.code}`}
                              className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Mapped
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                              <XCircle className="h-3 w-3" />
                              Default
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-right text-xs text-muted-foreground tabular-nums"
                          data-testid={`text-updated-at-${country.code}`}
                        >
                          {updatedAtValid ? (
                            <span title={updatedAtValid.toLocaleString()}>
                              {formatDistanceToNow(updatedAtValid, { addSuffix: true })}
                            </span>
                          ) : (
                            <span aria-hidden="true">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {hasDbMapping ? (
                            <Button
                              data-testid={`button-clear-mapping-${country.code}`}
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              title="Clear mapping"
                              aria-label={`Clear mapping for ${country.name}`}
                              onClick={() => setPendingDelete(country)}
                              disabled={isClearingThis}
                            >
                              {isClearingThis ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Summary */}
          {filteredCountries.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              Showing {filteredCountries.length} of {countries?.length || 0} countries
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent className="bg-white border border-gray-200 shadow-lg text-gray-900" data-testid="dialog-confirm-clear-mapping">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear mapping?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `This will remove the database mapping for ${pendingDelete.name} (${pendingDelete.code}). The country will fall back to its hardcoded default language.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear-mapping">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-clear-mapping"
              onClick={() => {
                if (pendingDelete) {
                  deleteMappingMutation.mutate(pendingDelete.code);
                  setPendingDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear mapping
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmClearOverrides}
        onOpenChange={(open) => {
          if (!open) setConfirmClearOverrides(false);
        }}
      >
        <AlertDialogContent
          className="bg-white border border-gray-200 shadow-lg text-gray-900"
          data-testid="dialog-confirm-clear-overrides"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Clear overridden mappings?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the {persistedOverrideCount} saved country{' '}
              {persistedOverrideCount === 1 ? 'mapping' : 'mappings'} that differ from the
              hardcoded defaults. Those countries will fall back to their default language.
              Saved mappings that already match the default are kept as-is, and any unsaved
              edits in the table are not affected. You'll have a brief Undo window
              (about 10 seconds) in the toast after this runs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {persistedOverrides.length > 0 && (
            <div
              className="max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-gray-50"
              data-testid="list-clear-overrides-preview"
            >
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-100 text-left text-xs uppercase tracking-wide text-gray-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">Country</th>
                    <th className="px-3 py-2 font-medium">Current</th>
                    <th className="px-3 py-2 font-medium">Falls back to</th>
                  </tr>
                </thead>
                <tbody>
                  {persistedOverrides.map((o) => {
                    const currentName = languageNameMap.get(o.currentLanguageCode);
                    const defaultName = languageNameMap.get(o.defaultLanguageCode);
                    return (
                      <tr
                        key={o.countryCode}
                        className="border-t border-gray-200"
                        data-testid={`row-clear-overrides-preview-${o.countryCode}`}
                      >
                        <td className="px-3 py-2">
                          <span className="font-medium text-gray-900">{o.countryName}</span>{' '}
                          <span className="text-xs text-gray-500">({o.countryCode})</span>
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {currentName
                            ? `${currentName} (${o.currentLanguageCode})`
                            : o.currentLanguageCode}
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {defaultName
                            ? `${defaultName} (${o.defaultLanguageCode})`
                            : o.defaultLanguageCode}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              data-testid="button-download-overrides-csv"
              onClick={() => downloadOverridesCsv()}
              disabled={persistedOverrides.length === 0}
              className="sm:mr-auto"
            >
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
            <AlertDialogCancel data-testid="button-cancel-clear-overrides">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-clear-overrides"
              onClick={() => {
                clearOverridesMutation.mutate();
                setConfirmClearOverrides(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear overrides
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmResetAll}
        onOpenChange={(open) => {
          if (!open) setConfirmResetAll(false);
        }}
      >
        <AlertDialogContent className="bg-white border border-gray-200 shadow-lg text-gray-900" data-testid="dialog-confirm-reset-all">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all mappings?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all {existingMappings?.length || 0} country-language
              mappings from the database. Every country will fall back to its hardcoded default
              language. You'll have a brief window to undo this from the toast.
              {hasPendingChanges && (
                <span className="mt-2 block font-medium text-destructive" data-testid="text-reset-all-pending-warning">
                  You also have {pendingChanges.size} unsaved row{pendingChanges.size === 1 ? '' : 's'} of pending edits. Those changes will be discarded along with the database mappings.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {persistedAllMappings.length > 0 && (
            <>
              <div
                className="text-sm text-gray-700"
                data-testid="text-reset-all-preview-summary"
              >
                {persistedAllMappings.length}{' '}
                {persistedAllMappings.length === 1 ? 'mapping' : 'mappings'} will be
                deleted:
              </div>
              <div
                className="max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-gray-50"
                data-testid="list-reset-all-preview"
              >
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-100 text-left text-xs uppercase tracking-wide text-gray-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">Country</th>
                      <th className="px-3 py-2 font-medium">Current</th>
                      <th className="px-3 py-2 font-medium">Falls back to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {persistedAllMappings.map((m) => {
                      const currentName = languageNameMap.get(m.currentLanguageCode);
                      const defaultName = m.defaultLanguageCode
                        ? languageNameMap.get(m.defaultLanguageCode)
                        : undefined;
                      return (
                        <tr
                          key={m.countryCode}
                          className="border-t border-gray-200"
                          data-testid={`row-reset-all-preview-${m.countryCode}`}
                        >
                          <td className="px-3 py-2">
                            <span className="font-medium text-gray-900">
                              {m.countryName}
                            </span>{' '}
                            <span className="text-xs text-gray-500">
                              ({m.countryCode})
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {currentName
                              ? `${currentName} (${m.currentLanguageCode})`
                              : m.currentLanguageCode}
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {m.defaultLanguageCode
                              ? defaultName
                                ? `${defaultName} (${m.defaultLanguageCode})`
                                : m.defaultLanguageCode
                              : <span className="text-gray-500 italic">No default</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="reset-all-skip-confirm"
              data-testid="checkbox-reset-all-skip-confirm"
              checked={rememberResetAllChoice}
              onCheckedChange={(c) => setRememberResetAllChoice(c === true)}
            />
            <Label
              htmlFor="reset-all-skip-confirm"
              className="text-sm font-normal text-gray-700"
            >
              Don't ask again this session
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset-all">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-reset-all"
              onClick={() => {
                if (rememberResetAllChoice) {
                  setSkipResetAllConfirm(true);
                  if (typeof window !== 'undefined') {
                    window.sessionStorage.setItem('admin-mappings:skipResetAllConfirm', '1');
                  }
                }
                resetAllMutation.mutate();
                setConfirmResetAll(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reset all mappings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDiscardPending}
        onOpenChange={(open) => {
          if (!open) setConfirmDiscardPending(false);
        }}
      >
        <AlertDialogContent className="bg-white border border-gray-200 shadow-lg text-gray-900" data-testid="dialog-confirm-discard-pending">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard pending changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear your {pendingChanges.size} unsaved row{pendingChanges.size === 1 ? '' : 's'} of pending edits. Saved mappings in the database won't be touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="discard-pending-skip-confirm"
              data-testid="checkbox-discard-pending-skip-confirm"
              checked={rememberDiscardChoice}
              onCheckedChange={(c) => setRememberDiscardChoice(c === true)}
            />
            <Label
              htmlFor="discard-pending-skip-confirm"
              className="text-sm font-normal text-gray-700"
            >
              Don't ask again this session
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-discard-pending">
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-discard-pending"
              onClick={() => {
                if (rememberDiscardChoice) {
                  setSkipDiscardConfirm(true);
                  if (typeof window !== 'undefined') {
                    window.sessionStorage.setItem('admin-mappings:skipDiscardConfirm', '1');
                  }
                }
                setConfirmDiscardPending(false);
                performDiscardPending();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
