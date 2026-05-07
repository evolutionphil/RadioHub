import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAdminViewPrefs } from '@/hooks/useAdminViewPrefs';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Search, Save, RefreshCw, CheckCircle2, XCircle, Wand2, Trash2, Trash, AlertTriangle, ChevronUp, ChevronDown, ChevronsUpDown, X } from 'lucide-react';
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
  const { prefs, setPrefs } = useAdminViewPrefs<ViewPrefs>(
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

  const hasActiveFilters =
    searchTerm.trim() !== '' || sort !== null || showOverridesOnly;

  const handleClearFilters = () => {
    setPrefs((p) => ({ ...p, searchTerm: '', sort: null, showOverridesOnly: false }));
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

  // Delete only the overridden mappings (those whose language differs from the
  // hardcoded COUNTRY_TO_LANGUAGE default). Other mappings are left intact.
  const clearOverridesMutation = useMutation<{ success: boolean; deletedCount: number }>({
    mutationFn: async () => {
      const res = await apiRequest('DELETE', '/api/admin/country-language-mappings/overrides');
      return (await res.json()) as { success: boolean; deletedCount: number };
    },
    onSuccess: (data) => {
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
      toast({
        title: deleted > 0 ? 'Overrides cleared' : 'No overrides to clear',
        description: deleted > 0
          ? `Removed ${deleted} ${deleted === 1 ? 'override' : 'overrides'}. Affected countries will fall back to their default language.`
          : 'No mappings differed from their hardcoded default.',
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

  // Delete all country-language mappings
  const resetAllMutation = useMutation<{ success: boolean; deletedCount: number }>({
    mutationFn: async () => {
      const res = await apiRequest('DELETE', '/api/admin/country-language-mappings');
      return (await res.json()) as { success: boolean; deletedCount: number };
    },
    onSuccess: (data) => {
      // Clear any pending changes since the table is now empty
      setPendingChanges(new Map());
      // Optimistically empty the cache so the UI updates immediately
      queryClient.setQueryData<CountryLanguageMapping[]>(
        ['/api/admin/country-language-mappings'],
        [],
      );
      queryClient.invalidateQueries({ queryKey: ['/api/admin/country-language-mappings'] });
      const count = data?.deletedCount ?? 0;
      toast({
        title: 'All mappings cleared',
        description: count > 0
          ? `Removed ${count} ${count === 1 ? 'mapping' : 'mappings'}. All countries will fall back to defaults.`
          : 'All mappings have been removed.',
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
            <Button
              data-testid="button-clear-filters"
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              disabled={!hasActiveFilters}
              className="whitespace-nowrap"
            >
              <X className="mr-2 h-4 w-4" />
              Clear filters
            </Button>
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
              onClick={() => setConfirmResetAll(true)}
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
            {hasPendingChanges && (
              <Button
                data-testid="button-discard-pending"
                variant="outline"
                onClick={() => setConfirmDiscardPending(true)}
                disabled={bulkSaveMutation.isPending}
              >
                <X className="mr-2 h-4 w-4" />
                Discard pending changes
              </Button>
            )}
            <Button
              data-testid="button-save-mappings"
              onClick={handleBulkSave}
              disabled={!hasChanges || bulkSaveMutation.isPending}
              className="min-w-32"
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
                </>
              )}
            </Button>
          </div>

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
                onClick={() => setConfirmDiscardPending(true)}
                disabled={bulkSaveMutation.isPending}
              >
                <X className="mr-2 h-4 w-4" />
                Discard
              </Button>
              <Button
                data-testid="button-save-mappings-banner"
                size="sm"
                onClick={handleBulkSave}
                disabled={bulkSaveMutation.isPending}
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
                  </>
                )}
              </Button>
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
              edits in the table are not affected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
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
              language. This action cannot be undone.
              {hasPendingChanges && (
                <span className="mt-2 block font-medium text-destructive" data-testid="text-reset-all-pending-warning">
                  You also have {pendingChanges.size} unsaved row{pendingChanges.size === 1 ? '' : 's'} of pending edits. Those changes will be discarded along with the database mappings.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset-all">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-reset-all"
              onClick={() => {
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
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-discard-pending">
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-discard-pending"
              onClick={() => {
                const count = pendingChanges.size;
                setPendingChanges(new Map());
                setConfirmDiscardPending(false);
                toast({
                  title: 'Pending changes discarded',
                  description: `Cleared ${count} unsaved row${count === 1 ? '' : 's'}.`,
                });
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
