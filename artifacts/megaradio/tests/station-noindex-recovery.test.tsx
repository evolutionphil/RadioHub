import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../src/lib/queryClient';
import { StationNoindexRecovery } from '../src/components/admin/StationNoindexRecovery';

const clients: QueryClient[] = [];
const preview = () => ({ previewId: 'preview-1', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
  totalScanned: 62020, totalNoIndex: 13294, totalCandidates: 30, candidateLimit: 100, reasonCounts: { 'manual-protection': 4 },
  candidates: Array.from({ length: 30 }, (_, index) => ({ id: `id-${index}`, slug: `radio-${index}`, name: `Radio ${index}`, country: 'Germany', countryCode: 'DE',
    lastCheckOkTime: '2026-09-16T10:00:00Z', completeLanguageCount: 14, evidence: { provenance: 'legacy', providerUuidPresent: true, recentProviderSuccess: true, identityPeers: 0 } })) });
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><StationNoindexRecovery /></QueryClientProvider>);
}
async function scan() { fireEvent.click(screen.getByRole('button', { name: 'Onarım adaylarını incele' })); await screen.findByRole('checkbox', { name: 'Radio 0 onarım için seç' }); }
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('explicit legacy noindex recovery', () => {
  it('does not scan on mount or preselect candidates after a read-only preview', async () => {
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify(preview())));
    show(); expect(apiRequest).not.toHaveBeenCalled(); await scan();
    expect(apiRequest).toHaveBeenCalledWith('POST', '/api/admin/seo-noindex-recovery/preview', { body: {} });
    expect(screen.getAllByRole('checkbox').every(checkbox => !(checkbox as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: 'Seçilen 0 radyoyu onar' })).toBeDisabled();
  });
  it('caps selection at 25 and never applies after cancelled confirmation', async () => {
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify(preview())));
    const nativeConfirm = vi.spyOn(window, 'confirm'); show(); await scan();
    fireEvent.click(screen.getByRole('button', { name: 'İlk 25 adayı seç' }));
    expect(screen.getAllByRole('checkbox').filter(checkbox => (checkbox as HTMLInputElement).checked)).toHaveLength(25);
    expect(screen.getByRole('checkbox', { name: 'Radio 29 onarım için seç' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Seçilen 25 radyoyu onar' }));
    expect(screen.getByRole('group', { name: 'Seçili radyo onarımını onayla' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
  it('sends only the explicit selection, displays a verified receipt and requires a fresh preview', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(new Response(JSON.stringify(preview()))).mockResolvedValueOnce(new Response(JSON.stringify({ restored: 1, restoredIds: ['id-0'], skipped: 0, skippedReasons: [] })));
    show(); await scan();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Radio 0 onarım için seç' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seçilen 1 radyoyu onar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Onarımı uygula' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('POST', '/api/admin/seo-noindex-recovery/apply', { body: { previewId: 'preview-1', stationIds: ['id-0'] } }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 radyonun noindex işareti kaldırıldı');
    expect(screen.getByRole('checkbox', { name: 'Radio 0 onarım için seç' })).toBeDisabled();
  });
  it('does not automatically retry an ambiguous write and invalidates the stale preview', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(new Response(JSON.stringify(preview()))).mockRejectedValueOnce(new Error('409 RECOVERY_STALE'));
    show(); await scan();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Radio 0 onarım için seç' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seçilen 1 radyoyu onar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Onarımı uygula' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Onarım doğrulanamadı');
    expect(screen.getByRole('button', { name: 'Seçilen 0 radyoyu onar' })).toBeDisabled();
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
