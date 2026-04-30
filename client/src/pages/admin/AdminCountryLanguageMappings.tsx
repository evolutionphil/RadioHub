import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
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
import { Search, Save, RefreshCw, CheckCircle2, XCircle, Wand2, Trash2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
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

export default function AdminCountryLanguageMappings() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingChanges, setPendingChanges] = useState<Map<string, string>>(new Map());
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Country | null>(null);

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
  const handleBulkSave = () => {
    if (pendingChanges.size === 0) {
      toast({
        title: 'No changes',
        description: 'No changes to save',
      });
      return;
    }

    const mappings = Array.from(pendingChanges.entries()).map(([countryCode, languageCode]) => {
      const country = countries?.find(c => c.code === countryCode);
      return {
        countryCode,
        countryName: country?.name || countryCode,
        languageCode,
        isActive: true,
      };
    });

    bulkSaveMutation.mutate(mappings);
  };

  // Filter countries based on search term
  const filteredCountries = useMemo(() => {
    if (!countries) return [];
    if (!searchTerm) return countries;

    const term = searchTerm.toLowerCase();
    return countries.filter(
      country =>
        country.name.toLowerCase().includes(term) ||
        country.code.toLowerCase().includes(term)
    );
  }, [countries, searchTerm]);

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

  const hasChanges = pendingChanges.size > 0;
  const mappedCount = countries?.filter(c => getEffectiveLanguage(c.code)).length || 0;
  const unmappedCount = (countries?.length || 0) - mappedCount;

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

          {/* Mappings Table */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="w-64">Language</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCountries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No countries found
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
                          ) : isMapped ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
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
        <AlertDialogContent data-testid="dialog-confirm-clear-mapping">
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
    </div>
  );
}
