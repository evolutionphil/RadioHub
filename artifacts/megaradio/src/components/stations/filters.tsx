import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminHealthFilter } from '@/lib/admin-station-list';
import { useTranslation } from '@/hooks/useTranslation';

interface FiltersProps {
  search: string; country: string; language: string; genre: string; codec?: string;
  hasDescriptions?: 'all' | 'yes' | 'no' | 'partial';
  tagsStatus?: 'all' | 'empty-cooldown' | 'never-checked';
  hasLogo?: 'all' | 'yes' | 'no';
  healthStatus?: AdminHealthFilter;
  mode?: 'stations' | 'duplicates' | 'blacklist';
  onSearchChange: (value: string) => void;
  onCountryChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onGenreChange: (value: string) => void;
  onCodecChange?: (value: string) => void;
  onHasDescriptionsChange?: (value: 'all' | 'yes' | 'no' | 'partial') => void;
  onTagsStatusChange?: (value: 'all' | 'empty-cooldown' | 'never-checked') => void;
  onHasLogoChange?: (value: 'all' | 'yes' | 'no') => void;
  onHealthStatusChange?: (value: AdminHealthFilter) => void;
  onReset?: () => void;
}

function Choice({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: [string, string][]; onChange: (value: any) => void }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>
    <Select value={value} onValueChange={onChange}><SelectTrigger id={id} className="bg-background"><SelectValue /></SelectTrigger><SelectContent>
      {options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}
    </SelectContent></Select>
  </div>;
}

function SearchableChoice({ id, label, placeholder, status, value, options, onChange }: { id: string; label: string; placeholder: string; status?: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>
    <Input id={id} value={value} onChange={event => onChange(event.target.value)} list={id + '-options'} placeholder={placeholder} className="bg-background" autoComplete="off" aria-describedby={status ? id + '-status' : undefined} />
    <datalist id={id + '-options'}>{[...new Set(options.filter(Boolean))].map(option => <option key={option} value={option} />)}</datalist>
    {status && <p id={id + '-status'} role="status" className="text-xs text-muted-foreground">{status}</p>}
  </div>;
}

export default function Filters(props: FiltersProps) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const mode = props.mode || 'stations';
  const options = useQuery({
    queryKey: ['/api/admin/stations/filter-options'], queryFn: () => api.getAdminStationFilterOptions(),
    enabled: mode !== 'blacklist', staleTime: 300_000,
  });
  const advancedCount = [props.language, props.genre,
    ...(mode === 'stations' ? [props.codec, props.hasDescriptions === 'all' ? '' : props.hasDescriptions, props.tagsStatus === 'all' ? '' : props.tagsStatus, props.hasLogo === 'all' ? '' : props.hasLogo] : []),
  ].filter(Boolean).length;
  const activeCount = [props.search, ...(mode !== 'blacklist' ? [props.country] : []), ...(mode === 'stations' && props.healthStatus !== 'all' ? [props.healthStatus] : [])].filter(Boolean).length + (mode === 'blacklist' ? 0 : advancedCount);
  return (
    <section aria-label={t('admin_filter_station_filters', 'Station filters')} className="border-y border-border bg-muted/30 px-4 py-4 sm:px-6 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_minmax(170px,220px)_minmax(190px,240px)]">
        <div className="space-y-1.5">
          <Label htmlFor="admin-station-search">{t('admin_filter_search_label', 'Search stations')}</Label>
          <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input id="admin-station-search" type="search" autoComplete="off" placeholder={t('filter_search_placeholder', 'Name, stream URL or station ID')} className="pl-9 bg-background" value={props.search} onChange={event => props.onSearchChange(event.target.value)} />
          </div>
        </div>
        {mode !== 'blacklist' && <SearchableChoice id="admin-station-country" label={t('admin_filter_countries_label', 'Countries')} placeholder={t('filter_all_countries', 'All Countries')}
          status={options.isLoading ? t('filter_loading_countries', 'Loading countries...') : options.isError ? t('filter_error_loading_countries', 'Error loading countries') : undefined}
          value={props.country} options={(options.data?.countries || []).map(country => country.name)} onChange={props.onCountryChange} />}
        {mode === 'stations' && props.onHealthStatusChange && <Choice id="admin-station-health" label={t('admin_filter_broadcast_health', 'Broadcast health')} value={props.healthStatus || 'all'} onChange={props.onHealthStatusChange}
          options={[['all', t('admin_filter_health_all', 'All health statuses')], ['unavailable', t('admin_filter_health_confirmed_offline', 'Confirmed offline · hidden')], ['source-offline', t('admin_filter_health_source_offline', 'Source reports offline')], ['unverified', t('admin_filter_health_unverified', 'Needs verification')], ['working', t('admin_filter_health_working', 'Recent positive check')]]} />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {mode !== 'blacklist' ? <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" aria-expanded={advancedOpen} aria-controls="admin-station-advanced-filters" onClick={() => setAdvancedOpen(value => !value)}>
          <SlidersHorizontal className="mr-2 h-4 w-4" />{t('admin_filter_advanced', 'Advanced filters')}{advancedCount > 0 && ' (' + advancedCount + ' ' + t('admin_filter_active', 'active') + ')'}
        </Button> : <p className="text-xs text-muted-foreground">{t('admin_filter_deleted_search_help', 'Search deleted stations by name or URL.')}</p>}
        {activeCount > 0 && props.onReset && <Button type="button" variant="ghost" size="sm" onClick={props.onReset}><X className="mr-1 h-4 w-4" />{t('admin_filter_clear', 'Clear filters')} ({activeCount})</Button>}
      </div>
      {mode !== 'blacklist' && advancedOpen && <div id="admin-station-advanced-filters" className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-3">
        <SearchableChoice id="admin-station-language" label={t('admin_filter_languages_label', 'Languages')} placeholder={t('filter_all_languages', 'All Languages')}
          status={options.isLoading ? t('filter_loading_languages', 'Loading languages...') : options.isError ? t('filter_error_loading_languages', 'Error loading languages') : undefined}
          value={props.language} options={options.data?.languages || []} onChange={props.onLanguageChange} />
        <SearchableChoice id="admin-station-genre" label={t('admin_filter_genres_label', 'Genres')} placeholder={t('filter_all_genres', 'All Genres')}
          status={options.isLoading ? t('filter_loading_genres', 'Loading genres...') : options.isError ? t('filter_error_loading_genres', 'Error loading genres') : undefined}
          value={props.genre} options={options.data?.genres || []} onChange={props.onGenreChange} />
        {mode === 'stations' && props.onCodecChange && <SearchableChoice id="admin-station-codec" label={t('admin_filter_codecs_label', 'Codecs')} placeholder={t('admin_filter_all_codecs', 'All codecs')} value={props.codec || ''} options={options.data?.codecs || []} onChange={props.onCodecChange} />}
        {mode === 'stations' && props.onHasDescriptionsChange && <Choice id="admin-station-descriptions" label={t('admin_filter_descriptions_label', 'Descriptions')} value={props.hasDescriptions || 'all'} onChange={props.onHasDescriptionsChange} options={[['all', t('admin_filter_descriptions_all', 'All descriptions')], ['yes', t('admin_filter_descriptions_yes', 'Has descriptions')], ['no', t('admin_filter_descriptions_no', 'No descriptions')], ['partial', t('admin_filter_descriptions_partial', 'Missing languages')]]} />}
        {mode === 'stations' && props.onTagsStatusChange && <Choice id="admin-station-tags" label={t('admin_filter_tags_label', 'Tag checks')} value={props.tagsStatus || 'all'} onChange={props.onTagsStatusChange} options={[['all', t('admin_filter_tags_all', 'All tag statuses')], ['empty-cooldown', t('admin_filter_tags_cooldown', 'Empty · cooldown')], ['never-checked', t('admin_filter_tags_unchecked', 'Empty · never checked')]]} />}
        {mode === 'stations' && props.onHasLogoChange && <Choice id="admin-station-logo" label={t('admin_filter_logo_label', 'Logo')} value={props.hasLogo || 'all'} onChange={props.onHasLogoChange} options={[['all', t('admin_filter_logo_all', 'All logo statuses')], ['yes', t('admin_filter_logo_yes', 'Has logo')], ['no', t('admin_filter_logo_no', 'Missing logo')]]} />}
      </div>}
      {options.isError && mode !== 'blacklist' && <p className="text-xs text-destructive" role="status">{t('admin_filter_suggestions_failed', 'Filter suggestions could not load. You can still type a value.')} <button type="button" className="underline" onClick={() => options.refetch()}>{t('admin_filter_retry_suggestions', 'Retry suggestions')}</button></p>}
      {mode === 'stations' && (props.healthStatus === 'source-offline' || props.healthStatus === 'unavailable') && <p className="text-xs leading-relaxed text-muted-foreground">{t('admin_filter_health_help', 'A source warning is not proof that a radio is offline. Only repeated local failures can hide it from lists; its public page is retained.')}</p>}
    </section>
  );
}
