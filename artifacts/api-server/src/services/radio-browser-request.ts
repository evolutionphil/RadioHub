import { Resolver } from 'node:dns/promises';
import axios, { type AxiosRequestConfig } from 'axios';
import { logger } from '../utils/logger';

const FALLBACK_MIRRORS = ['de2.api.radio-browser.info', 'de1.api.radio-browser.info'];
const MAX_MIRRORS = 6;
const MAX_ROUNDS = 3;
const REQUEST_BUDGET_MS = 180_000;
const MIRROR_CACHE_MS = 5 * 60_000;

async function discoverMirrors() {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  const timer = setTimeout(() => resolver.cancel(), 2000);
  timer.unref();
  try { return await resolver.resolveSrv('_api._tcp.radio-browser.info'); }
  finally { clearTimeout(timer); }
}

interface FetchDependencies {
  discover: () => Promise<Array<{ name: string; port: number }>>;
  get: (url: string, config: AxiosRequestConfig) => Promise<{ data: unknown }>;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  random: () => number;
}

export class RadioBrowserRequestCancelledError extends Error {
  constructor() { super('Radio Browser request cancelled'); this.name = 'RadioBrowserRequestCancelledError'; }
}

function isRetryable(error: any): boolean {
  // HTTP client errors and explicit aborts must never become retry loops.
  if (error?.code === 'ERR_CANCELED') return false;
  const status = error?.response?.status;
  if (typeof status === 'number') return status >= 500 && status < 600;
  return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND',
    'EAI_AGAIN', 'EPIPE', 'ERR_BAD_RESPONSE'].includes(error?.code);
}

/** DNS discovery follows https://api.radio-browser.info/. Only GET requests
 * are replayed; all retries stay within one page's time and attempt budgets. */
export function createRadioBrowserFetcher(overrides: Partial<FetchDependencies> = {}) {
  const deps: FetchDependencies = {
    discover: discoverMirrors,
    get: (url, config) => axios.get(url, config),
    sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    now: Date.now,
    random: Math.random,
    ...overrides,
  };
  let cached: string[] | undefined;
  let expiresAt = 0;
  let discovery: Promise<string[]> | undefined;
  const mirrors = async (): Promise<string[]> => {
    if (cached && deps.now() < expiresAt) return cached;
    if (discovery) return discovery;
    discovery = (async () => {
      let advertised: string[] = [];
      try {
        advertised = (await deps.discover()).filter(row => row.port === 443 && typeof row.name === 'string')
          .map(row => row.name.toLowerCase().replace(/\.$/, ''))
          .filter(name => /^[a-z0-9]+(?:-[a-z0-9]+)*\.api\.radio-browser\.info$/.test(name));
      } catch (error: any) {
        logger.warn(`Radio Browser mirror discovery failed (${error?.code || 'DNS_ERROR'}); using known mirrors`);
      }
      // Keep both known working hosts even when DNS advertises only one. Retired
      // fr1/nl1/at1/uk1 hostnames must not consume the entire fallback sequence.
      const discovered = [...new Set(advertised)].slice(0, MAX_MIRRORS - FALLBACK_MIRRORS.length);
      for (let i = discovered.length - 1; i > 0; i--) {
        const j = Math.floor(deps.random() * (i + 1));
        [discovered[i], discovered[j]] = [discovered[j], discovered[i]];
      }
      cached = [...new Set([...discovered, ...FALLBACK_MIRRORS])];
      expiresAt = deps.now() + (advertised.length ? MIRROR_CACHE_MS : 60_000);
      return cached;
    })();
    try { return await discovery; } finally { discovery = undefined; }
  };

  return async function fetchWithMirrorFallback<T = any>(
    pathBuilder: (host: string) => string,
    options: AxiosRequestConfig = {},
    context = 'radio-browser',
    control: { shouldStop?: () => Promise<boolean>; retryTransientFailures?: boolean } = {},
  ): Promise<{ data: T; mirror: string }> {
    // Interactive by-UUID callers retain one pass. Only the catalog import
    // opts into retry rounds and the longer per-page recovery budget.
    const rounds = control.retryTransientFailures ? MAX_ROUNDS : 1;
    const deadline = deps.now() + (control.retryTransientFailures ? REQUEST_BUDGET_MS : 30_000);
    const checkpoint = async () => {
      // The sync callback also throws if its PostgreSQL leadership was lost.
      // Do not swallow that error or acquire a replacement lock here.
      if (await control.shouldStop?.()) throw new RadioBrowserRequestCancelledError();
    };
    await checkpoint();
    const hosts = await mirrors();
    await checkpoint();
    const unavailable = new Set<string>();
    const perAttemptMs = Math.max(1, Math.min(Number(options.timeout) || 30_000, 30_000));
    let lastError: any;
    let attempts = 0;
    for (let round = 0; round < rounds && deps.now() < deadline; round++) {
      for (const mirror of hosts) {
        if (unavailable.has(mirror)) continue;
        await checkpoint();
        const remaining = deadline - deps.now();
        if (remaining <= 0) break;
        attempts++;
        const timeout = Math.min(perAttemptMs, remaining);
        const controller = new AbortController();
        const abort = () => controller.abort();
        const timer = setTimeout(abort, timeout);
        timer.unref();
        options.signal?.addEventListener?.('abort', abort);
        if (options.signal?.aborted) abort();
        let response: { data: unknown } | undefined;
        let requestError: any;
        try {
          response = await deps.get(pathBuilder(mirror), { ...options, timeout, signal: controller.signal });
        } catch (error: any) {
          requestError = controller.signal.aborted && !options.signal?.aborted
            ? Object.assign(new Error('Radio Browser GET timed out', { cause: error }), { code: 'ETIMEDOUT' }) : error;
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener?.('abort', abort);
        }
        // A control/leadership read error is not an upstream HTTP error.
        await checkpoint();
        if (response) return { data: response.data as T, mirror };
        if (!isRetryable(requestError)) {
          logger.error(`[${context}] mirror=${mirror} GET failed (status=${requestError?.response?.status || 'n/a'} code=${requestError?.code || 'n/a'}); not retrying`);
          throw requestError;
        }
        lastError = requestError;
        if (requestError.code === 'ENOTFOUND') unavailable.add(mirror);
        logger.warn(`[${context}] mirror=${mirror} GET attempt=${attempts} round=${round + 1} failed (status=${requestError?.response?.status || 'n/a'} code=${requestError?.code || 'n/a'})`);
      }
      if (round + 1 < rounds && unavailable.size < hosts.length && deps.now() < deadline) {
        await checkpoint();
        await deps.sleep(Math.min(1000 * 2 ** round, deadline - deps.now()));
        await checkpoint();
      } else break;
    }
    await checkpoint();
    const message = `[${context}] Radio Browser GET failed after ${attempts} attempt(s) across ${hosts.length} mirror(s): ${lastError?.message || 'request time budget exhausted'}`;
    logger.error(message);
    throw Object.assign(new Error(message, { cause: lastError }), { code: 'RADIO_BROWSER_UNAVAILABLE' });
  };
}

export const fetchWithMirrorFallback = createRadioBrowserFetcher();
