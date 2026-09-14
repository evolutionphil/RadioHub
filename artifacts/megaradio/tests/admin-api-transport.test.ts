import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); sessionStorage.clear(); vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); sessionStorage.clear(); });

it('uses the configured origin and bearer for an upload without altering its multipart body', async () => {
  sessionStorage.setItem('_mrt_oat', 'test-only-token');
  const response = new Response('bad upload', { status: 422 });
  const network = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', network);
  const { apiFetch } = await import('../src/lib/queryClient');
  const body = new FormData(); body.append('image', new Blob(['fixture']), 'logo.png');
  const controller = new AbortController();
  expect(await apiFetch('/api/admin/upload', { method: 'POST', body, signal: controller.signal, headers: { 'X-Test': 'upload' } })).toBe(response);
  const [url, options] = network.mock.calls[0];
  expect(url).toBe('https://api.example.test/api/admin/upload');
  expect(options).toMatchObject({ method: 'POST', body, signal: controller.signal, credentials: 'include' });
  expect(options.headers.get('authorization')).toBe('Bearer test-only-token');
  expect(options.headers.get('x-test')).toBe('upload');
  expect(options.headers.has('content-type')).toBe(false);
});

it('preserves explicit Headers and binary/CSV responses without imposing JSON parsing', async () => {
  const response = new Response('id,name\n1,Radio', { headers: { 'Content-Type': 'text/csv' } });
  const network = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', network);
  const { apiFetch } = await import('../src/lib/queryClient');
  expect(await apiFetch('/api/admin/export', { headers: new Headers({ Accept: 'text/csv' }) })).toBe(response);
  expect(network.mock.calls[0][1].headers.get('accept')).toBe('text/csv');
});

it('never adds private bearer headers or cross-origin cookie credentials to unrelated destinations', async () => {
  sessionStorage.setItem('_mrt_oat', 'test-only-token');
  const network = vi.fn().mockResolvedValue(new Response()); vi.stubGlobal('fetch', network);
  const { apiFetch } = await import('../src/lib/queryClient');
  for (const path of ['https://other.example/api/admin', '//other.example/api/admin', '/api-not-ours', '/images/logo.png']) await apiFetch(path);
  for (const [, options] of network.mock.calls) {
    expect(options.headers.has('authorization')).toBe(false);
    expect(options.credentials).toBe('same-origin');
  }
});
