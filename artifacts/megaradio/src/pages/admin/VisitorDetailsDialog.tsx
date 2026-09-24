import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/queryClient';
import { AutomatedTrafficPanel, VisitorActivityPanel } from './VisitorActivityPanel';
import { isVisitorActivityId, type ActivitySelection, type TrafficKind } from '@/lib/admin-visitor-activity';
import {
  isVisitorDetails, visitorClientLabel, visitorCountry, visitorDetailsParams, visitorDetailTimestamp,
  VISITOR_CHANNELS, VISITOR_DEVICES, VISITOR_PLATFORMS, VISITOR_WINDOWS,
  type VisitorBreakdown, type VisitorFilters, type VisitorWindow,
} from '@/lib/admin-visitor-details';

function Breakdown({ title, rows, total, label }: { title: string; rows: VisitorBreakdown[]; total: number; label: (value: string) => string }) {
  return <section aria-label={`${title} breakdown`} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
    {rows.length ? <dl className="max-h-36 space-y-2 overflow-y-auto pr-1">
      {rows.map(row => <div key={row.value}>
        <div className="flex items-start justify-between gap-2 text-xs"><dt className="min-w-0 break-words">{label(row.value)}</dt><dd className="font-semibold tabular-nums">{row.count.toLocaleString()}</dd></div>
        <div aria-hidden="true" className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-500" style={{ width: `${total ? Math.min(100, row.count / total * 100) : 0}%` }} /></div>
      </div>)}
    </dl> : <p className="text-xs text-slate-500">No requests recorded in this window.</p>}
  </section>;
}

/** Mount only when a metric is opened: no drilldown request during normal dashboard polling. */
export function VisitorDetailsDialog({ initialWindow, onClose, restoreFocus }: { initialWindow: VisitorWindow; onClose: () => void; restoreFocus?: () => void }) {
  const [trafficKind, setTrafficKind] = useState<TrafficKind>('qualified');
  const [selectedActivity, setSelectedActivity] = useState<ActivitySelection | null>(null);
  const trafficControls = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<VisitorFilters>({ window: initialWindow, page: 1, country: 'all', platform: 'all', deviceType: 'all' });
  const query = useQuery({
    enabled: trafficKind === 'qualified' && !selectedActivity,
    queryKey: ['/api/admin/visitor-metrics/details', filters],
    queryFn: async ({ signal }) => {
      const response = await apiFetch(`/api/admin/visitor-metrics/details?${visitorDetailsParams(filters)}`, { signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'An administrator session is required.' : 'Visitor details could not be loaded.');
      const payload: unknown = await response.json();
      if (!isVisitorDetails(payload, filters)) throw new Error('Visitor details returned incomplete data.');
      return payload;
    },
    retry: false, staleTime: 15_000, gcTime: 60_000,
    refetchOnMount: 'always', refetchOnWindowFocus: false,
    placeholderData: undefined,
  });
  // Do not show a prior filter/page (or formerly successful response after failure) as current.
  const data = !query.isError && !query.isFetching && isVisitorDetails(query.data, filters) ? query.data : undefined;
  const change = (key: 'country' | 'platform' | 'deviceType', value: string) => setFilters(current => ({ ...current, [key]: value, page: 1 }));
  const hasFilters = filters.country !== 'all' || filters.platform !== 'all' || filters.deviceType !== 'all';
  const countryOptions = query.data?.breakdowns.countries ?? [];
  const countryValues = Array.from(new Set([...countryOptions.map(row => row.value), ...(filters.country !== 'all' ? [filters.country] : [])]));
  const selectClass = 'mt-1 block h-10 w-full min-w-0 max-w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[92dvh] w-[calc(100%_-_1.5rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-xl border-slate-200 bg-white p-0 text-slate-950 shadow-2xl" onCloseAutoFocus={event => { if (restoreFocus) { event.preventDefault(); restoreFocus(); } }}>
      <DialogHeader className="shrink-0 border-b border-slate-200 px-4 py-5 pr-12 text-left sm:px-6">
        <DialogTitle className="flex items-center gap-2 text-xl"><Activity className="h-5 w-5 text-green-600" aria-hidden="true" />Visitor details</DialogTitle>
        <DialogDescription className="text-xs leading-relaxed text-slate-600">Unique IPs, not verified people. Shared IP addresses count once. Each IP is attributed to its latest sampled request.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
        {selectedActivity ? <VisitorActivityPanel key={`${selectedActivity.trafficKind}:${selectedActivity.activityId}`} selected={selectedActivity}
          onBack={() => { setSelectedActivity(null); requestAnimationFrame(() => trafficControls.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()); }} /> : <>
        <div ref={trafficControls} role="group" aria-label="Traffic category" className="flex flex-wrap gap-1 border-b border-slate-200 pb-3">
          {(['qualified', 'automated'] as const).map(kind => <button key={kind} type="button" aria-pressed={trafficKind === kind}
            className={`rounded-md px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${trafficKind === kind ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => setTrafficKind(kind)}>{kind === 'qualified' ? 'Qualified visitors' : 'Automated traffic'}</button>)}
        </div>
        {trafficKind === 'automated' ? <AutomatedTrafficPanel onSelect={setSelectedActivity} /> : <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Visitor time window" className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {(Object.keys(VISITOR_WINDOWS) as VisitorWindow[]).map(window => <button key={window} type="button" aria-pressed={filters.window === window}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${filters.window === window ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:bg-white/70'}`}
              onClick={() => setFilters({ window, page: 1, country: 'all', platform: 'all', deviceType: 'all' })}>{VISITOR_WINDOWS[window]}</button>)}
          </div>
          <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh details</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label className="block" htmlFor="visitor-country">Country</Label><select id="visitor-country" value={filters.country} className={selectClass} style={{ width: '100%' }} onChange={event => change('country', event.target.value)}>
            <option value="all">All countries</option>{countryValues.map(value => <option key={value} value={value}>{visitorCountry(value)}</option>)}
          </select></div>
          <div><Label className="block" htmlFor="visitor-platform">Platform</Label><select id="visitor-platform" value={filters.platform} className={selectClass} style={{ width: '100%' }} onChange={event => change('platform', event.target.value)}>
            <option value="all">All platforms</option>{Object.entries(VISITOR_PLATFORMS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></div>
          <div><Label className="block" htmlFor="visitor-device">Device type</Label><select id="visitor-device" value={filters.deviceType} className={selectClass} style={{ width: '100%' }} onChange={event => change('deviceType', event.target.value)}>
            <option value="all">All devices</option>{Object.entries(VISITOR_DEVICES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></div>
        </div>
        {hasFilters && <Button size="sm" variant="outline" onClick={() => setFilters(current => ({ ...current, country: 'all', platform: 'all', deviceType: 'all', page: 1 }))}>Clear visitor filters</Button>}
        {query.isError ? <div role="alert" className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p>{query.error.message} No previous visitor rows are displayed.</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Retry visitor details</Button>
        </div> : !data ? <div role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">Loading visitor details…</div> : <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-medium text-slate-500">Matching unique IPs</p><p className="mt-1 text-3xl font-semibold tabular-nums">{data.matchedVisitors.toLocaleString()} <span className="text-sm font-normal text-slate-500">of {data.totalVisitors.toLocaleString()} in this window</span></p></div>
            <p className="text-xs text-slate-500">Computed <time dateTime={data.computedAt}>{visitorDetailTimestamp(data.computedAt)}</time> · Berlin</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Breakdowns cover the entire selected window, before the filters above.</p>
            <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 lg:grid-cols-4">
              <Breakdown title="Countries" rows={data.breakdowns.countries} total={data.totalVisitors} label={visitorCountry} />
              <Breakdown title="Channels" rows={data.breakdowns.channels} total={data.totalVisitors} label={value => VISITOR_CHANNELS[value] ?? value} />
              <Breakdown title="Platforms" rows={data.breakdowns.platforms} total={data.totalVisitors} label={value => VISITOR_PLATFORMS[value] ?? value} />
              <Breakdown title="Devices" rows={data.breakdowns.devices} total={data.totalVisitors} label={value => VISITOR_DEVICES[value] ?? value} />
            </div>
          </div>
          <section aria-label="Visitor records" className="space-y-3">
            <h3 className="text-sm font-semibold">Latest sampled clients</h3>
            <p className="text-xs text-slate-500">Addresses are masked to IPv4 /24 or IPv6 /48 networks. Different unique IPs can therefore show the same masked address.</p>
            {!data.visitors.length ? <p role="status" className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">{data.matchedVisitors ? 'No visitor rows on this page. Return to the first page.' : hasFilters ? 'No unique IPs match these filters.' : 'No qualified requests recorded in this window.'}</p> : <ul aria-label="Masked visitors" className="space-y-2">
              {data.visitors.map((row, index) => <li key={`${filters.page}-${index}-${row.maskedIp}`} className="rounded-lg border border-slate-200 p-3 sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><code className="text-sm font-semibold">{row.maskedIp}</code><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{VISITOR_CHANNELS[row.channel]}</span></div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
                  {([['Country', visitorCountry(row.countryCode)], ['Client / platform', visitorClientLabel(row)], ['Device', VISITOR_DEVICES[row.deviceType]], ['Operating system', row.os || 'Unknown'], ['Browser', row.browser || 'Unknown']] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 break-words font-medium">{value}</dd></div>)}
                </dl>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
                  <span>First seen <time dateTime={row.firstSeenAt}>{visitorDetailTimestamp(row.firstSeenAt)}</time></span>
                  <span>Last seen <time dateTime={row.lastSeenAt}>{visitorDetailTimestamp(row.lastSeenAt)}</time></span>
                  <span title={row.contextCollectedAt ? `Context observed ${visitorDetailTimestamp(row.contextCollectedAt)} (Berlin)` : 'No client context recorded'}>{row.contextSource === 'client-header' ? 'Self-reported client header' : row.contextSource === 'user-agent' ? 'Inferred from user-agent' : 'Client context unknown'}</span>
                </div>
                <div className="mt-3">
                  {isVisitorActivityId(row.activityId) ? <Button size="sm" variant="outline" aria-label={`View activity for ${row.maskedIp}, visitor ${index + 1}`}
                    onClick={() => setSelectedActivity({ activityId: row.activityId!, maskedIp: row.maskedIp, trafficKind: 'qualified' })}>View activity<ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" /></Button>
                    : <p className="text-xs text-slate-500">Activity history has not been collected for this record yet.</p>}
                </div>
              </li>)}
            </ul>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">Page {data.pagination.page} of {Math.max(1, data.pagination.totalPages)} · 25 IPs per page</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={filters.page <= 1} onClick={() => setFilters(current => ({ ...current, page: Math.max(1, current.page - 1) }))}><ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />Previous</Button>
                <Button variant="outline" size="sm" disabled={filters.page >= data.pagination.totalPages} onClick={() => setFilters(current => ({ ...current, page: current.page + 1 }))}>Next<ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" /></Button>
                {filters.page > Math.max(1, data.pagination.totalPages) && <Button size="sm" variant="outline" onClick={() => setFilters(current => ({ ...current, page: 1 }))}>First page</Button>}
              </div>
            </div>
          </section>
          <aside className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            <p>Collection started <time dateTime={data.collectionStartedAt}>{visitorDetailTimestamp(data.collectionStartedAt)}</time>. Country and client metadata started <time dateTime={data.dimensionsStartedAt}>{visitorDetailTimestamp(data.dimensionsStartedAt)}</time>. All timestamps use Europe/Berlin; retention is {data.retentionDays} days.</p>
            <p>Countries are approximate IP locations, not verified residence or GPS. Older requests can have unknown metadata. Shared IPs and changing devices are attributed to the latest sampled client, not every device or person behind that IP.</p>
            <p>Client headers are self-reported and user-agents are inferred. TV client labels (including Samsung Tizen and LG webOS) do not distinguish a built-in TV browser from a packaged TV app. These are not verified hardware or human identities.</p>
          </aside>
        </>}
        </>}
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}
