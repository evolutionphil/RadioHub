import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ request: vi.fn(), analyze: vi.fn(), toast: vi.fn(), generate: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: {
  getAvailableCountries: async () => [{ name: 'Germany', code: 'DE' }, { name: 'Austria', code: 'AT' }],
  getGenres: async () => ({ genres: [{ _id: 'rock', slug: 'rock', name: 'Rock' }, { _id: 'pop', slug: 'pop', name: 'Pop' }] }),
  analyzeStreamUrl: mocks.analyze,
} }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request, resolveApiUrl: (path: string) => path, apiAuthHeaders: () => ({}) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/admin-station-description', async () => ({
  ...await vi.importActual<typeof import('../src/lib/admin-station-description')>('../src/lib/admin-station-description'),
  generateAdminStationDescription: mocks.generate,
}));
import StationForm, { stationFormSchema } from '../src/components/stations/station-form';

const a = 'a'.repeat(24), b = 'b'.repeat(24);
const station = (id = a) => ({ _id: id, slug: `station-${id}`, name: id === a ? 'Station A' : 'Station B',
  url: `https://stream.invalid/${id}`, urlResolved: `https://stream.invalid/${id}/resolved`,
  country: 'Germany', countryCode: 'DE', tags: 'rock, pop', codec: '', bitrate: 128,
  favicon: `https://logo.invalid/${id}.png`, descriptions: { de: { full: 'German article', meta: 'Summary' } },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  mocks.request.mockImplementation(async (_method: string, url: string) => ({ json: async () => station(url.split('/').pop()) }));
  mocks.analyze.mockResolvedValue({ success: false });
});
afterEach(() => vi.unstubAllGlobals());
function mount(initial: any = station()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const submit = vi.fn(), close = vi.fn();
  const ui = (current: any, open = true) => <QueryClientProvider client={client}>
    <StationForm station={current} open={open} onClose={close} onSubmit={submit} />
  </QueryClientProvider>;
  const view = render(ui(initial));
  return { client, submit, close, ...view, show: (current: any, open = true) => view.rerender(ui(current, open)) };
}
async function ready() { await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()); }

describe('admin station form session and save contracts', () => {
  it('validates real editable URL/numeric fields without manufacturing health evidence', () => {
    const base = { name: 'Station', url: 'https://radio.invalid/live' };
    expect(stationFormSchema.parse({ ...base, bitrate: 0 }).bitrate).toBe(0);
    expect(stationFormSchema.parse({ ...base, bitrate: null, urlResolved: '', homepage: '' }).bitrate).toBeNull();
    for (const patch of [{ name: '   ' }, { url: 'file:///etc/passwd' }, { urlResolved: 'not-a-url' }, { homepage: 'ftp://radio.invalid' }, { bitrate: -1 }, { bitrate: 1.5 }, { bitrate: 100001 }, { noIndex: 'false' }]) {
      expect(stationFormSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    }
  });
  it.each([true, false, undefined])('shows the stored noIndex=%s policy without submitting untouched indexing or unrelated fields', async (noIndex) => {
    const data = { ...station(), noIndex, isActive: false, lastCheckOk: false };
    mocks.request.mockResolvedValue({ json: async () => data });
    const view = mount(data); await ready();
    const indexing = screen.getByRole('switch', { name: 'Allow search engine indexing' });
    expect(indexing).toHaveAttribute('aria-checked', String(!noIndex));
    expect(indexing).toHaveAccessibleDescription(expect.stringContaining(noIndex ? 'Indexing is disabled by this setting.' : 'Indexing is allowed by this setting.'));
    expect(indexing).toHaveAccessibleDescription(expect.stringContaining('Page quality and duplicate checks still apply'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(view.submit).toHaveBeenLastCalledWith({}));
    fireEvent.change(screen.getByLabelText(/Station Name/), { target: { value: 'Updated station name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(view.submit).toHaveBeenLastCalledWith({ name: 'Updated station name' }));
    expect(data.noIndex).toBe(noIndex);
  });
  it.each([true, false])('an explicit toggle from noIndex=%s submits only the inverse boolean', async (noIndex) => {
    const data = { ...station(), noIndex, isActive: false, lastCheckOk: false };
    mocks.request.mockResolvedValue({ json: async () => data });
    const view = mount(data); await ready();
    fireEvent.click(screen.getByRole('switch', { name: 'Allow search engine indexing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(view.submit).toHaveBeenCalledWith({ noIndex: !noIndex }));
    expect(data.noIndex).toBe(noIndex);
  });
  it('does not submit indexing after toggling back to the saved policy', async () => {
    const data = { ...station(), noIndex: true };
    mocks.request.mockResolvedValue({ json: async () => data });
    const view = mount(data); await ready();
    const indexing = screen.getByRole('switch', { name: 'Allow search engine indexing' });
    fireEvent.click(indexing);
    fireEvent.click(indexing);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(view.submit).toHaveBeenCalledWith({}));
  });
  it('resets indexing drafts on a different station and on close/reopen', async () => {
    const first = { ...station(a), noIndex: true }, second = { ...station(b), noIndex: true };
    mocks.request.mockImplementation(async (_method: string, url: string) => ({ json: async () => url.endsWith(a) ? first : second }));
    const view = mount(first); await ready();
    fireEvent.click(screen.getByRole('switch', { name: 'Allow search engine indexing' }));
    expect(screen.getByRole('switch', { name: 'Allow search engine indexing' })).toBeChecked();
    view.show(second); await ready();
    expect(screen.getByRole('switch', { name: 'Allow search engine indexing' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('switch', { name: 'Allow search engine indexing' }));
    view.show(second, false); view.show(second); await ready();
    expect(screen.getByRole('switch', { name: 'Allow search engine indexing' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(view.submit).toHaveBeenCalledWith({}));
  });
  it('loads the current indexing policy before enabling the control', async () => {
    const pending = deferred<any>();
    mocks.request.mockReturnValue(pending.promise);
    const view = mount({ ...station(), noIndex: false });
    expect(screen.getByRole('switch', { name: 'Allow search engine indexing' })).toBeDisabled();
    await act(async () => pending.resolve({ json: async () => ({ ...station(), noIndex: true }) }));
    await ready();
    expect(screen.getByRole('switch', { name: 'Allow search engine indexing' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Allow search engine indexing' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(view.submit).toHaveBeenCalledWith({}));
  });
  it('loads id-only records from the correct endpoint and reports a load failure before saving', async () => {
    const data = { ...station(), id: a, _id: undefined };
    mocks.request.mockRejectedValueOnce(new Error('Failed'));
    mount(data);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(mocks.request.mock.calls[0][1]).toBe(`/api/admin/stations/${a}`);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(screen.getByLabelText(/Station Name/)).toHaveValue('Station A');
  });
  it('isolates unsaved drafts between records and between close/reopen sessions', async () => {
    const view = mount(); await ready();
    fireEvent.change(screen.getByLabelText(/Station Name/), { target: { value: 'Unsaved A' } });
    view.show(station(b)); await ready();
    expect(screen.getByLabelText(/Station Name/)).toHaveValue('Station B');
    fireEvent.change(screen.getByLabelText(/Station Name/), { target: { value: 'Unsaved B' } });
    view.show(station(b), false); view.show(station(b)); await ready();
    expect(screen.getByLabelText(/Station Name/)).toHaveValue('Station B');
    expect(view.submit).not.toHaveBeenCalled();
  });
  it('retains genre-button changes when fresh server data arrives, submitting only the intended patch', async () => {
    const view = mount(); await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Remove genre rock' }));
    act(() => view.client.setQueryData(['/api/admin/stations', a], { ...station(), name: 'Concurrent server name' }));
    expect(screen.queryByRole('button', { name: 'Remove genre rock' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Station Name/)).toHaveValue('Station A');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(view.submit).toHaveBeenCalledWith({ tags: 'pop' }));
  });
  it('does not let a late stream analysis overwrite another record or a newer URL', async () => {
    const pending = deferred<any>(); mocks.analyze.mockReturnValueOnce(pending.promise);
    const view = mount(); await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze stream URL' }));
    view.show(station(b)); await ready();
    await act(async () => pending.resolve({ success: true, codec: 'AAC', bitrate: 999, hls: true }));
    expect(screen.getByLabelText('Bitrate (kbps)')).toHaveValue(128);
    expect(screen.queryByText(/999kbps/)).not.toBeInTheDocument();
    const next = deferred<any>(); mocks.analyze.mockReturnValueOnce(next.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Analyze stream URL' }));
    fireEvent.change(screen.getByLabelText('Stream URL *'), { target: { value: 'https://stream.invalid/new' } });
    await act(async () => next.resolve({ success: true, codec: 'AAC', bitrate: 999, hls: true }));
    expect(screen.getByLabelText('Bitrate (kbps)')).toHaveValue(128);
    expect(screen.queryByText(/999kbps/)).not.toBeInTheDocument();
  });
  it('omits an unchanged resolved URL after a main URL edit and persists explicit clearing of bitrate', async () => {
    const view = mount(); await ready();
    fireEvent.change(screen.getByLabelText('Stream URL *'), { target: { value: 'https://stream.invalid/repaired' } });
    fireEvent.change(screen.getByLabelText('Bitrate (kbps)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(view.submit).toHaveBeenCalledWith({ url: 'https://stream.invalid/repaired', bitrate: null }));
    expect(view.submit.mock.calls[0][0]).not.toHaveProperty('urlResolved');
    expect(view.submit.mock.calls[0][0]).not.toHaveProperty('lastCheckOk');
  });
  it('does not apply a late uploaded logo to the next station', async () => {
    const upload = deferred<any>();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(upload.promise);
    try {
      const view = mount(); await ready();
      fireEvent.change(screen.getByLabelText('Upload station logo file'), { target: { files: [new File(['image'], 'logo.png', { type: 'image/png' })] } });
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
      view.show(station(b)); await ready();
      await act(async () => upload.resolve({ ok: true, json: async () => ({ success: true, favicon: 'https://logo.invalid/uploaded-a.png' }) }));
      expect(screen.getByLabelText('Logo URL')).toHaveValue(station(b).favicon);
      expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Logo uploaded' }));
      expect(fetchMock.mock.calls[0][0]).toBe(`/api/admin/stations/${a}/upload-favicon`);
    } finally { fetchMock.mockRestore(); }
  });
  it('does not apply late generated descriptions to the next station', async () => {
    const generated = deferred<any>(); mocks.generate.mockReturnValueOnce(generated.promise);
    const view = mount(); await ready();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /AI & Translations/ }), { button: 0, ctrlKey: false });
    const generate = await screen.findByRole('button', { name: 'Generate' });
    await waitFor(() => expect(generate).toBeEnabled());
    fireEvent.click(generate);
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(a, expect.anything()));
    view.show(station(b)); await ready();
    await act(async () => generated.resolve({ ...station(), descriptions: { de: { full: 'Generated A', meta: 'A summary' } } }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: /AI & Translations/ }), { button: 0, ctrlKey: false });
    expect(screen.getByLabelText('AI Descriptions (JSON)')).toHaveValue(JSON.stringify(station(b).descriptions, null, 2));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'AI Description Generated' }));
  });
  it('creating a station never submits invented provider health or an invisible active toggle', async () => {
    const view = mount(null);
    fireEvent.change(screen.getByLabelText(/Station Name/), { target: { value: 'New station' } });
    fireEvent.change(screen.getByLabelText('Stream URL *'), { target: { value: 'https://stream.invalid/new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Station' }));
    await waitFor(() => expect(view.submit).toHaveBeenCalled());
    expect(view.submit.mock.calls[0][0]).not.toHaveProperty('lastCheckOk');
    expect(view.submit.mock.calls[0][0]).not.toHaveProperty('isActive');
    expect(view.submit.mock.calls[0][0]).not.toHaveProperty('noIndex');
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
