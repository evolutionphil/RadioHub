import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const client = vi.hoisted(() => ({
  cancelQueries: vi.fn(async () => {}), setQueryData: vi.fn(), fetchQuery: vi.fn(async () => {}),
}));
vi.mock('../src/lib/queryClient', () => ({ queryClient: client }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('PROD', true); vi.stubEnv('DEV', false);
  delete window.__oauthExchangeStarted;
  window.history.replaceState({}, '', '/de'); sessionStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); delete window.__oauthExchangeStarted; });

it('ordinary production startup does not log auth diagnostics or make an exchange request', async () => {
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  const debug=vi.spyOn(console,'debug').mockImplementation(()=>{});
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const {initOAuthTokenExchange}=await import('../src/lib/oauth-token-exchange');
  initOAuthTokenExchange();initOAuthTokenExchange();
  expect(log).not.toHaveBeenCalled();expect(debug).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});

it('keeps OAuth URL cleanup, one exchange and session hydration without logging credentials', async () => {
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  const debug=vi.spyOn(console,'debug').mockImplementation(()=>{});
  const error=vi.spyOn(console,'error').mockImplementation(()=>{});
  const token='test-only-sensitive-token';
  window.history.replaceState({},'',`/de?auth_token=${token}&tab=favorites#saved`);
  const fetch=vi.fn(async()=>Response.json({user:{_id:'fixture-user'}}));vi.stubGlobal('fetch',fetch);
  const {initOAuthTokenExchange}=await import('../src/lib/oauth-token-exchange');
  initOAuthTokenExchange();initOAuthTokenExchange();
  await vi.waitFor(()=>expect(sessionStorage.getItem('_mrt_oat')).toBe(token));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(window.location.search).toBe('?tab=favorites');expect(window.location.hash).toBe('#saved');
  expect(client.setQueryData).toHaveBeenLastCalledWith(['/api/auth/me'],{user:{_id:'fixture-user'},authenticated:true});
  expect(log).not.toHaveBeenCalled();expect(debug).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
});

it('preserves sanitized error diagnostics and existing-session recovery', async () => {
  const error=vi.spyOn(console,'error').mockImplementation(()=>{});
  window.history.replaceState({},'','/de?auth_token=test-only-secret');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('sensitive-server-body',{status:401})));
  const {initOAuthTokenExchange}=await import('../src/lib/oauth-token-exchange');
  initOAuthTokenExchange();
  await vi.waitFor(()=>expect(client.fetchQuery).toHaveBeenCalledWith({queryKey:['/api/auth/me']}));
  expect(error).toHaveBeenCalledWith('[AUTH] Session exchange failed; recovering existing session',401);
  expect(JSON.stringify(error.mock.calls)).not.toMatch(/test-only-secret|sensitive-server-body/);
});

it('does not allocate console-only vitals observers in production', async () => {
  const observer=vi.fn();vi.stubGlobal('PerformanceObserver',observer);
  const {measureCoreWebVitals}=await import('../src/utils/performance');
  measureCoreWebVitals();measureCoreWebVitals();expect(observer).not.toHaveBeenCalled();
});

it('debug observers are idempotent in development and tolerate unsupported browsers', async () => {
  vi.stubEnv('PROD',false);vi.stubEnv('DEV',true);
  const observe=vi.fn();const observer=vi.fn(function(this:any){this.observe=observe;});
  vi.stubGlobal('PerformanceObserver',observer);
  const {measureCoreWebVitals}=await import('../src/utils/performance');
  measureCoreWebVitals();measureCoreWebVitals();expect(observer).toHaveBeenCalledTimes(2);
  vi.stubGlobal('PerformanceObserver',undefined);expect(()=>measureCoreWebVitals()).not.toThrow();
});

it('release minification removes debug calls but preserves warnings, errors and argument side effects', async () => {
  const config=readFileSync('vite.config.ts','utf8');
  const match=config.match(/pure:\s*process\.env\.NODE_ENV\s*===\s*'production'\s*\?\s*(\[[^\]]+\])/);
  expect(match).not.toBeNull();
  const pure=JSON.parse(match![1].replaceAll("'",'"'));
  // Run the build engine in Node, not jsdom's cross-realm Uint8Array environment.
  const source='console.log(effect());console.debug("debug");console.info("info");console.warn("warn");console.error("error");';
  const code=execFileSync(process.execPath,['--input-type=module','-e',
    `import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); const esbuild=createRequire(require.resolve('vite'))('esbuild'); console.log(esbuild.transformSync(${JSON.stringify(source)},${JSON.stringify({pure,minify:true})}).code);`
  ],{encoding:'utf8'});
  expect(code).not.toMatch(/console\.(log|debug|info)/);
  expect(code).toContain('effect()');expect(code).toContain('console.warn');expect(code).toContain('console.error');
});
