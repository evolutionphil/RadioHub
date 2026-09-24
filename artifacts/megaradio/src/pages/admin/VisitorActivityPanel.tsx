import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/queryClient';
import { visitorClientLabel, visitorCountry, visitorDetailTimestamp } from '@/lib/admin-visitor-details';
import { isAutomatedVisitors, isVisitorActivity, visitorActivityLabel, visitorActivityParams, type ActivitySelection } from '@/lib/admin-visitor-activity';

const queryOptions = { retry: false, staleTime: 15_000, gcTime: 60_000, refetchOnMount: 'always' as const, refetchOnWindowFocus: false, placeholderData: undefined };

function HistoryNotice({ startedAt }: { startedAt?: string }) {
  return <aside className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
    <p className="font-medium text-slate-700">Sampled history · 7 days · Not verified people</p>
    <details className="space-y-2"><summary className="cursor-pointer rounded-sm font-medium underline decoration-slate-300 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">How this is measured</summary>
    <p>Only a bounded, best-effort sample of the last 7 days is retained. Events may be missing; this is not a complete browsing session or an exact request count. There is no historical backfill.{startedAt && <> Collection started <time dateTime={startedAt}>{visitorDetailTimestamp(startedAt)}</time> (Berlin).</>}</p>
    <p>Shared IPs, including NAT networks, may represent several people or devices. Arrival sources and observed actions do not reveal a visitor’s purpose or intent. A play request does not prove that audio was played or heard.</p>
    <p>Automation labels are evidence-based estimates, not proof of a human or bot. Browser-like does not mean verified human; automated traffic is separate from qualified visitor counts.</p>
    </details>
  </aside>;
}

function PageControls({ page, canLoadOlder, onNewer, onOlder }: { page: number; canLoadOlder: boolean; onNewer: () => void; onOlder: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <p className="text-xs text-slate-500">History page {page + 1} · Newest first</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={!page} onClick={onNewer}><ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />Newer activity</Button>
      <Button size="sm" variant="outline" disabled={!canLoadOlder} onClick={onOlder}>Older activity<ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" /></Button>
    </div>
  </div>;
}

/** Key this component by traffic kind + activityId so cursor state never crosses visitors. */
export function VisitorActivityPanel({ selected, onBack }: { selected: ActivitySelection; onBack: () => void }) {
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const before = cursors[cursors.length - 1];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const query = useQuery({
    ...queryOptions, queryKey: ['/api/admin/visitor-metrics/activity', selected.trafficKind, selected.activityId, before],
    queryFn: async ({ signal }) => {
      const response = await apiFetch(`/api/admin/visitor-metrics/activity/${encodeURIComponent(selected.activityId)}?${visitorActivityParams(before, 50)}`, { signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'An administrator session is required.' : response.status === 404 || response.status === 410 ? 'This activity is no longer available. It may have expired.' : 'Visitor activity could not be loaded.');
      const payload: unknown = await response.json();
      if (!isVisitorActivity(payload, selected)) throw new Error('Visitor activity returned incomplete or mismatched data.');
      return payload;
    },
  });
  const data = !query.isError && !query.isFetching && isVisitorActivity(query.data, selected) ? query.data : undefined;
  return <section aria-labelledby="visitor-activity-title" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />Back to {selected.trafficKind === 'automated' ? 'automated traffic' : 'visitors'}</Button>
      <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh activity</Button>
    </div>
    <div className="space-y-1"><h3 id="visitor-activity-title" ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">Observed activity</h3>
      <p className="break-words text-sm text-slate-600"><code className="font-semibold text-slate-900">{selected.maskedIp}</code> · {selected.trafficKind === 'automated' ? 'Automated traffic sample' : 'Qualified traffic sample'}</p>
      <p className="text-xs text-slate-500">The masked network can appear on other rows. This history belongs only to the selected unique-IP record.</p></div>
    <HistoryNotice startedAt={data?.collectionStartedAt} />
    {query.isError ? <div role="alert" className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <p>{query.error.message} No earlier visitor activity is displayed.</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry visitor activity</Button>
    </div> : !data ? <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">Loading visitor activity…</p> : <>
      <p className="text-xs text-slate-500">Computed <time dateTime={data.computedAt}>{visitorDetailTimestamp(data.computedAt)}</time> · Berlin</p>
      {!data.events.length ? <p role="status" className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">No retained activity on this page. Older requests were not backfilled and sampled events can expire.</p> : <ol aria-label="Observed events" className="space-y-2">
        {data.events.map(event => <li key={event.id} className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><time dateTime={event.occurredAt} className="font-medium text-slate-600">{visitorDetailTimestamp(event.occurredAt)}</time>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{event.source === 'client-pageview' ? 'Client-reported page view' : 'Observed HTTP request'}</span></div>
          <p className="mt-2 text-sm font-semibold">{visitorActivityLabel(event.action)}</p>
          <p className="mt-1 break-all text-sm text-slate-700"><code>{event.path}</code></p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-2 text-xs sm:grid-cols-4">
            {([['Method', event.method], [event.source === 'client-pageview' ? 'Reporting status' : 'HTTP status', String(event.status)], ['Arrival source', visitorActivityLabel(event.referralCategory)], ['Traffic evidence', visitorActivityLabel(event.automationStatus)]] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 break-words font-medium">{value}</dd></div>)}
          </dl>
        </li>)}
      </ol>}
      <PageControls page={cursors.length - 1} canLoadOlder={!!data.nextCursor && data.nextCursor !== before}
        onNewer={() => setCursors(current => current.slice(0, -1))} onOlder={() => { if (data.nextCursor && data.nextCursor !== before) setCursors(current => [...current, data.nextCursor]); }} />
    </>}
  </section>;
}

/** Mounted only for the automated tab; opening the dashboard never polls this list. */
export function AutomatedTrafficPanel({ onSelect }: { onSelect: (selected: ActivitySelection) => void }) {
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const before = cursors[cursors.length - 1];
  const query = useQuery({
    ...queryOptions, queryKey: ['/api/admin/visitor-metrics/automated', before],
    queryFn: async ({ signal }) => {
      const response = await apiFetch(`/api/admin/visitor-metrics/automated?${visitorActivityParams(before, 25)}`, { signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'An administrator session is required.' : 'Automated traffic could not be loaded.');
      const payload: unknown = await response.json();
      if (!isAutomatedVisitors(payload)) throw new Error('Automated traffic returned incomplete data.');
      return payload;
    },
  });
  const data = !query.isError && !query.isFetching && isAutomatedVisitors(query.data) ? query.data : undefined;
  return <section aria-label="Automated traffic records" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Sampled automated traffic</h3><p className="mt-1 text-xs text-slate-500">Separate diagnostics, not the qualified visitor list or a count of all bots.</p></div>
      <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh automated traffic</Button></div>
    <HistoryNotice startedAt={data?.collectionStartedAt} />
    {query.isError ? <div role="alert" className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p>{query.error.message} No previous traffic rows are displayed.</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry automated traffic</Button></div>
      : !data ? <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">Loading automated traffic…</p> : <>
        {!data.visitors.length ? <p role="status" className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">No retained automated traffic on this page. This does not establish that no bots visited.</p> : <ul aria-label="Sampled automated visitors" className="space-y-2">
          {data.visitors.map((row, index) => <li key={row.activityId} className="rounded-lg border border-slate-200 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><code className="text-sm font-semibold">{row.maskedIp}</code><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Automated · estimated</span></div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              {([['Country', visitorCountry(row.countryCode)], ['Client / platform', visitorClientLabel(row)], ['Operating system', row.os || 'Unknown'], ['Browser', row.browser || 'Unknown']] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 break-words font-medium">{value}</dd></div>)}
            </dl>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3"><div className="space-y-1 text-xs text-slate-500"><p>First seen <time dateTime={row.firstSeenAt}>{visitorDetailTimestamp(row.firstSeenAt)}</time></p><p>Last seen <time dateTime={row.lastSeenAt}>{visitorDetailTimestamp(row.lastSeenAt)}</time></p></div>
              <Button size="sm" variant="outline" aria-label={`View activity for ${row.maskedIp}, automated visitor ${index + 1}`} onClick={() => onSelect({ activityId: row.activityId, maskedIp: row.maskedIp, trafficKind: 'automated' })}>View activity<ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" /></Button></div>
          </li>)}
        </ul>}
        <PageControls page={cursors.length - 1} canLoadOlder={!!data.nextCursor && data.nextCursor !== before}
          onNewer={() => setCursors(current => current.slice(0, -1))} onOlder={() => { if (data.nextCursor && data.nextCursor !== before) setCursors(current => [...current, data.nextCursor]); }} />
      </>}
  </section>;
}
