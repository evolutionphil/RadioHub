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
import { Search, Save, RefreshCw, Sparkles, Languages } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';

interface UrlTranslation {
  _id?: string;
  languageCode: string;
  englishPath: string;
  translatedPath: string;
  isActive: boolean;
  notes?: string;
}

interface Language {
  code: string;
  name: string;
}

// Supported languages dynamically loaded from SEO config
// This ensures admin interface stays in sync with all enabled SEO languages
const SUPPORTED_LANGUAGES: Language[] = SEO_LANGUAGES
  .filter(lang => lang.enabled)
  .map(lang => ({
    code: lang.code,
    name: lang.name
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export default function AdminUrlTranslations() {
  const { toast } = useToast();
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingChanges, setPendingChanges] = useState<Map<string, string>>(new Map());
  const [isAutoTranslating, setIsAutoTranslating] = useState(false);

  // Fetch available English paths
  const { data: apiPaths, isLoading: isLoadingPaths } = useQuery<string[]>({
    queryKey: ['/api/admin/url-translations/available-paths'],
  });

  // Use static URL_TRANSLATIONS as fallback when API returns empty
  const availablePaths = useMemo(() => {
    if (apiPaths && apiPaths.length > 0) {
      return apiPaths;
    }
    // Fallback to static translations from URL_TRANSLATIONS
    // Get all unique English paths from all languages
    const allPaths = new Set<string>();
    Object.values(URL_TRANSLATIONS).forEach(langTranslations => {
      Object.keys(langTranslations).forEach(path => allPaths.add(path));
    });
    return Array.from(allPaths).sort();
  }, [apiPaths]);

  // Fetch existing translations from database
  const { data: existingTranslations, isLoading: isLoadingTranslations } = useQuery<UrlTranslation[]>({
    queryKey: ['/api/admin/url-translations'],
  });

  // Create a map of existing translations for quick lookup
  const translationsMap = useMemo(() => {
    const map = new Map<string, string>();
    existingTranslations?.forEach(translation => {
      const key = `${translation.languageCode}:${translation.englishPath}`;
      map.set(key, translation.translatedPath);
    });
    return map;
  }, [existingTranslations]);

  // Bulk save mutation
  const bulkSaveMutation = useMutation({
    mutationFn: async (translations: Array<{ languageCode: string; englishPath: string; translatedPath: string }>) => {
      return await apiRequest('POST', '/api/admin/url-translations/bulk', {
        body: { translations },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/url-translations'] });
      setPendingChanges(new Map());
      toast({
        title: 'Success',
        description: 'URL translations saved successfully',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save translations',
        variant: 'destructive',
      });
    },
  });

  // Auto-translate mutation
  const autoTranslateMutation = useMutation({
    mutationFn: async ({ languageCode, paths }: { languageCode: string; paths: string[] }) => {
      return await apiRequest('POST', '/api/admin/url-translations/auto-translate', {
        body: { languageCode, paths },
      });
    },
    onSuccess: (data: any) => {
      // Apply the auto-translated paths to pending changes
      const newChanges = new Map(pendingChanges);
      Object.entries(data.translations).forEach(([englishPath, translatedPath]) => {
        const key = `${data.languageCode}:${englishPath}`;
        newChanges.set(key, translatedPath as string);
      });
      setPendingChanges(newChanges);
      
      toast({
        title: 'Auto-translation Complete',
        description: `Translated ${Object.keys(data.translations).length} paths to ${data.language}`,
      });
      setIsAutoTranslating(false);
    },
    onError: (error: any) => {
      toast({
        title: 'Auto-translation Failed',
        description: error.message || 'Failed to auto-translate',
        variant: 'destructive',
      });
      setIsAutoTranslating(false);
    },
  });

  // Handle translation change for a path
  const handleTranslationChange = (languageCode: string, englishPath: string, translatedPath: string) => {
    const key = `${languageCode}:${englishPath}`;
    const newChanges = new Map(pendingChanges);
    newChanges.set(key, translatedPath);
    setPendingChanges(newChanges);
  };

  // Get effective translation for a path (pending change or existing mapping or static translation)
  const getEffectiveTranslation = (languageCode: string, englishPath: string): string => {
    const key = `${languageCode}:${englishPath}`;
    // Priority: pending changes > database > static translations
    return pendingChanges.get(key) || 
           translationsMap.get(key) || 
           URL_TRANSLATIONS[languageCode]?.[englishPath] || 
           '';
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

    const translations = Array.from(pendingChanges.entries()).map(([key, translatedPath]) => {
      const [languageCode, englishPath] = key.split(':');
      return {
        languageCode,
        englishPath,
        translatedPath,
      };
    });

    bulkSaveMutation.mutate(translations);
  };

  // Handle auto-translate for selected language
  const handleAutoTranslate = () => {
    if (!selectedLanguage) {
      toast({
        title: 'No language selected',
        description: 'Please select a language to auto-translate',
      });
      return;
    }

    if (!availablePaths || availablePaths.length === 0) {
      toast({
        title: 'No paths available',
        description: 'No paths available to translate',
      });
      return;
    }

    setIsAutoTranslating(true);
    
    // Get paths that don't have translations yet
    const pathsToTranslate = availablePaths.filter(path => {
      const key = `${selectedLanguage}:${path}`;
      return !translationsMap.has(key) && !pendingChanges.has(key);
    });

    if (pathsToTranslate.length === 0) {
      toast({
        title: 'All paths translated',
        description: 'All paths already have translations for this language',
      });
      setIsAutoTranslating(false);
      return;
    }

    autoTranslateMutation.mutate({
      languageCode: selectedLanguage,
      paths: pathsToTranslate,
    });
  };

  // Filter paths based on search term
  const filteredPaths = useMemo(() => {
    if (!availablePaths) return [];
    if (!searchTerm) return availablePaths;

    const term = searchTerm.toLowerCase();
    return availablePaths.filter(path => path.toLowerCase().includes(term));
  }, [availablePaths, searchTerm]);

  // Loading state
  if (isLoadingPaths || isLoadingTranslations) {
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
  const totalPaths = availablePaths?.length || 0;
  
  // Count translations for selected language
  const translatedCount = selectedLanguage
    ? availablePaths?.filter(path => {
        const key = `${selectedLanguage}:${path}`;
        return translationsMap.has(key) || pendingChanges.has(key);
      }).length || 0
    : 0;

  return (
    <div className="container mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Languages className="h-6 w-6" />
                URL Translations Manager
              </CardTitle>
              <CardDescription>
                Manage multilingual URL paths for SEO-friendly URLs. Database translations override static files.
              </CardDescription>
            </div>
            {selectedLanguage && (
              <Badge variant="outline" className="text-base px-4 py-2">
                {SUPPORTED_LANGUAGES.find(l => l.code === selectedLanguage)?.name || selectedLanguage}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Language Selection and Actions */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1">
              <Select
                value={selectedLanguage}
                onValueChange={setSelectedLanguage}
                data-testid="select-language"
              >
                <SelectTrigger data-testid="select-trigger-language">
                  <SelectValue placeholder="Select a language to manage..." />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name} ({lang.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {selectedLanguage && (
              <>
                <Button
                  data-testid="button-auto-translate"
                  onClick={handleAutoTranslate}
                  disabled={isAutoTranslating || autoTranslateMutation.isPending}
                  variant="outline"
                >
                  {isAutoTranslating || autoTranslateMutation.isPending ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Translating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Auto-Translate (OpenAI)
                    </>
                  )}
                </Button>
                
                <Button
                  data-testid="button-save-translations"
                  onClick={handleBulkSave}
                  disabled={!hasChanges || bulkSaveMutation.isPending}
                >
                  {bulkSaveMutation.isPending ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Changes ({pendingChanges.size})
                    </>
                  )}
                </Button>
              </>
            )}
          </div>

          {selectedLanguage && (
            <>
              {/* Progress indicator */}
              <div className="mb-4 flex items-center gap-4 text-sm text-muted-foreground">
                <span>
                  Progress: {translatedCount} / {totalPaths} paths translated
                </span>
                {hasChanges && (
                  <Badge variant="secondary">{pendingChanges.size} pending changes</Badge>
                )}
              </div>

              {/* Search */}
              <div className="relative mb-6">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  data-testid="input-search-paths"
                  placeholder="Search paths..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Translations Table */}
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead className="w-1/3">English Path</TableHead>
                      <TableHead className="w-1/3">Translated Path</TableHead>
                      <TableHead className="w-1/3">Example URL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPaths.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          No paths found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredPaths.map((path, index) => {
                        const effectiveTranslation = getEffectiveTranslation(selectedLanguage, path);
                        const key = `${selectedLanguage}:${path}`;
                        const hasPendingChange = pendingChanges.has(key);

                        return (
                          <TableRow
                            key={path}
                            data-testid={`row-path-${path}`}
                            className={hasPendingChange ? 'bg-orange-50 dark:bg-orange-950/20' : ''}
                          >
                            <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                            <TableCell className="font-mono text-sm">{path}</TableCell>
                            <TableCell>
                              <Input
                                data-testid={`input-translation-${path}`}
                                value={effectiveTranslation}
                                onChange={(e) => handleTranslationChange(selectedLanguage, path, e.target.value)}
                                placeholder={`Enter translation for "${path}"`}
                                className={hasPendingChange ? 'border-orange-500' : ''}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              /{selectedLanguage}/{effectiveTranslation || path}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Summary */}
              {filteredPaths.length > 0 && (
                <div className="mt-4 text-sm text-muted-foreground">
                  Showing {filteredPaths.length} of {totalPaths} paths
                </div>
              )}
            </>
          )}

          {!selectedLanguage && (
            <div className="text-center py-12 text-muted-foreground">
              <Languages className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">Select a language to begin</p>
              <p className="text-sm mt-2">Choose a language from the dropdown above to manage its URL translations</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
