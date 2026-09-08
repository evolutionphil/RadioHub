import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFile } from 'node:fs/promises';
const mocks = vi.hoisted(() => ({ update: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { updateStation: mocks.update } }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAdminAuth', () => ({ useAdminAuth: () => ({ isAuthenticated: false, isAdmin: false, refetch: vi.fn() }) }));
import { buildDescriptionChanges, saveAdminStationEdit, generateAdminStationDescription } from '../src/lib/admin-station-description';
import AdminLogin from '../src/pages/admin/login';
beforeEach(() => { vi.clearAllMocks(); });
const baseline = { de: { full: 'Existing article', meta: '', attribution: 'Kept' }, en: { full: 'Existing English', meta: 'Summary' } };
describe('admin field-only description editor', () => {
  it('preserves siblings and includes the full observed locale object in every explicit change', () => {
    const edited = { ...baseline, de: { ...baseline.de, meta: 'Reviewed summary' } };
    expect(buildDescriptionChanges(JSON.stringify(edited), baseline).changes).toEqual([{ locale: 'de', field: 'meta', value: 'Reviewed summary', expectedCurrentValue: '', expectedLocaleObject: baseline.de }]);
    expect(buildDescriptionChanges(JSON.stringify(baseline), baseline).changes).toEqual([]);
    expect(baseline.de.meta).toBe('');
  });
  it.each(['{', '[]', '', '{}', '{"de":"Incorrect shape"}'])('does not silently turn invalid/removed existing translations into empty data: %s', json => {
    expect(() => buildDescriptionChanges(json, baseline)).toThrow();
  });
  it('rejects unsupported changes and creates explicit absence checks for new locales', () => {
    expect(() => buildDescriptionChanges(JSON.stringify({ ...baseline, xx: { full: 'Wrong locale' } }), baseline)).toThrow();
    expect(() => buildDescriptionChanges(JSON.stringify({ ...baseline, de: { ...baseline.de, attribution: 'Changed' } }), baseline)).toThrow();
    const { changes } = buildDescriptionChanges(JSON.stringify({ ...baseline, tr: { full: 'New Turkish article' } }), baseline);
    expect(changes[0]).toMatchObject({ locale: 'tr', expectedCurrentValue: null, expectedLocaleObject: null });
  });
  it('sends description-only edits to PATCH without an unrelated metadata write', async () => {
    const patch = { slug: 'radio', changes: [{ locale: 'de' }] };
    mocks.request.mockResolvedValue({ json: async () => ({ success: true }) });
    await saveAdminStationEdit('station-id', { descriptionPatch: patch });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledWith('PATCH', '/api/admin/stations/station-id/descriptions', { body: patch });
  });
  it('preserves metadata saves and reports partial success truthfully if description CAS rejects drift', async () => {
    mocks.update.mockResolvedValue({ success: true }); mocks.request.mockRejectedValue(new Error('409 conflict'));
    await expect(saveAdminStationEdit('station-id', { name: 'Name', descriptionPatch: { slug: 'radio' } })).rejects.toThrow('Station details were saved, but descriptions were not');
    expect(mocks.update).toHaveBeenCalledWith('station-id', { name: 'Name' });
    mocks.request.mockClear(); await saveAdminStationEdit('station-id', { name: 'Name' });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('uses the actual single-language generator contract then reloads authoritative admin data', async () => {
    const refreshed = { descriptions: baseline };
    mocks.request.mockResolvedValueOnce({ json: async () => ({ success: true, saved: true, language: 'de' }) })
      .mockResolvedValueOnce({ json: async () => refreshed });
    expect(await generateAdminStationDescription('one')).toEqual(refreshed);
    expect(mocks.request.mock.calls.map(call => call.slice(0, 2))).toEqual([['POST', '/api/admin/stations/one/generate-description'], ['GET', '/api/admin/stations/one']]);
    mocks.request.mockResolvedValueOnce({ json: async () => ({ success: false, saved: false }) });
    await expect(generateAdminStationDescription('two')).rejects.toThrow('not saved');
  });
  it('wires the form and table to reviewed save/generation flows, not the nonexistent plural endpoints', async () => {
    const form = await readFile('src/components/stations/station-form.tsx', 'utf8');
    const page = await readFile('src/pages/stations.tsx', 'utf8');
    expect(form).toContain('buildDescriptionChanges'); expect(form).toContain('form.setError');
    expect(form).not.toContain('generate-descriptions'); expect(form).not.toContain('57 languages');
    expect(page).toContain('saveAdminStationEdit(id, data)'); expect(page).not.toContain('/translate-descriptions');
    expect(page).toContain('handleGenerateAiDescription(station);');
  });
});
it('keeps normal admin login inputs empty and never publishes a purported default password', () => {
  render(<QueryClientProvider client={new QueryClient()}><AdminLogin /></QueryClientProvider>);
  expect(screen.getByLabelText('Username')).toHaveValue('');
  expect(screen.getByLabelText('Password')).toHaveValue('');
  expect(screen.queryByText(/Default credentials|admin123/i)).not.toBeInTheDocument();
});
