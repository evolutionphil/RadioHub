import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";

interface FiltersProps {
  search: string;
  country: string;
  language: string;
  genre: string;
  hasDescriptions?: 'all' | 'yes' | 'no' | 'partial';
  tagsStatus?: 'all' | 'empty-cooldown' | 'never-checked';
  onSearchChange: (value: string) => void;
  onCountryChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onGenreChange: (value: string) => void;
  onHasDescriptionsChange?: (value: 'all' | 'yes' | 'no' | 'partial') => void;
  onTagsStatusChange?: (value: 'all' | 'empty-cooldown' | 'never-checked') => void;
}

export default function Filters({
  search,
  country,
  language,
  genre,
  hasDescriptions,
  tagsStatus,
  onSearchChange,
  onCountryChange,
  onLanguageChange,
  onGenreChange,
  onHasDescriptionsChange,
  onTagsStatusChange,
}: FiltersProps) {
  const { t } = useTranslation();
  
  // Get unique values from existing stations instead of reference collections
  const { data: countries, isLoading: countriesLoading, error: countriesError } = useQuery({
    queryKey: ['/api/filters/countries'],
    queryFn: () => api.getStationCountries(),
  });

  const { data: languages, isLoading: languagesLoading, error: languagesError } = useQuery({
    queryKey: ['/api/filters/languages'],
    queryFn: () => api.getStationLanguages(),
  });

  const { data: genres, isLoading: genresLoading, error: genresError } = useQuery({
    queryKey: ['/api/filters/genres'],
    queryFn: () => api.getStationGenres(),
  });



  return (
    <div className="px-3 sm:px-6 py-4 bg-gray-50 border-b border-gray-200">
      <div className="flex flex-col space-y-4">
        {/* Search bar */}
        <div className="w-full">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="w-4 h-4 text-gray-400" />
            </div>
            <Input
              type="text"
              placeholder={t('filter_search_placeholder', 'Search stations...')}
              className="pl-10 w-full"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        </div>

        {/* Filter dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Select value={country || "all"} onValueChange={(value) => onCountryChange(value === "all" ? "" : value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('filter_all_countries', 'All Countries')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filter_all_countries', 'All Countries')}</SelectItem>
              {countriesLoading && (
                <SelectItem value="loading" disabled>{t('filter_loading_countries', 'Loading countries...')}</SelectItem>
              )}
              {countriesError && (
                <SelectItem value="error" disabled>{t('filter_error_loading_countries', 'Error loading countries')}</SelectItem>
              )}
              {countries?.map((country) => (
                <SelectItem key={typeof country === 'string' ? country : country.name} value={typeof country === 'string' ? country : country.name}>
                  {typeof country === 'string' ? country : country.name}
                  {typeof country === 'object' && country.stationCount && ` (${country.stationCount})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={language || "all"} onValueChange={(value) => onLanguageChange(value === "all" ? "" : value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('filter_all_languages', 'All Languages')} />
            </SelectTrigger>
            <SelectContent className="max-h-[300px] overflow-y-auto">
              <SelectItem value="all">{t('filter_all_languages', 'All Languages')}</SelectItem>
              {languagesLoading && (
                <SelectItem value="loading" disabled>{t('filter_loading_languages', 'Loading languages...')}</SelectItem>
              )}
              {languagesError && (
                <SelectItem value="error" disabled>{t('filter_error_loading_languages', 'Error loading languages')}</SelectItem>
              )}
              {languages?.map((language) => (
                <SelectItem key={language} value={language}>
                  {language}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={genre || "all"} onValueChange={(value) => onGenreChange(value === "all" ? "" : value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('filter_all_genres', 'All Genres')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filter_all_genres', 'All Genres')}</SelectItem>
              {genresLoading && (
                <SelectItem value="loading" disabled>{t('filter_loading_genres', 'Loading genres...')}</SelectItem>
              )}
              {genresError && (
                <SelectItem value="error" disabled>{t('filter_error_loading_genres', 'Error loading genres')}</SelectItem>
              )}
              {genres?.slice(0, 50).map((genre) => (
                <SelectItem key={genre} value={genre}>
                  {genre.startsWith('"') && genre.endsWith('"') ? genre.slice(1, -1) : genre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {onHasDescriptionsChange && (
            <Select value={hasDescriptions || "all"} onValueChange={(value) => onHasDescriptionsChange(value as 'all' | 'yes' | 'no' | 'partial')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="AI Descriptions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stations</SelectItem>
                <SelectItem value="yes">Has Descriptions</SelectItem>
                <SelectItem value="no">No Descriptions</SelectItem>
                <SelectItem value="partial">Partial (Missing Languages)</SelectItem>
              </SelectContent>
            </Select>
          )}

          {onTagsStatusChange && (
            <Select
              value={tagsStatus || "all"}
              onValueChange={(value) =>
                onTagsStatusChange(value as 'all' | 'empty-cooldown' | 'never-checked')
              }
            >
              <SelectTrigger className="w-full" title="Filter by Radio-Browser tag re-check status">
                <SelectValue placeholder="Tag re-check status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tag statuses</SelectItem>
                <SelectItem value="empty-cooldown">Stuck on empty (in cooldown)</SelectItem>
                <SelectItem value="never-checked">Tagless &amp; never re-checked</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </div>
  );
}
