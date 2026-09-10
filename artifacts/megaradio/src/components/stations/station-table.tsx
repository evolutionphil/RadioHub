import { Fragment, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Edit, Play, Pause, Trash2, ArrowUp, ArrowDown, ArrowUpDown, MoreHorizontal, Sparkles, Tag, ChevronDown, ChevronUp, Loader2, Languages } from 'lucide-react';
import StationLogo from '@/components/ui/station-logo';
import { adminStationDescriptionCount, adminStationHealth } from '@/lib/admin-station-list';

interface AdminStation {
  _id: string; name: string; url: string; country?: string; countryName?: string;
  language?: string; codec?: string; bitrate?: number; votes?: number;
  clickCount?: number; clickTrend?: number | null; lastCheckOk?: boolean;
  tags?: string; favicon?: string; localImagePath?: string; homepage?: string;
  availabilityStatus?: string; isListVisible?: boolean;
  [key: string]: any;
}

interface StationTableProps {
  stations: AdminStation[];
  onEdit: (station: AdminStation) => void;
  onDelete: (station: AdminStation) => void;
  onSort: (field: string) => void;
  onPlay: (station: AdminStation) => void | Promise<void>;
  onGenerateAi?: (station: AdminStation) => void;
  onTranslate?: (station: AdminStation) => void;
  onRecheckTags?: (station: AdminStation) => void;
  sortBy: string; sortOrder: 'asc' | 'desc';
  generatingStationId?: string | null; recheckingTagsStationId?: string | null;
  playingStationId?: string | null; loadingStationId?: string | null;
  selectedStations?: Set<string>;
  onSelectedStationsChange?: (selected: Set<string>) => void;
}

const SORTS = [['name', 'Station name'], ['country', 'Country'], ['healthStatus', 'Health · offline first'], ['votes', 'Votes'], ['clickcount', 'Listeners / clicks'], ['bitrate', 'Bitrate'], ['tagsCheckedAt', 'Tag check date'], ['favicon', 'Logo']] as const;
const dateText = (value: unknown) => {
  const date = typeof value === 'string' || value instanceof Date ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not recorded';
};

export function AdminStationHealthBadge({ station }: { station: AdminStation }) {
  const health = adminStationHealth(station);
  const tone = health.tone === 'offline' ? 'border-red-200 bg-red-50 text-red-800' : health.tone === 'working' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800';
  return <div className="space-y-1">
    <Badge variant="outline" className={tone + ' whitespace-normal leading-snug'} title={health.detail}>{health.label}</Badge>
    {station.lastCheckOk === false && station.healthSource !== 'manual-unchecked' && health.tone !== 'offline' && <p className="text-xs text-muted-foreground">Source reports offline</p>}
  </div>;
}

function DescriptionBadge({ station }: { station: AdminStation }) {
  const count = adminStationDescriptionCount(station.descriptions);
  return <Badge variant="outline" className={count === 14 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'text-muted-foreground'} title="Languages with a non-empty full description; this is not an SEO quality score">{count} / 14 languages</Badge>;
}

function StationDetails({ station }: { station: AdminStation }) {
  const tags = typeof station.tags === 'string' ? station.tags.split(',').map(tag => tag.trim()).filter(Boolean) : [];
  const checkedAt = Date.parse(station.tagsCheckedAt || '');
  const cooldown = !tags.length && Number.isFinite(checkedAt) && Date.now() - checkedAt < 30 * 86400000;
  return <div className="grid gap-4 bg-muted/30 p-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
    <div className="space-y-1 min-w-0"><p className="font-medium">Stream &amp; format</p><p className="break-all text-xs text-muted-foreground">{station.url}</p>
      {station.urlResolved && station.urlResolved !== station.url && <p className="break-all text-xs text-muted-foreground">Resolved: {station.urlResolved}</p>}
      <p className="text-xs text-muted-foreground">{station.codec || 'Unknown codec'} · {station.bitrate ? station.bitrate + ' kbps' : 'Bitrate unknown'}{station.language ? ' · ' + station.language : ''}</p>
      {station.sslError && <p className="text-xs text-amber-700">Source reported a TLS / certificate issue.</p>}
    </div>
    <div className="space-y-1"><p className="font-medium">Health evidence</p><p className="text-xs text-muted-foreground">{adminStationHealth(station).detail}</p>
      <p className="text-xs text-muted-foreground">Latest check: {dateText(station.lastCheckTime)}</p>
      <p className="text-xs text-muted-foreground">Latest positive: {dateText(station.lastCheckOkTime)}</p>
      <p className="text-xs text-muted-foreground">Source-local check: {dateText(station.lastLocalCheckTime)}</p>
    </div>
    <div className="space-y-1"><p className="font-medium">Genres &amp; source checks</p>
      <p className="break-words text-xs text-muted-foreground">{tags.length ? tags.join(', ') : 'No genres recorded'}</p>
      <p className="text-xs text-muted-foreground">Tags checked: {dateText(station.tagsCheckedAt)}</p>
      {cooldown && <p className="text-xs text-amber-700">No source tags · cooldown until {dateText(new Date(checkedAt + 30 * 86400000))}</p>}
      <p className="text-xs text-muted-foreground">Click trend: {station.clickTrend ?? 'Not recorded'} · Last click: {dateText(station.clickTimestamp)}</p>
    </div>
  </div>;
}

export default function StationTable({
  stations, onEdit, onDelete, onSort, onPlay, onGenerateAi, onTranslate, onRecheckTags,
  sortBy, sortOrder, generatingStationId, recheckingTagsStationId, playingStationId, loadingStationId,
  selectedStations = new Set(), onSelectedStationsChange,
}: StationTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pageSelectedCount = stations.filter(station => selectedStations.has(station._id)).length;
  const allSelected = stations.length > 0 && pageSelectedCount === stations.length;
  const selectAllState = allSelected ? true : pageSelectedCount ? 'indeterminate' : false;
  const selectStation = (id: string, checked: boolean) => {
    const selected = new Set(selectedStations);
    if (checked) selected.add(id); else selected.delete(id);
    onSelectedStationsChange?.(selected);
  };
  const selectPage = (checked: boolean) => {
    const selected = new Set(selectedStations);
    for (const station of stations) { if (checked) selected.add(station._id); else selected.delete(station._id); }
    onSelectedStationsChange?.(selected);
  };
  const toggleDetails = (id: string) => setExpanded(previous => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const SortHeader = ({ field, children }: { field: string; children: React.ReactNode }) => <TableHead aria-sort={sortBy === field ? sortOrder === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <button type="button" onClick={() => onSort(field)} className="flex items-center gap-1.5 py-3 text-left hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
      {children}{sortBy !== field ? <ArrowUpDown className="h-3.5 w-3.5 shrink-0" /> : sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5 shrink-0" /> : <ArrowDown className="h-3.5 w-3.5 shrink-0" />}
    </button>
  </TableHead>;
  const identity = (station: AdminStation) => <div className="flex min-w-0 items-center gap-3">
    <StationLogo station={station} size="md" className="shrink-0 rounded-lg" />
    <div className="min-w-0"><p className="font-medium leading-snug text-foreground break-words">{station.name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{station.countryName || station.country || station.countryCode || 'Country not recorded'}{station.state ? ' · ' + station.state : ''}</p>
      <button type="button" onClick={() => toggleDetails(station._id)} aria-expanded={expanded.has(station._id)} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-label={'Details for ' + station.name}>
        {expanded.has(station._id) ? 'Hide details' : 'Stream & details'}{expanded.has(station._id) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
    </div>
  </div>;
  const actions = (station: AdminStation) => <div className="flex shrink-0 items-center gap-1">
    <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => onPlay(station)} disabled={loadingStationId === station._id}
      aria-label={(playingStationId === station._id ? 'Pause ' : 'Play ') + station.name} title="Try this stream; a source warning does not prevent an admin preview">
      {loadingStationId === station._id ? <Loader2 className="h-4 w-4 animate-spin" /> : playingStationId === station._id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </Button>
    <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => onEdit(station)} aria-label={'Edit ' + station.name}><Edit className="h-4 w-4" /></Button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={'More actions for ' + station.name}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onGenerateAi && <DropdownMenuItem disabled={generatingStationId === station._id} onSelect={() => onGenerateAi(station)}><Sparkles className="h-4 w-4" />{generatingStationId === station._id ? 'Generating…' : 'Generate AI description'}</DropdownMenuItem>}
        {onTranslate && <DropdownMenuItem disabled={generatingStationId === station._id} onSelect={() => onTranslate(station)}><Languages className="h-4 w-4" />Translate descriptions</DropdownMenuItem>}
        {onRecheckTags && <DropdownMenuItem disabled={recheckingTagsStationId === station._id} onSelect={() => onRecheckTags(station)} data-testid={'button-recheck-tags-' + station._id}><Tag className="h-4 w-4" />{recheckingTagsStationId === station._id ? 'Re-checking…' : 'Re-check source tags'}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(station)}><Trash2 className="h-4 w-4" />Delete station…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 border-b border-border">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"><Checkbox checked={selectAllState} onCheckedChange={checked => selectPage(checked === true)} aria-label="Select all stations on this page" disabled={!stations.length} />Select page ({pageSelectedCount}/{stations.length})</label>
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Sort</span>
        <Select value={sortBy} onValueChange={onSort}><SelectTrigger className="h-8 w-[185px]" aria-label="Sort stations by"><SelectValue /></SelectTrigger><SelectContent>{SORTS.map(([key, name]) => <SelectItem key={key} value={key}>{name}</SelectItem>)}</SelectContent></Select>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onSort(sortBy)} aria-label={sortOrder === 'asc' ? 'Switch to descending order' : 'Switch to ascending order'}>{sortOrder === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}</Button>
      </div>
    </div>
    {!stations.length && <div className="px-6 py-12 text-center"><p className="font-medium">No matching stations</p><p className="mt-1 text-sm text-muted-foreground">Try another health status or clear the filters.</p></div>}
    {stations.length > 0 && <>
      <div className="space-y-3 p-3 lg:hidden">
        {stations.map(station => <article key={station._id} className="overflow-hidden rounded-lg border border-border bg-background" aria-label={station.name}>
          <div className="space-y-3 p-3">
            <div className="flex items-start gap-2"><Checkbox className="mt-3 shrink-0" aria-label={'Select ' + station.name} checked={selectedStations.has(station._id)} onCheckedChange={checked => selectStation(station._id, checked === true)} />{identity(station)}</div>
            <div className="flex flex-wrap items-center gap-2"><AdminStationHealthBadge station={station} /><DescriptionBadge station={station} /></div>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground tabular-nums">{(station.clickCount || 0).toLocaleString()} clicks · {(station.votes || 0).toLocaleString()} votes</p>{actions(station)}</div>
          </div>
          {expanded.has(station._id) && <StationDetails station={station} />}
        </article>)}
      </div>
      <div className="hidden lg:block overflow-x-auto">
        <Table><TableHeader><TableRow>
          <TableHead className="w-10"><span className="sr-only">Selection</span></TableHead>
          <SortHeader field="name">Station</SortHeader><SortHeader field="healthStatus">Broadcast health</SortHeader>
          <TableHead>Content</TableHead><SortHeader field="clickcount">Clicks</SortHeader><SortHeader field="votes">Votes</SortHeader><TableHead className="w-[124px]">Actions</TableHead>
        </TableRow></TableHeader><TableBody>
          {stations.map(station => <Fragment key={station._id}>
            <TableRow className={selectedStations.has(station._id) ? 'bg-muted/40' : ''}>
              <TableCell><Checkbox aria-label={'Select ' + station.name} checked={selectedStations.has(station._id)} onCheckedChange={checked => selectStation(station._id, checked === true)} /></TableCell>
              <TableCell className="min-w-[210px] max-w-[330px]">{identity(station)}</TableCell>
              <TableCell className="min-w-[155px]"><AdminStationHealthBadge station={station} /></TableCell>
              <TableCell><DescriptionBadge station={station} /></TableCell>
              <TableCell className="tabular-nums">{(station.clickCount || 0).toLocaleString()}</TableCell><TableCell className="tabular-nums">{(station.votes || 0).toLocaleString()}</TableCell>
              <TableCell>{actions(station)}</TableCell>
            </TableRow>
            {expanded.has(station._id) && <TableRow><TableCell colSpan={7} className="p-0"><StationDetails station={station} /></TableCell></TableRow>}
          </Fragment>)}
        </TableBody></Table>
      </div>
    </>}
  </div>;
}
