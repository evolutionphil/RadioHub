import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SeoTranslationsHub from '../src/pages/admin/seo-translations';

const mocks = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));
vi.mock('../src/lib/queryClient', () => ({ apiRequest: mocks.request }));
vi.mock('../src/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

const complete = { code: 'en', name: 'English', qualified: true, completedKeys: ['title'], missingKeys: [], completionPct: 100 };
const turkish = { code: 'tr', name: 'Turkish', qualified: false, completedKeys: [], missingKeys: ['title'], completionPct: 0 };
const german = { ...turkish, code: 'de', name: 'German' };
const coverage = (languages = [complete, turkish, german]) => ({ languages, totalQualified: 1,
  qualifiedLangsState: { source: 'computed', computedAt: '2026-09-15T00:00:00Z', expiresAt: null, languages: ['en'] } });
const result = (generated = 1, failed = 0) => Response.json({ generated, failed, skipped: 0, durationMs: 10, message: 'Finished' });
let client: QueryClient;
let read: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.request.mockReset(); mocks.toast.mockReset();
  read = vi.fn().mockResolvedValue(coverage());
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, queryFn: () => read() }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
const mount = () => render(<QueryClientProvider client={client}><SeoTranslationsHub /></QueryClientProvider>);

it('blocks operations when coverage fails and recovers using the current provider query client', async () => {
  read.mockRejectedValueOnce(new Error('Offline'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load coverage');
  expect(screen.getByRole('button', { name: 'Regenerate Missing' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Apply Now' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerate Missing' })).toBeEnabled());
  expect(read).toHaveBeenCalledTimes(2);
  expect(mocks.request).not.toHaveBeenCalled();
});

it('regenerates only incomplete languages sequentially, with truthful partial-failure feedback', async () => {
  let finishFirst!: (response: Response) => void;
  mocks.request.mockImplementationOnce(() => new Promise<Response>(resolve => { finishFirst = resolve; })).mockResolvedValueOnce(result(0, 1));
  mount();
  await screen.findByRole('button', { name: 'Missing SEO keys for Turkish' });
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate Missing' }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
  expect(mocks.request).toHaveBeenNthCalledWith(1, 'POST', '/api/admin/seo-translations/regenerate', { body: { languages: ['tr'] } });
  expect(screen.getByRole('button', { name: 'Apply Now' })).toBeDisabled();
  await act(async () => finishFirst(result()));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  expect(mocks.request).toHaveBeenNthCalledWith(2, 'POST', '/api/admin/seo-translations/regenerate', { body: { languages: ['de'] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('1 generated, 1 failed');
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Regeneration finished with errors', variant: 'destructive' }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
});

it('refreshes partial progress after an interrupted request so retry does not regenerate completed languages', async () => {
  mocks.request.mockResolvedValueOnce(result()).mockRejectedValueOnce(new Error('503: temporarily unavailable')).mockResolvedValueOnce(result());
  read.mockResolvedValueOnce(coverage()).mockResolvedValue(coverage([complete, { ...turkish, missingKeys: [], completedKeys: ['title'] }, german]));
  mount();
  await screen.findByRole('button', { name: 'Missing SEO keys for Turkish' });
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate Missing' }));
  await screen.findByText('503: temporarily unavailable');
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate Missing' }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
  expect(mocks.request).toHaveBeenNthCalledWith(3, 'POST', '/api/admin/seo-translations/regenerate', { body: { languages: ['de'] } });
});

it('disables unnecessary AI calls for complete coverage and offers keyboard-accessible missing-key controls', async () => {
  read.mockResolvedValue(coverage([complete]));
  const view = mount();
  await screen.findByRole('button', { name: 'Missing SEO keys for English' });
  expect(screen.getByRole('button', { name: 'Regenerate Missing' })).toBeDisabled();
  client.setQueryData(['/api/admin/seo-translations/coverage'], coverage());
  view.rerender(<QueryClientProvider client={client}><SeoTranslationsHub /></QueryClientProvider>);
  const button = await screen.findByRole('button', { name: 'Missing SEO keys for Turkish' });
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Missing keys:')).toBeInTheDocument();
});
