import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminDescriptionRepair from '../src/components/stations/admin-description-repair';

const mocks = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn(), started: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
function mount(busy = false) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <AdminDescriptionRepair busy={busy} onStarted={mocks.started} />
  </QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ json: async () => ({ success: true, jobId: 'bulk-desc-repair', total: 83 }) });
});
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Bulk AI repair · 14 languages' }));

describe('catalogue-wide description repair', () => {
  it('reviews the global scope, language count, safeguards and cost before any request', () => {
    mount(); open();
    expect(screen.getByRole('dialog')).toHaveTextContent('not just this page or your current filters');
    expect(screen.getByRole('dialog')).toHaveTextContent('All 14 site languages');
    expect(screen.getByRole('dialog')).toHaveTextContent('manually protected');
    expect(screen.getByRole('dialog')).toHaveTextContent('API charges may apply');
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('starts the dedicated global operation without a page limit, selection or locale subset', async () => {
    mount(); open(); fireEvent.click(screen.getByRole('button', { name: 'Start catalogue repair' }));
    await waitFor(() => expect(mocks.started).toHaveBeenCalledWith('bulk-desc-repair', 83));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith('POST', '/api/admin/stations/repair-description-gaps', { body: {} });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('does not start an additional job while an existing job is running', () => {
    mount(true);
    expect(screen.getByRole('button', { name: 'Bulk AI repair · 14 languages' })).toBeDisabled();
  });
  it('prevents duplicate submissions while matching stations', async () => {
    mocks.request.mockImplementation(() => new Promise(() => {}));
    mount(); open(); fireEvent.click(screen.getByRole('button', { name: 'Start catalogue repair' }));
    expect(await screen.findByRole('button', { name: 'Finding eligible stations…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('reports an empty eligible work list without creating phantom progress', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ success: false, total: 0, message: 'No matching stations need processing.' }) });
    mount(); open(); fireEvent.click(screen.getByRole('button', { name: 'Start catalogue repair' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'No automatic repairs needed' })));
    expect(mocks.started).not.toHaveBeenCalled();
  });
  it('keeps failures visible and never automatically retries a paid job request', async () => {
    mocks.request.mockRejectedValue(new Error('409: Another description job is running'));
    mount(); open(); fireEvent.click(screen.getByRole('button', { name: 'Start catalogue repair' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Another description job is running');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.started).not.toHaveBeenCalled();
  });
  it('rejects an incomplete success response instead of pretending a job started', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ success: true, total: 83 }) });
    mount(); open(); fireEvent.click(screen.getByRole('button', { name: 'Start catalogue repair' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid repair job');
    expect(mocks.started).not.toHaveBeenCalled();
  });
});
