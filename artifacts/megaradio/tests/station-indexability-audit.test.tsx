import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../src/lib/queryClient';
import { StationIndexabilityAudit } from '../src/components/admin/StationIndexabilityAudit';

const report = { total: 62020, snapshotAt: '2026-09-17T00:00:00Z', reasons: { 'legacy-unknown-noindex': 13294, 'passes-station-rules': 48726 },
  storedNoIndexQualityReasons: { 'no-current-quality-rule': 100 }, reviewCandidates: { 'unknown-flag-without-current-quality-rule': 100 }, samples: [],
  languages: [{ language: 'en', qualified: true, indexable: 48707, excluded: 13313, localeIneligible: 0, publishedUrls: 48707,
    manifestGeneratedAt: '2026-09-17T00:00:00Z', missingFull: 1097, missingMeta: 1098, incomplete: 1098, indexableIncomplete: 3, exclusions: { 'legacy-unknown-noindex': 13294 } }] };
const clients: QueryClient[] = [];
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><StationIndexabilityAudit /></QueryClientProvider>);
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.clearAllMocks(); });
describe('on-demand catalog indexability audit', () => {
  it('does not scan on page load; runs only after explicit action through authenticated transport', async () => {
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify(report)));
    show(); expect(apiRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Tüm kayıtları CSV indir' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tüm kataloğu incele' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('GET', '/api/admin/seo-indexability-audit', { signal: expect.any(AbortSignal) }));
    expect(await screen.findByText(/Global rapor/)).toBeInTheDocument();
    expect(screen.getByText('Kaynağı bilinmeyen eski noindex')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tüm kayıtları CSV indir' })).toBeEnabled();
  });
  it('retains completed results with a clear failure message after a failed retry', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(new Response(JSON.stringify(report))).mockRejectedValueOnce(new Error('503'));
    show(); fireEvent.click(screen.getByRole('button', { name: 'Tüm kataloğu incele' }));
    await screen.findByText(/Global rapor/);
    fireEvent.click(screen.getByRole('button', { name: 'Tüm kataloğu incele' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('İnceleme tamamlanamadı');
    expect(screen.getByRole('alert')).toHaveTextContent('önceki tamamlanmış rapor');
    expect(screen.getByText(/Global rapor/)).toBeInTheDocument();
  });
});
