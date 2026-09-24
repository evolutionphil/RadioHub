import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/queryClient', () => ({ apiFetch: (url: string, options: RequestInit) => fetch(url, options) }));
// Keep client tests independent of the server sanitizer's exhaustive route tests.
vi.mock('@workspace/seo-shared/visitor-activity', () => ({
  sanitizeVisitorPagePath: (path: string) => path.startsWith('/admin') || path.includes('/auth/') ? null : path.split(/[?#]/)[0],
  classifyVisitorReferral: () => 'google',
}));
let schedule: typeof import('../src/lib/visitor-activity')['scheduleVisitorPageView'];
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: null });
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false });
  schedule = (await import('../src/lib/visitor-activity')).scheduleVisitorPageView;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('defers a sanitized, bounded page observation and sends no arbitrary details', async () => {
  schedule('/de/station/kral-fm?token=secret#private');
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe('/api/visitor-activity/page-view');
  expect(JSON.parse(String(options?.body))).toEqual({ path: '/de/station/kral-fm', referralCategory: 'internal' });
  expect(options?.signal).toBeInstanceOf(AbortSignal);
});

it('cancels superseded navigation and skips sensitive routes', async () => {
  schedule('/en')(); schedule('/admin/stations'); schedule('/de/auth/callback');
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['doNotTrack', 'globalPrivacyControl', 'hidden', 'offline'])('honors %s without network work', async setting => {
  if (setting === 'doNotTrack') Object.defineProperty(navigator, 'doNotTrack', { value: '1' });
  if (setting === 'globalPrivacyControl') Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
  if (setting === 'hidden') Object.defineProperty(document, 'visibilityState', { value: 'hidden' });
  if (setting === 'offline') Object.defineProperty(navigator, 'onLine', { value: false });
  schedule('/en'); await vi.advanceTimersByTimeAsync(10_000);
  expect(fetch).not.toHaveBeenCalled();
});

it('rechecks privacy before deferred work and deduplicates rerenders', async () => {
  schedule('/en'); Object.defineProperty(navigator, 'doNotTrack', { value: '1' });
  await vi.advanceTimersByTimeAsync(1_000); expect(fetch).not.toHaveBeenCalled();
  Object.defineProperty(navigator, 'doNotTrack', { value: null });
  schedule('/en'); schedule('/en'); await vi.advanceTimersByTimeAsync(1_000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('bounds navigation bursts, aborts stalled transport and never retries failure', async () => {
  vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  for (let i = 0; i < 40; i++) schedule(`/en/station/station-${i}`);
  await vi.advanceTimersByTimeAsync(1_000); expect(fetch).toHaveBeenCalledTimes(30);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000); expect(fetch).toHaveBeenCalledTimes(30);
});

it('absorbs synchronous transport failures without affecting the page', async () => {
  vi.mocked(fetch).mockImplementation(() => { throw new Error('Blocked transport'); });
  schedule('/en');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetch).toHaveBeenCalledTimes(1);
});
