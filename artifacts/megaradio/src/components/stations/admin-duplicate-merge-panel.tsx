import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, Loader2, Merge, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useAdminDuplicateMerge } from '@/hooks/useAdminDuplicateMerge';

function dateLabel(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not scheduled';
  return new Date(value).toLocaleString();
}

export default function AdminDuplicateMergePanel({ onApplied }: { onApplied?: () => void } = {}) {
  const auth = useAdminAuth();
  const account = auth.isAuthenticated && auth.isAdmin ? auth.user?.username || null : null;
  const merge = useAdminDuplicateMerge(account);
  const client = useQueryClient();
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const notified = useRef(new Set<string>());
  const callback = useRef(onApplied); callback.current = onApplied;
  const job = merge.job;

  useEffect(() => {
    if (!account || !job || job.dryRun || job.status === 'running' || notified.current.has(`${account}:${job.jobId}`)) return;
    notified.current.add(`${account}:${job.jobId}`);
    void client.invalidateQueries({ queryKey: ['/api/admin/stations/duplicates'] });
    void client.invalidateQueries({ queryKey: ['/api/admin/stations'] });
    callback.current?.();
  }, [account, client, job]);
  useEffect(() => { setConfirmationId(null); }, [account]);

  const confirmReady = merge.canApply && confirmationId === merge.preview?.jobId;
  const results = job?.results;
  return (
    <section aria-labelledby="safe-duplicate-merge-heading" className="rounded-xl border bg-card p-4 text-card-foreground sm:p-5" data-testid="safe-duplicate-merge">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <h2 id="safe-duplicate-merge-heading" className="flex items-center gap-2 text-base font-semibold"><ShieldCheck aria-hidden="true" className="h-5 w-5 text-primary" />Merge across the catalogue</h2>
          <p className="text-sm text-muted-foreground">Preview every candidate group, not just this page or the current filters. Only verified, compatible records qualify; ambiguous groups stay separate for manual review.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void merge.refresh()} disabled={!account || merge.pending || merge.isLoading}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Refresh merge status</Button>
      </div>

      <div className="my-4 flex flex-col gap-2 border-y py-4 sm:flex-row sm:items-center sm:gap-3">
        <Button variant="outline" disabled={!merge.ready} onClick={() => void merge.start()}>
          {merge.pending ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : <span aria-hidden="true" className="mr-2 text-muted-foreground">01</span>}
          Preview all candidate groups
        </Button>
        <Button disabled={!merge.canApply} onClick={() => setConfirmationId(merge.preview!.jobId)}>
          <Merge aria-hidden="true" className="mr-2 h-4 w-4" />Merge {merge.preview?.results.eligibleGroups.toLocaleString() || 'all'} eligible groups
        </Button>
        <span className="text-xs text-muted-foreground sm:ml-1">Preview first. No stations change during preview.</span>
      </div>

      {merge.isLoading && <p role="status" className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Loading saved merge status…</p>}
      {merge.error && <Alert variant="destructive" className="mb-3"><AlertDescription>Status checking stopped: {merge.error} Use “Refresh merge status” to retry. Closing this page does not cancel a server job.</AlertDescription></Alert>}
      {merge.expiredJobId && <Alert className="mb-3"><AlertDescription>The saved job no longer exists or has expired. Its polling has stopped; no new merge was started.</AlertDescription></Alert>}

      {job && results && (
        <div className="mb-4 space-y-3" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="flex items-center gap-2 font-medium">{job.status === 'running' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : job.status === 'completed' ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-600" /> : null}{job.dryRun ? 'Preview' : 'Merge'} {job.status}</p>
            <span className="text-xs text-muted-foreground">{job.progress.groupsProcessed.toLocaleString()} / {job.progress.totalGroups.toLocaleString()} groups checked</span>
          </div>
          {job.status === 'running' && <><Progress aria-label="Catalogue merge progress" value={Math.max(0, Math.min(100, job.progress.percentage))} /><p className="text-xs text-muted-foreground">{job.progress.currentStep}. You can leave this page; the server continues and progress is restored when you return.</p></>}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Candidates', results.totalGroups], ['Eligible', results.eligibleGroups], ['Skipped for review', results.skippedGroups],
              [job.dryRun ? 'Duplicate records to combine' : 'Groups merged', job.dryRun ? results.totalStationsToDelete : results.mergedGroups],
            ].map(([label, value]) => <div key={label} className="min-w-0 border-l-2 pl-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{Number(value).toLocaleString()}</dd></div>)}
          </dl>
          {job.dryRun && job.status === 'completed' && results.eligibleGroups === 0 && <p className="text-sm text-muted-foreground">No groups are eligible for automatic merging. Review the remaining candidates individually.</p>}
          {results.skippedReasons.length > 0 && <details className="rounded-md border px-3 py-2"><summary className="cursor-pointer text-sm font-medium">Why groups were skipped ({results.skippedGroups.toLocaleString()})</summary><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{results.skippedReasons.map((item, index) => <li key={`${item.reason}:${index}`} className="flex justify-between gap-4"><span>{item.reason.replace(/_/g, ' ')}</span><span className="tabular-nums">{item.count.toLocaleString()}</span></li>)}</ul></details>}
          {(job.status === 'failed' || results.errors.length > 0) && <Alert variant="destructive"><AlertDescription>{job.errorMessage || 'Some work could not be completed. Completed groups remain saved; review errors before creating another preview.'}{results.errors.length > 0 && <ul className="mt-2 list-disc pl-4">{results.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}</AlertDescription></Alert>}
        </div>
      )}

      <div className="flex items-start gap-2 text-xs text-muted-foreground"><Clock3 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><div>
        <p className="font-medium text-foreground">{!merge.schedule ? 'Automatic maintenance status unavailable' : merge.schedule.enabled && merge.schedule.automaticDailyEnabled ? 'Automatic safe merge · daily' : 'Automatic safe merge is paused'}</p>
        {merge.schedule && <p className="mt-1">Up to {merge.schedule.dailyGroupLimit.toLocaleString()} verified groups per run. Next run: {dateLabel(merge.schedule.nextRunAt)}. Ambiguous matches are never merged automatically.</p>}
      </div></div>

      <AlertDialog open={Boolean(confirmationId)} onOpenChange={open => { if (!open) setConfirmationId(null); }}>
        <AlertDialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-y-auto border-slate-200 bg-white text-slate-950">
          <AlertDialogHeader><AlertDialogTitle>Merge {merge.preview?.results.eligibleGroups.toLocaleString() || 0} eligible groups?</AlertDialogTitle><AlertDialogDescription className="text-slate-600">
            This applies the completed preview across the entire catalogue. Existing station URLs redirect to the retained station; compatible descriptions, favorites and listening history are preserved. Original records are archived. Each group is checked again before merging; changed or conflicting groups are skipped. The operation continues on the server if you close this page.
          </AlertDialogDescription></AlertDialogHeader>
          {!confirmReady && <p role="status" className="text-sm text-muted-foreground">This preview is no longer ready. Close this dialog and refresh merge status.</p>}
          <AlertDialogFooter><AlertDialogCancel className="border-slate-300 bg-white text-slate-900 hover:bg-slate-100" disabled={merge.pending}>Keep separate</AlertDialogCancel><Button disabled={!confirmReady || merge.pending} onClick={async () => { if (confirmationId && await merge.start(confirmationId)) setConfirmationId(null); }}>Confirm eligible merge</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
