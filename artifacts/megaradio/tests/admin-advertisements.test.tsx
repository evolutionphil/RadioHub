import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryClient } from '../src/lib/queryClient';
import AdvertisementsAdmin from '../src/pages/admin/advertisements';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../src/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('../src/pages/admin/AdminPage', () => ({ AdminPage: ({ title, children }: any) => <section><h1>{title}</h1>{children}</section> }));
const ad = (id: string, position = 'desktop_sidebar') => ({ _id: id, title: `Ad ${id}`, imageUrl: `https://images.example/${id}.png`, altText: `Image ${id}`,
  seoDescription: `Description ${id}`, url: `https://advertiser.example/${id}`, position, isActive: true });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  toast.mockReset(); queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false, gcTime: Infinity, staleTime: Infinity, queryFn: async ({ queryKey }) => {
    const response = await fetch(String(queryKey[0])); if (!response.ok) throw new Error('Request failed'); return response.json();
  } }, mutations: { retry: false } });
  fetchMock = vi.fn(async () => Response.json([])); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); queryClient.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(ads: ReturnType<typeof ad>[] | null = []) {
  if (ads) queryClient.setQueryData(['/api/admin/advertisements'], ads);
  return render(<QueryClientProvider client={queryClient}><AdvertisementsAdmin /></QueryClientProvider>);
}
function fill(title = 'New ad') {
  fireEvent.change(screen.getByTestId('input-ad-title'), { target: { value: title } });
  fireEvent.change(screen.getByTestId('input-ad-alt'), { target: { value: 'Creative description' } });
  fireEvent.change(screen.getByTestId('textarea-ad-description'), { target: { value: 'Campaign description' } });
  fireEvent.change(screen.getByTestId('input-ad-url'), { target: { value: 'https://advertiser.example' } });
}
function chooseFile() {
  fireEvent.change(screen.getByTestId('input-ad-image-upload'), { target: { files: [new File(['image'], 'ad.png', { type: 'image/png' })] } });
}

it('shows a failed query as an error, not an empty catalog, and supports retry', async () => {
  fetchMock.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
  mount(null);
  expect(await screen.findByRole('alert')).toHaveTextContent('Advertisements could not be loaded');
  expect(screen.queryByText(/No advertisements yet/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/No advertisements yet/)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('blocks saving without an image or destination, and while an upload is pending, then preserves the create contract', async () => {
  const pending = deferred<Response>();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => url.endsWith('/upload') ? pending.promise : Promise.resolve(Response.json(init?.method === 'POST' ? ad('saved') : [])));
  mount(); fireEvent.click(screen.getByTestId('button-add-middle-ad')); fill();
  const submit = screen.getByTestId('button-submit-ad');
  expect(submit).toBeDisabled();
  fireEvent.submit(submit.closest('form')!); expect(fetchMock).not.toHaveBeenCalled();
  chooseFile(); expect(screen.getByRole('status')).toHaveTextContent('Uploading'); expect(submit).toBeDisabled();
  fireEvent.submit(submit.closest('form')!); expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(Response.json({ imageUrl: 'https://images.example/new.png' })); });
  expect(submit).not.toBeDisabled();
  fireEvent.change(screen.getByLabelText('Destination URL'), { target: { value: '   ' } });
  expect(submit).toBeDisabled(); fireEvent.submit(submit.closest('form')!); expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Destination URL'), { target: { value: 'https://advertiser.example' } });
  fireEvent.click(submit);
  await waitFor(() => expect(screen.queryByTestId('button-submit-ad')).toBeNull());
  const saved = fetchMock.mock.calls.find((call: any[]) => call[1]?.method === 'POST' && !call[0].endsWith('/upload'))!;
  expect(saved[0]).toBe('/api/admin/advertisements');
  expect(JSON.parse(saved[1].body)).toEqual({ title: 'New ad', imageUrl: 'https://images.example/new.png', altText: 'Creative description',
    seoDescription: 'Campaign description', url: 'https://advertiser.example', position: 'middle_section', isActive: true });
});

it('aborts a cancelled upload and ignores its late success after a new form is opened', async () => {
  const pending = deferred<Response>(); fetchMock.mockReturnValue(pending.promise);
  mount(); fireEvent.click(screen.getByTestId('button-add-desktop-ad')); fill('Old form'); chooseFile();
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  fireEvent.click(screen.getByTestId('button-cancel-ad'));
  expect(signal.aborted).toBe(true);
  fireEvent.click(screen.getByTestId('button-add-mobile-ad')); fill('New form');
  await act(async () => { pending.resolve(Response.json({ imageUrl: 'https://images.example/obsolete.png' })); });
  expect(screen.getByLabelText('Title')).toHaveValue('New form');
  expect(screen.queryByTestId('img-ad-preview')).toBeNull(); expect(screen.getByTestId('button-submit-ad')).toBeDisabled();
  expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ description: 'Image uploaded successfully!' }));
});

it('cannot apply an old upload to another advertisement or clear that form upload status', async () => {
  const first = deferred<Response>(), second = deferred<Response>();
  fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  mount([ad('A'), ad('B', 'middle_section')]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Ad A' })); chooseFile();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Ad B' })); chooseFile();
  await act(async () => { first.resolve(Response.json({ imageUrl: 'https://images.example/old-A.png' })); });
  expect(screen.getByLabelText('Title')).toHaveValue('Ad B'); expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.getByTestId('img-ad-preview')).toHaveAttribute('src', 'https://images.example/B.png');
  await act(async () => { second.resolve(Response.json({ imageUrl: 'https://images.example/new-B.png' })); });
  expect(screen.getByTestId('img-ad-preview')).toHaveAttribute('src', 'https://images.example/new-B.png');
  expect(screen.queryByRole('status')).toBeNull();
});

it('aborts on unmount and suppresses notifications from late completion', async () => {
  const pending = deferred<Response>(); fetchMock.mockReturnValue(pending.promise);
  const view = mount(); fireEvent.click(screen.getByTestId('button-add-desktop-ad')); chooseFile();
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(Response.json({ imageUrl: 'https://images.example/late.png' })); });
  expect(toast).not.toHaveBeenCalled();
});

it.each(['failed', 'empty-url'])('keeps the form recoverable after %s uploads', async kind => {
  fetchMock.mockResolvedValue(kind === 'failed' ? new Response('unavailable', { status: 503 }) : Response.json({ imageUrl: '' }));
  mount(); fireEvent.click(screen.getByTestId('button-add-desktop-ad')); fill(); chooseFile();
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  expect(screen.getByLabelText('Upload Image')).not.toBeDisabled(); expect(screen.getByTestId('button-submit-ad')).toBeDisabled();
});

it('labels middle placements and every editable control without changing update or delete URLs', async () => {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(Response.json(init?.method ? { success: true } : [ad('middle', 'middle_section')])));
  mount([ad('middle', 'middle_section')]); expect(screen.getByText('Middle Section')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Ad middle' }));
  for (const label of ['Title', 'Upload Image', 'Alt Text (SEO)', 'SEO Description', 'Destination URL', 'Active']) expect(screen.getByLabelText(label)).toBeTruthy();
  fireEvent.click(screen.getByTestId('button-submit-ad'));
  await waitFor(() => expect(screen.queryByTestId('button-submit-ad')).toBeNull());
  const update = fetchMock.mock.calls.find((call: any[]) => call[1]?.method === 'PATCH')!;
  expect(update[0]).toBe('/api/admin/advertisements/middle'); expect(JSON.parse(update[1].body).position).toBe('middle_section');
  fireEvent.click(screen.getByRole('button', { name: 'Delete Ad middle' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/advertisements/middle', expect.objectContaining({ method: 'DELETE' })));
});
