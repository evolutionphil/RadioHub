import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

export const LEGACY_AI_JOB_KEY = 'bulkAiJobId';
export const adminAiJobStorageKey = (account: string) => `admin:station-description-job:v2:${encodeURIComponent(account)}`;
const validJobId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value);

/** Compare before removing: an old response must not erase a newer tab's job. */
export function removeMatchingAdminAiJob(key: string, expectedJobId: string): boolean {
  try {
    if (localStorage.getItem(key) !== expectedJobId) return false;
    localStorage.removeItem(key);
    return true;
  } catch { return false; }
}

function restoreJob(key: string): string | null {
  try {
    const scoped = localStorage.getItem(key);
    if (validJobId(scoped)) return scoped;
    const legacy = localStorage.getItem(LEGACY_AI_JOB_KEY);
    if (!validJobId(legacy)) return null;
    // A one-time migration preserves an existing live job. Future restores and
    // requests are account-scoped; no job is inferred from another scoped key.
    localStorage.setItem(key, legacy);
    removeMatchingAdminAiJob(LEGACY_AI_JOB_KEY, legacy);
    return legacy;
  } catch { return null; }
}

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const explicit = (error as { status?: unknown }).status;
  if (typeof explicit === 'number') return explicit;
  // apiRequest currently preserves the HTTP status in the leading error text.
  const match = /^(\d{3}):(?:\s|$)/.exec(String((error as { message?: unknown }).message || ''));
  return match ? Number(match[1]) : undefined;
}

type JobResult = { kind: 'expired'; jobId: string } | { kind: 'job'; jobId: string; snapshot: Record<string, any> };
export async function readAdminDescriptionJob(jobId: string, signal?: AbortSignal): Promise<JobResult> {
  try {
    const response = await apiRequest('GET', `/api/admin/stations/description-job-status/${encodeURIComponent(jobId)}`, { signal });
    const snapshot = await response.json();
    if (!snapshot || snapshot.jobId !== jobId || !['running', 'paused', 'completed', 'failed', 'cancelled'].includes(snapshot.status)) {
      throw new Error('Invalid AI job status response');
    }
    return { kind: 'job', jobId, snapshot };
  } catch (error) {
    const status = statusCode(error);
    if (status === 404 || status === 410) return { kind: 'expired', jobId };
    throw error;
  }
}

export function adminDescriptionJobPollInterval(state: { status: string; data?: JobResult }): number | false {
  // Query retains previous running data after a fetch error. Do not let that
  // stale snapshot turn a missing record or failing server into a polling loop.
  return state.status !== 'error' && state.data?.kind === 'job' && state.data.snapshot.status === 'running' ? 2000 : false;
}

export function useAdminDescriptionJob(account: string | null) {
  const scope = account ? adminAiJobStorageKey(account) : null;
  const currentScope = useRef(scope); currentScope.current = scope;
  const [selection, setSelection] = useState<{ scope: string | null; id: string | null }>({ scope: null, id: null });
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [restored, setRestored] = useState<{ scope: string; id: string } | null>(null);
  const [expired, setExpired] = useState<{ scope: string; id: string } | null>(null);

  useEffect(() => {
    const id = scope ? restoreJob(scope) : null;
    const next = { scope, id }; selectionRef.current = next; setSelection(next);
    setRestored(scope && id ? { scope, id } : null);
    setExpired(null);
  }, [scope]);

  const jobId = selection.scope === scope ? selection.id : null;
  const setJobId = useCallback((id: string | null) => {
    if (!scope || currentScope.current !== scope) return;
    if (id !== null && !validJobId(id)) return;
    const previous = selectionRef.current;
    try {
      if (id) localStorage.setItem(scope, id);
      else if (previous.scope === scope && previous.id) removeMatchingAdminAiJob(scope, previous.id);
    } catch { /* A blocked storage API must not prevent an in-memory job. */ }
    const next = { scope, id }; selectionRef.current = next; setSelection(next); setExpired(null);
  }, [scope]);

  const query = useQuery({
    queryKey: ['/api/admin/stations/description-job-status', scope, jobId],
    queryFn: ({ signal }) => readAdminDescriptionJob(jobId!, signal),
    enabled: Boolean(scope && jobId),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (attempt, error) => attempt < 1 && ![401, 403, 404, 410].includes(statusCode(error) || 0),
    refetchInterval: query => adminDescriptionJobPollInterval(query.state),
  });

  useEffect(() => {
    const result = query.data;
    if (!scope || !jobId || result?.kind !== 'expired' || result.jobId !== jobId) return;
    if (currentScope.current !== scope || selectionRef.current.scope !== scope || selectionRef.current.id !== jobId) return;
    removeMatchingAdminAiJob(scope, jobId);
    // A legacy tab may still write the old key while this request is in flight.
    removeMatchingAdminAiJob(LEGACY_AI_JOB_KEY, jobId);
    const next = { scope, id: null }; selectionRef.current = next; setSelection(next);
    setExpired({ scope, id: jobId });
  }, [scope, jobId, query.data]);

  return {
    jobId, setJobId,
    restoredJobId: restored?.scope === scope ? restored.id : null,
    expiredJobId: expired?.scope === scope ? expired.id : null,
    status: query.data?.kind === 'job' ? query.data.snapshot : undefined,
    isLoading: Boolean(jobId && query.isLoading),
    error: jobId ? query.error : null,
    refetch: query.refetch,
  };
}
