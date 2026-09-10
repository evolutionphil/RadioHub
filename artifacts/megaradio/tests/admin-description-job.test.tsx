import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request }));
import { adminAiJobStorageKey, adminDescriptionJobPollInterval, LEGACY_AI_JOB_KEY, readAdminDescriptionJob, removeMatchingAdminAiJob, useAdminDescriptionJob } from '../src/hooks/useAdminDescriptionJob';

const clients: QueryClient[] = [];
function setup(account: string | null = 'alice') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 1, gcTime: 0 } } }); clients.push(client);
  return { client, ...renderHook(({ account }) => useAdminDescriptionJob(account), { initialProps: { account }, wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }) };
}
const response = (jobId: string, status = 'running') => ({ json: async () => ({ jobId, status, total: 4, processed: 1, successful: 1, failed: 0, skipped: 0 }) });
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); });

describe('expired AI job polling', () => {
  it.each([404, 410])('treats HTTP %s as terminal absence, clears the exact pointer, and does not fetch it on remount', async code => {
    localStorage.setItem(LEGACY_AI_JOB_KEY, 'fix-en-old');
    localStorage.setItem(adminAiJobStorageKey('bob'), 'bobs-live-job');
    mocks.request.mockRejectedValue(new Error(`${code}: Job not found`));
    const first = setup();
    await waitFor(() => expect(first.result.current.expiredJobId).toBe('fix-en-old'));
    expect(first.result.current.jobId).toBeNull(); expect(first.result.current.error).toBeNull();
    expect(localStorage.getItem(adminAiJobStorageKey('alice'))).toBeNull(); expect(localStorage.getItem(LEGACY_AI_JOB_KEY)).toBeNull();
    expect(localStorage.getItem(adminAiJobStorageKey('bob'))).toBe('bobs-live-job');
    expect(mocks.request).toHaveBeenCalledOnce();
    first.unmount(); const second = setup();
    await waitFor(() => expect(second.result.current.jobId).toBeNull());
    expect(mocks.request).toHaveBeenCalledOnce();
  });
  it('migrates a live legacy pointer only once and passes cancellation through to the request', async () => {
    localStorage.setItem(LEGACY_AI_JOB_KEY, 'old-live'); mocks.request.mockResolvedValue(response('old-live'));
    const hook = setup(); await waitFor(() => expect(hook.result.current.status?.status).toBe('running'));
    expect(localStorage.getItem(adminAiJobStorageKey('alice'))).toBe('old-live'); expect(localStorage.getItem(LEGACY_AI_JOB_KEY)).toBeNull();
    expect(hook.result.current.restoredJobId).toBe('old-live');
    expect(mocks.request.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
  });
  it('stops after a cached running job becomes missing instead of retaining the running polling interval', async () => {
    localStorage.setItem(adminAiJobStorageKey('alice'), 'was-running');
    mocks.request.mockResolvedValueOnce(response('was-running')).mockRejectedValueOnce(new Error('404: Job not found'));
    const hook = setup(); await waitFor(() => expect(hook.result.current.status?.status).toBe('running'));
    await act(async () => { await hook.result.current.refetch(); });
    await waitFor(() => expect(hook.result.current.expiredJobId).toBe('was-running'));
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(adminDescriptionJobPollInterval({ status: 'success', data: { kind: 'expired', jobId: 'was-running' } })).toBe(false);
  });
  it('does not poll a cached running snapshot once a real error is present', () => {
    const data = { kind: 'job' as const, jobId: 'live', snapshot: { status: 'running' } };
    expect(adminDescriptionJobPollInterval({ status: 'success', data })).toBe(2000);
    expect(adminDescriptionJobPollInterval({ status: 'error', data })).toBe(false);
    for (const status of ['paused', 'completed', 'failed', 'cancelled']) expect(adminDescriptionJobPollInterval({ status: 'success', data: { ...data, snapshot: { status } } })).toBe(false);
  });
  it.each([401, 403, 500])('retains the pointer and supports explicit retry after HTTP %s', async code => {
    localStorage.setItem(adminAiJobStorageKey('alice'), 'retryable-job'); mocks.request.mockRejectedValue(new Error(`${code}: Actual error`));
    const hook = setup(); await waitFor(() => expect(hook.result.current.error).toBeTruthy());
    expect(hook.result.current.expiredJobId).toBeNull(); expect(hook.result.current.jobId).toBe('retryable-job');
    expect(localStorage.getItem(adminAiJobStorageKey('alice'))).toBe('retryable-job');
    expect(mocks.request).toHaveBeenCalledTimes(code === 500 ? 2 : 1);
    mocks.request.mockResolvedValue(response('retryable-job', 'failed'));
    await act(async () => { await hook.result.current.refetch(); });
    await waitFor(() => expect(hook.result.current.status?.status).toBe('failed')); expect(hook.result.current.expiredJobId).toBeNull();
  });
  it('rejects malformed or mismatched response IDs as real errors, not absence', async () => {
    mocks.request.mockResolvedValue(response('different-job'));
    await expect(readAdminDescriptionJob('requested-job')).rejects.toThrow('Invalid AI job status response');
    mocks.request.mockRejectedValue(new Error('network failed while body mentioned 404'));
    await expect(readAdminDescriptionJob('requested-job')).rejects.toThrow('network failed');
  });
});

describe('account and late-response safety', () => {
  it('does not restore, migrate, or poll until the admin identity is known', async () => {
    localStorage.setItem(LEGACY_AI_JOB_KEY, 'wait-for-admin'); const hook = setup(null);
    expect(hook.result.current.jobId).toBeNull(); expect(mocks.request).not.toHaveBeenCalled(); expect(localStorage.getItem(LEGACY_AI_JOB_KEY)).toBe('wait-for-admin');
    mocks.request.mockResolvedValue(response('wait-for-admin')); hook.rerender({ account: 'alice' });
    await waitFor(() => expect(hook.result.current.jobId).toBe('wait-for-admin'));
  });
  it('never clears another account or a newer pointer written by another tab', async () => {
    localStorage.setItem(adminAiJobStorageKey('alice'), 'stale');
    let reject!: (error: unknown) => void; mocks.request.mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
    const hook = setup(); await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    localStorage.setItem(adminAiJobStorageKey('alice'), 'new-in-another-tab'); localStorage.setItem(LEGACY_AI_JOB_KEY, 'different-legacy');
    await act(async () => reject(new Error('404: Missing')));
    await waitFor(() => expect(hook.result.current.expiredJobId).toBe('stale'));
    expect(localStorage.getItem(adminAiJobStorageKey('alice'))).toBe('new-in-another-tab'); expect(localStorage.getItem(LEGACY_AI_JOB_KEY)).toBe('different-legacy');
    expect(removeMatchingAdminAiJob(adminAiJobStorageKey('alice'), 'stale')).toBe(false);
  });
  it('ignores an old missing response after selecting a newer job in the same account', async () => {
    localStorage.setItem(adminAiJobStorageKey('alice'), 'stale');
    let reject!: (error: unknown) => void; mocks.request.mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; })).mockResolvedValue(response('new-job'));
    const hook = setup(); await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    act(() => hook.result.current.setJobId('new-job')); await waitFor(() => expect(hook.result.current.status?.jobId).toBe('new-job'));
    await act(async () => reject(new Error('404: Missing')));
    expect(hook.result.current.jobId).toBe('new-job'); expect(hook.result.current.expiredJobId).toBeNull(); expect(localStorage.getItem(adminAiJobStorageKey('alice'))).toBe('new-job');
  });
  it('separates query caches on an account change and ignores responses from the old account', async () => {
    localStorage.setItem(adminAiJobStorageKey('alice'), 'stale'); localStorage.setItem(adminAiJobStorageKey('bob'), 'bobs-job');
    let reject!: (error: unknown) => void; mocks.request.mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; })).mockResolvedValue(response('bobs-job'));
    const hook = setup(); await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    hook.rerender({ account: 'bob' }); await waitFor(() => expect(hook.result.current.status?.jobId).toBe('bobs-job'));
    await act(async () => reject(new Error('404: Missing')));
    expect(hook.result.current.jobId).toBe('bobs-job'); expect(hook.result.current.expiredJobId).toBeNull(); expect(localStorage.getItem(adminAiJobStorageKey('bob'))).toBe('bobs-job');
    expect(localStorage.getItem(adminAiJobStorageKey('alice'))).toBe('stale');
  });
});
