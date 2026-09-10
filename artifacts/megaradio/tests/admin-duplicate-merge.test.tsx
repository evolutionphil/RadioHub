import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFile } from 'node:fs/promises';
import AdminDuplicateMergePanel from '../src/components/stations/admin-duplicate-merge-panel';
import { adminMergePollInterval, adminMergeStorageKey, forgetMatchingAdminMerge, parseAdminMergeJob, readAdminMergeJob, type AdminMergeJob } from '../src/hooks/useAdminDuplicateMerge';

const mocks = vi.hoisted(() => ({ request: vi.fn(), account: 'admin-one' as string | null }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request }));
vi.mock('@/hooks/useAdminAuth', () => ({ useAdminAuth: () => ({ isAuthenticated: Boolean(mocks.account), isAdmin: Boolean(mocks.account), user: mocks.account ? { username: mocks.account } : null }) }));

function job(id = 'preview-one', changes: Partial<AdminMergeJob> = {}): AdminMergeJob {
  return { jobId: id, dryRun: true, status: 'completed', startedAt: 1000,
    progress: { currentStep: 'Finished', percentage: 100, groupsProcessed: 655, totalGroups: 655 },
    results: { totalGroups: 655, eligibleGroups: 12, skippedGroups: 643, mergedGroups: 0, totalStationsToDelete: 15, totalStationsDeleted: 0,
      skippedReasons: [{ reason: 'Known city values conflict', count: 643 }], errors: [] }, ...changes };
}
let schedule: any;
let jobs: Map<string, AdminMergeJob>;
const reply = (body: unknown) => ({ json: async () => body });
function setup(children: React.ReactNode = <AdminDuplicateMergePanel />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}>{children}</QueryClientProvider>), client };
}
function usePreview(preview = job()) {
  jobs.set(preview.jobId, preview); schedule.latestPreview = preview;
  localStorage.setItem(adminMergeStorageKey(mocks.account!), preview.jobId);
}
beforeEach(() => {
  mocks.request.mockReset(); mocks.account = 'admin-one'; localStorage.clear(); jobs = new Map();
  schedule = { enabled: true, automaticDailyEnabled: true, dailyGroupLimit: 100, nextRunAt: '2026-09-12T10:00:00Z', currentJob: null, latestPreview: null, latestApply: null };
  mocks.request.mockImplementation(async (method, url, options) => {
    if (method === 'GET' && url === '/api/admin/auto-merge-status') return reply(schedule);
    if (method === 'GET' && url.startsWith('/api/admin/merge-jobs/')) {
      const value = jobs.get(url.split('/').pop());
      if (!value) throw new Error('404: Job not found');
      return reply(value);
    }
    if (method === 'POST' && url === '/api/admin/auto-merge-all') {
      const next = job(options.body.dryRun ? 'preview-new' : 'apply-new', { status: 'running', dryRun: options.body.dryRun, previewJobId: options.body.previewJobId, startedAt: 2000 });
      jobs.set(next.jobId, next); schedule = { ...schedule, currentJob: next };
      return reply({ success: true, async: true, jobId: next.jobId });
    }
    throw new Error(`Unexpected ${method} ${url}`);
  });
});

describe('durable catalogue merge workflow', () => {
  it('starts a whole-catalogue preview with no loaded-page IDs and does not apply it automatically', async () => {
    setup();
    const preview = screen.getByRole('button', { name: 'Preview all candidate groups' });
    await waitFor(() => expect(preview).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Merge all eligible groups' })).toBeDisabled();
    expect(screen.getByText(/not just this page or the current filters/)).toBeInTheDocument();
    fireEvent.click(preview);
    await screen.findByText('Preview running');
    expect(mocks.request.mock.calls.filter(call => call[0] === 'POST')).toEqual([['POST', '/api/admin/auto-merge-all', { body: { dryRun: true } }]]);
    expect(localStorage.getItem(adminMergeStorageKey('admin-one'))).toBe('preview-new');
    expect(preview).toBeDisabled();
  });
  it('shows 655 candidates as only 12 eligible, skipped reasons, and explicit confirmation before apply', async () => {
    usePreview(); setup();
    const apply = await screen.findByRole('button', { name: 'Merge 12 eligible groups' });
    await waitFor(() => expect(apply).toBeEnabled());
    expect(screen.getByText('Known city values conflict')).toBeInTheDocument();
    expect(screen.getByText('Automatic safe merge · daily')).toBeInTheDocument();
    fireEvent.click(apply);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveClass('bg-white', 'text-slate-950', 'overflow-y-auto', 'w-[calc(100vw-2rem)]');
    expect(dialog).not.toHaveClass('bg-background');
    expect(within(dialog).getByText('Merge 12 eligible groups?')).toBeInTheDocument();
    expect(within(dialog).getByText(/Existing station URLs redirect/)).toBeInTheDocument();
    expect(mocks.request.mock.calls.filter(call => call[0] === 'POST')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm eligible merge' }));
    await screen.findByText('Merge running');
    expect(mocks.request).toHaveBeenCalledWith('POST', '/api/admin/auto-merge-all', { body: { dryRun: false, previewJobId: 'preview-one' } });
    expect(localStorage.getItem(adminMergeStorageKey('admin-one'))).toBe('apply-new');
  });
  it('canceling confirmation neither merges nor cancels a server job', async () => {
    usePreview(); setup();
    const apply = await screen.findByRole('button', { name: 'Merge 12 eligible groups' });
    await waitFor(() => expect(apply).toBeEnabled()); fireEvent.click(apply);
    fireEvent.click(screen.getByRole('button', { name: 'Keep separate' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mocks.request.mock.calls.some(call => call[0] === 'POST')).toBe(false);
  });
  it('disables apply for empty, failed, or running previews', async () => {
    const preview = job(); preview.results.eligibleGroups = 0; usePreview(preview); setup();
    await screen.findByText('No groups are eligible for automatic merging. Review the remaining candidates individually.');
    expect(screen.getByRole('button', { name: 'Merge 0 eligible groups' })).toBeDisabled();
    expect(adminMergePollInterval({ status: 'success', data: job('x', { status: 'failed' }) })).toBe(false);
  });
  it('restores running progress after leaving without sending a mutation or cancel', async () => {
    usePreview(job('apply-persisted', { dryRun: false, status: 'running' }));
    const first = setup(); await screen.findByText('Merge running'); first.unmount();
    setup(); await screen.findByText('Merge running');
    expect(screen.getByText(/server continues and progress is restored/)).toBeInTheDocument();
    expect(mocks.request.mock.calls.filter(call => call[0] !== 'GET')).toHaveLength(0);
    expect(localStorage.getItem(adminMergeStorageKey('admin-one'))).toBe('apply-persisted');
  });
  it('does not poll another account’s saved ID or fetch before admin identity is ready', async () => {
    localStorage.setItem(adminMergeStorageKey('admin-two'), 'someone-elses-job');
    mocks.account = null; const page = setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview all candidate groups' })).toBeDisabled());
    expect(mocks.request).not.toHaveBeenCalled(); page.unmount(); mocks.account = 'admin-one'; setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview all candidate groups' })).toBeEnabled());
    expect(mocks.request.mock.calls.some(call => String(call[1]).includes('someone-elses-job'))).toBe(false);
  });
  it.each([404, 410])('retires missing saved jobs on %s without starting a replacement', async status => {
    localStorage.setItem(adminMergeStorageKey('admin-one'), 'gone');
    const normal = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((method, url, options) => url.endsWith('/gone') ? Promise.reject(new Error(`${status}: unavailable`)) : normal(method, url, options));
    setup(); await screen.findByText(/saved job no longer exists or has expired/);
    expect(localStorage.getItem(adminMergeStorageKey('admin-one'))).toBeNull();
    expect(mocks.request.mock.calls.filter(call => call[1].endsWith('/gone'))).toHaveLength(1);
    expect(mocks.request.mock.calls.some(call => call[0] === 'POST')).toBe(false);
  });
  it('stops on real errors, keeps the job pointer, and lets the admin explicitly retry status', async () => {
    usePreview(); let failure = true; const normal = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((method, url, options) => failure && url.endsWith('/preview-one') ? Promise.reject(new Error('503: server unavailable')) : normal(method, url, options));
    setup(); await screen.findByText(/Status checking stopped:/);
    expect(localStorage.getItem(adminMergeStorageKey('admin-one'))).toBe('preview-one');
    expect(screen.getByRole('button', { name: 'Preview all candidate groups' })).toBeDisabled();
    failure = false; fireEvent.click(screen.getByRole('button', { name: 'Refresh merge status' }));
    await screen.findByText('Preview completed');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Merge 12 eligible groups' })).toBeEnabled());
  });
  it('prevents a double enqueue and requires status refresh after an uncertain request failure', async () => {
    let rejectPost: (error: Error) => void = () => {};
    const normal = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((method, url, options) => method === 'POST' ? new Promise((_resolve, reject) => { rejectPost = reject; }) : normal(method, url, options));
    setup(); const preview = screen.getByRole('button', { name: 'Preview all candidate groups' });
    await waitFor(() => expect(preview).toBeEnabled()); fireEvent.click(preview); fireEvent.click(preview);
    expect(mocks.request.mock.calls.filter(call => call[0] === 'POST')).toHaveLength(1);
    rejectPost(new Error('Network connection lost')); await screen.findByText(/server job may already have started/);
    expect(preview).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Refresh merge status' }));
    await waitFor(() => expect(preview).toBeEnabled());
  });
  it('does not let an expired pointer erase a newer tab’s saved job', () => {
    const key = adminMergeStorageKey('admin-one'); localStorage.setItem(key, 'newer');
    forgetMatchingAdminMerge(key, 'older'); expect(localStorage.getItem(key)).toBe('newer');
    forgetMatchingAdminMerge(key, 'newer'); expect(localStorage.getItem(key)).toBeNull();
  });
  it('disables queueing while the backend worker is paused', async () => {
    usePreview(); schedule.enabled = false; schedule.automaticDailyEnabled = false; setup();
    await screen.findByText('Preview completed');
    expect(screen.getByText('Automatic safe merge is paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview all candidate groups' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Merge 12 eligible groups' })).toBeDisabled();
  });
  it('restores the newest server job by numeric timestamp when local storage is absent', async () => {
    schedule.latestPreview = job('older', { startedAt: 1000 }); schedule.latestApply = job('newer', { dryRun: false, startedAt: 2000 });
    jobs.set('older', schedule.latestPreview); jobs.set('newer', schedule.latestApply); setup();
    await screen.findByText('Merge completed');
    expect(localStorage.getItem(adminMergeStorageKey('admin-one'))).toBe('newer');
    expect(screen.getByRole('button', { name: 'Merge all eligible groups' })).toBeDisabled();
  });
  it('does not offer to reapply a preview that already has an apply job', async () => {
    usePreview(); schedule.latestApply = job('previous-apply', { dryRun: false, previewJobId: 'preview-one' }); setup();
    await screen.findByText('Preview completed');
    expect(screen.getByRole('button', { name: 'Merge 12 eligible groups' })).toBeDisabled();
  });
  it('rejects malformed or mismatched job payloads and stops polling every terminal/error state', async () => {
    expect(() => parseAdminMergeJob({ ...job(), results: { ...job().results, eligibleGroups: -5 } })).toThrow('Invalid merge status');
    expect(() => parseAdminMergeJob({ ...job(), status: 'unknown' })).toThrow('Invalid merge status');
    jobs.set('requested', job('wrong')); await expect(readAdminMergeJob('requested')).rejects.toThrow('different job');
    expect(adminMergePollInterval({ status: 'success', data: job('live', { status: 'running' }) })).toBe(3000);
    expect(adminMergePollInterval({ status: 'error', data: job('live', { status: 'running' }) })).toBe(false);
    expect(adminMergePollInterval({ status: 'success', data: job() })).toBe(false);
  });
  it('uses the shared guarded workflow on both duplicate screens without legacy apply bypasses', async () => {
    const stations = await readFile('src/pages/stations.tsx', 'utf8');
    const dedicated = await readFile('src/pages/admin/duplicates.tsx', 'utf8');
    expect(stations).toContain('<AdminDuplicateMergePanel />');
    expect(dedicated).toContain('<AdminDuplicateMergePanel');
    expect(dedicated).not.toContain('autoMergeAll(false)');
    expect(dedicated).not.toContain('Similarity Threshold');
    expect(dedicated).toContain('setTimeout(() => void poll(), 3000)');
    expect(dedicated).toContain('Retry job status');
  });
});
