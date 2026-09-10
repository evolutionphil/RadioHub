import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

export interface AdminMergeJob {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  dryRun: boolean;
  previewJobId?: string;
  startedAt?: string | number;
  createdAt?: string;
  errorMessage?: string;
  progress: { currentStep: string; percentage: number; groupsProcessed: number; totalGroups: number };
  results: {
    totalGroups: number; eligibleGroups: number; skippedGroups: number;
    skippedReasons: Array<{ reason: string; count: number }>;
    mergedGroups: number; totalStationsToDelete: number; totalStationsDeleted: number;
    errors: string[];
  };
}

interface MergeSchedule {
  enabled: boolean;
  automaticDailyEnabled: boolean;
  dailyGroupLimit: number;
  nextRunAt: string | null;
  currentJob: AdminMergeJob | null;
  latestPreview: AdminMergeJob | null;
  latestApply: AdminMergeJob | null;
}

export const adminMergeStorageKey = (account: string) => `admin:duplicate-merge:v1:${encodeURIComponent(account)}`;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,200}$/.test(id);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parseAdminMergeJob(data: any): AdminMergeJob {
  if (!data || !validId(data.jobId) || !['running', 'completed', 'failed'].includes(data.status) || typeof data.dryRun !== 'boolean'
    || !data.progress || typeof data.progress.currentStep !== 'string' || !Number.isFinite(data.progress.percentage)
    || !count(data.progress.groupsProcessed) || !count(data.progress.totalGroups)
    || !data.results || !['totalGroups', 'eligibleGroups', 'skippedGroups', 'mergedGroups', 'totalStationsToDelete', 'totalStationsDeleted'].every(key => count(data.results[key]))
    || !Array.isArray(data.results.skippedReasons) || !data.results.skippedReasons.every((item: any) => typeof item?.reason === 'string' && count(item.count))
    || !Array.isArray(data.results.errors) || !data.results.errors.every((error: unknown) => typeof error === 'string')) {
    throw new Error('Invalid merge status response. Refresh status before continuing.');
  }
  return data;
}

export async function readAdminMergeJob(id: string, signal?: AbortSignal): Promise<AdminMergeJob> {
  const response = await apiRequest('GET', `/api/admin/merge-jobs/${encodeURIComponent(id)}`, { signal });
  const job = parseAdminMergeJob(await response.json());
  if (job.jobId !== id) throw new Error('Merge status belongs to a different job.');
  return job;
}

async function readSchedule(signal?: AbortSignal): Promise<MergeSchedule> {
  const response = await apiRequest('GET', '/api/admin/auto-merge-status', { signal });
  const data = await response.json();
  if (!data || typeof data.enabled !== 'boolean' || typeof data.automaticDailyEnabled !== 'boolean' || !count(data.dailyGroupLimit)
    || !(data.nextRunAt === null || typeof data.nextRunAt === 'string')) throw new Error('Invalid automatic merge status response.');
  return { ...data, currentJob: data.currentJob ? parseAdminMergeJob(data.currentJob) : null,
    latestPreview: data.latestPreview ? parseAdminMergeJob(data.latestPreview) : null,
    latestApply: data.latestApply ? parseAdminMergeJob(data.latestApply) : null };
}

export function adminMergePollInterval(state: { status: string; data?: AdminMergeJob }): number | false {
  return state.status !== 'error' && state.data?.status === 'running' ? 3000 : false;
}

export function forgetMatchingAdminMerge(scope: string, id: string) {
  try { if (localStorage.getItem(scope) === id) localStorage.removeItem(scope); } catch { /* Storage is optional. */ }
}

function savedJob(scope: string) {
  try { const id = localStorage.getItem(scope); return validId(id) ? id : null; } catch { return null; }
}

function jobTime(job: AdminMergeJob) {
  return typeof job.startedAt === 'number' ? job.startedAt : Date.parse(job.createdAt || job.startedAt || '') || 0;
}

export function useAdminDuplicateMerge(account: string | null) {
  const client = useQueryClient();
  const scope = account ? adminMergeStorageKey(account) : null;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const [selection, setSelection] = useState<{ scope: string | null; id: string | null }>({ scope, id: scope ? savedJob(scope) : null });
  const [request, setRequest] = useState<{ scope: string; pending: boolean; error: string | null } | null>(null);
  const [expired, setExpired] = useState<{ scope: string; id: string } | null>(null);
  const retired = useRef(new Set<string>());
  const requestLock = useRef(false);
  useEffect(() => {
    setSelection({ scope, id: scope ? savedJob(scope) : null });
    setRequest(null); setExpired(null); retired.current.clear(); requestLock.current = false;
  }, [scope]);

  const remember = useCallback((id: string) => {
    if (!scope || scopeRef.current !== scope) return;
    try { localStorage.setItem(scope, id); } catch { /* Keep working without localStorage. */ }
    setSelection({ scope, id }); setExpired(null);
  }, [scope]);

  const schedule = useQuery({
    queryKey: ['/api/admin/auto-merge-status', scope], queryFn: ({ signal }) => readSchedule(signal),
    enabled: Boolean(scope), retry: false, staleTime: 0, refetchOnMount: 'always',
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    // The selected job has its own 3-second poll; idle status is lightweight.
    refetchInterval: query => query.state.status === 'error' ? false : 30_000,
  });
  const storedId = selection.scope === scope ? selection.id : null;
  const serverLatest = [schedule.data?.latestPreview, schedule.data?.latestApply].filter((job): job is AdminMergeJob => Boolean(job))
    .sort((a, b) => jobTime(b) - jobTime(a))[0];
  const suggestedId = schedule.data?.currentJob?.jobId || serverLatest?.jobId || null;
  const activeId = schedule.data?.currentJob?.jobId;
  const jobId = (activeId && !retired.current.has(activeId) ? activeId : null) || storedId || (suggestedId && !retired.current.has(suggestedId) ? suggestedId : null);
  useEffect(() => {
    // Keep the adopted running/server-latest job selected after it finishes,
    // even when currentJob becomes null in the next scheduler snapshot.
    if (scope && jobId && jobId !== storedId) remember(jobId);
  }, [scope, jobId, storedId, remember]);
  const query = useQuery({
    queryKey: ['/api/admin/merge-jobs', scope, jobId], queryFn: ({ signal }) => readAdminMergeJob(jobId!, signal),
    enabled: Boolean(scope && jobId), retry: false, staleTime: 0, refetchOnMount: 'always',
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    refetchInterval: query => adminMergePollInterval(query.state),
  });
  useEffect(() => {
    if (!scope || !jobId || !query.error || scopeRef.current !== scope) return;
    const error = query.error as Error & { status?: number };
    if (error.status !== 404 && error.status !== 410 && !/^(404|410):(?:\s|$)/.test(error.message)) return;
    forgetMatchingAdminMerge(scope, jobId); retired.current.add(jobId);
    setSelection(current => current.scope === scope && current.id === jobId ? { scope, id: null } : current);
    setExpired({ scope, id: jobId });
  }, [scope, jobId, query.error]);

  const job = query.data;
  const currentJob = schedule.data?.currentJob;
  const pending = request?.scope === scope && request.pending;
  const error = request?.scope === scope ? request.error : null;
  const busy = Boolean(pending || job?.status === 'running' || currentJob?.status === 'running');
  const ready = Boolean(scope && schedule.isSuccess && schedule.data.enabled && !schedule.isFetching && !schedule.error && !query.error && !query.isFetching && !error && !busy);
  const preview = job?.dryRun && job.status === 'completed' ? job : null;
  const alreadyApplied = preview && schedule.data?.latestApply?.previewJobId === preview.jobId;
  const canApply = Boolean(ready && preview && preview.results.eligibleGroups > 0 && !alreadyApplied);

  const refresh = useCallback(async () => {
    const requestedScope = scope;
    const [statusResult, jobResult] = await Promise.all([schedule.refetch(), jobId ? query.refetch() : Promise.resolve(null)]);
    if (scopeRef.current === requestedScope && !statusResult.error && !jobResult?.error) setRequest(null);
  }, [scope, schedule.refetch, query.refetch, jobId]);

  const start = useCallback(async (previewJobId?: string) => {
    if (!scope || !ready || requestLock.current || (previewJobId && (!canApply || preview?.jobId !== previewJobId))) return false;
    requestLock.current = true; setRequest({ scope, pending: true, error: null });
    try {
      const response = await apiRequest('POST', '/api/admin/auto-merge-all', { body: previewJobId ? { dryRun: false, previewJobId } : { dryRun: true } });
      const data = await response.json();
      if (data?.success !== true || !validId(data.jobId)) throw new Error('The server did not return a valid job ID.');
      if (scopeRef.current !== scope) return false;
      remember(data.jobId); setRequest(null);
      await client.invalidateQueries({ queryKey: ['/api/admin/auto-merge-status', scope] });
      return true;
    } catch (error) {
      if (scopeRef.current === scope) setRequest({ scope, pending: false, error: `${error instanceof Error ? error.message : 'Request failed'}. Refresh status before retrying; a server job may already have started.` });
      return false;
    } finally { if (scopeRef.current === scope) requestLock.current = false; }
  }, [scope, ready, canApply, preview?.jobId, remember, client]);

  useEffect(() => {
    if (job?.status === 'completed' || job?.status === 'failed') {
      void client.invalidateQueries({ queryKey: ['/api/admin/auto-merge-status', scope] });
    }
  }, [client, scope, job?.jobId, job?.status]);

  return { job, jobId, preview, schedule: schedule.data, busy, ready, canApply, pending, start, refresh,
    isLoading: schedule.isLoading || Boolean(jobId && query.isLoading),
    error: error || (query.error as Error | null)?.message || (schedule.error as Error | null)?.message || null,
    expiredJobId: expired?.scope === scope ? expired.id : null,
  };
}
