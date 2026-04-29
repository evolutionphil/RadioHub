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
import { Search, Save, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

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

export default function AdminCountryLanguageMappings() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingChanges, setPendingChanges] = useState<Map<string, string>>(new Map());

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

  // Create a map of existing mappings for quick lookup
  const mappingsMap = useMemo(() => {
    const map = new Map<string, string>();
    existingMappings?.forEach(mapping => {
      map.set(mapping.countryCode, mapping.languageCode);
    });
    return map;
  }, [existingMappings]);

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
          <div className="flex items-center gap-4 mb-6">
            <div className="relative flex-1">
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCountries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No countries found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCountries.map((country, index) => {
                    const effectiveLanguage = getEffectiveLanguage(country.code);
                    const hasPendingChange = pendingChanges.has(country.code);
                    const isMapped = !!effectiveLanguage;

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
                              <SelectItem value="__none__">No mapping (Default to English)</SelectItem>
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
    </div>
  );
}
