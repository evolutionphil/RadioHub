import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRadioBrowserFetcher, RadioBrowserRequestCancelledError } from '../src/services/radio-browser-request';

const reset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
const page = (host: string) => `https://${host}/json/stations/search`;
const config = { timeout: 30000, params: { limit: 5000, offset: 50000, hidebroken: false } };
const recover = { retryTransientFailures: true };
const advertised = async () => [{ name: 'de1.api.radio-browser.info', port: 443 }];

test('page 11 survives both live mirrors resetting and replays the exact GET page once recovered', async () => {
  const calls: Array<{ host: string; params: unknown }> = [];
  let discoveries = 0;
  const fetcher = createRadioBrowserFetcher({
    discover: async () => { discoveries++; return advertised(); }, sleep: async () => {},
    get: async (url, options) => {
      calls.push({ host: new URL(url).hostname, params: options.params });
      if (calls.length <= 2) throw reset();
      return { data: [{ stationuuid: 'continued-page-11' }] };
    },
  });
  const result = await fetcher(page, config, 'sync:fetchAllStations p11', recover);
  assert.equal(result.mirror, 'de1.api.radio-browser.info');
  assert.deepEqual(result.data, [{ stationuuid: 'continued-page-11' }]);
  assert.deepEqual(calls.map(call => call.host), ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'de1.api.radio-browser.info']);
  assert.ok(calls.every(call => call.params === config.params));
  await fetcher(page, config);
  assert.equal(discoveries, 1, 'discovery is cached across pages');
});

test('discovery normalizes valid HTTPS hosts, rejects foreign names/ports and retains known fallbacks', async () => {
  const hosts: string[] = [];
  const fetcher = createRadioBrowserFetcher({
    discover: async () => [
      { name: 'DE3.API.RADIO-BROWSER.INFO.', port: 443 }, { name: 'de3.api.radio-browser.info', port: 443 },
      { name: 'evil.example', port: 443 }, { name: 'radio-browser.info.evil.example', port: 443 },
      { name: 'de4.api.radio-browser.info', port: 80 },
    ],
    get: async url => { hosts.push(new URL(url).hostname); if (hosts.length < 3) throw reset(); return { data: [] }; },
  });
  await fetcher(page, config);
  assert.deepEqual(hosts, ['de3.api.radio-browser.info', 'de2.api.radio-browser.info', 'de1.api.radio-browser.info']);
});

test('DNS discovery failure uses bounded known fallback hosts and coalesces concurrent discovery', async () => {
  let discoveries = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = createRadioBrowserFetcher({
    discover: async () => { discoveries++; await gate; throw Object.assign(new Error('DNS unavailable'), { code: 'ETIMEOUT' }); },
    get: async url => ({ data: new URL(url).hostname }),
  });
  const first = fetcher(page), second = fetcher(page);
  await Promise.resolve(); await Promise.resolve();
  release();
  const result = await Promise.all([first, second]);
  assert.equal(discoveries, 1);
  assert.ok(result.every(row => row.mirror === 'de2.api.radio-browser.info'));
});

for (const code of ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT']) {
  test(`${code} retry exhaustion is bounded and includes the page context`, async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const fetcher = createRadioBrowserFetcher({ discover: advertised,
      get: async () => { attempts++; throw Object.assign(new Error(code), { code }); },
      sleep: async ms => { sleeps.push(ms); },
    });
    await assert.rejects(fetcher(page, config, 'sync:fetchAllStations p11', recover), error => {
      assert.match((error as Error).message, /p11.*6 attempt/);
      assert.equal((error as any).code, 'RADIO_BROWSER_UNAVAILABLE');
      return true;
    });
    assert.equal(attempts, 6);
    assert.deepEqual(sleeps, [1000, 2000]);
  });
}

test('the cumulative wall-clock budget reduces the last attempt timeout and ends retries', async () => {
  let now = 0;
  const timeouts: number[] = [];
  const fetcher = createRadioBrowserFetcher({ discover: advertised, now: () => now,
    sleep: async ms => { now += ms; },
    get: async (_url, options) => { timeouts.push(options.timeout!); now += options.timeout!; throw reset(); },
  });
  await assert.rejects(fetcher(page, config, 'page-budget', recover), /page-budget/);
  assert.equal(now, 180000);
  assert.deepEqual(timeouts, [30000, 30000, 30000, 30000, 30000, 27000]);
});

test('interactive callers do not inherit page retry rounds', async () => {
  let attempts = 0;
  const fetcher = createRadioBrowserFetcher({ discover: advertised, get: async () => { attempts++; throw reset(); } });
  await assert.rejects(fetcher(page, { timeout: 10000 }), /2 attempt/);
  assert.equal(attempts, 2);
});

for (const error of [Object.assign(reset(), { response: { status: 404 } }), Object.assign(reset(), { code: 'ERR_CANCELED', response: { status: 503 } })]) {
  test(`permanent ${error.response?.status || error.code} errors are never retried`, async () => {
    let attempts = 0;
    const fetcher = createRadioBrowserFetcher({ discover: advertised, get: async () => { attempts++; throw error; } });
    await assert.rejects(fetcher(page, config, 'permanent', recover), actual => actual === error);
    assert.equal(attempts, 1);
  });
}

for (const phase of ['before', 'after-response', 'after-failure', 'backoff']) {
  test(`cancellation ${phase} prevents more upstream work`, async () => {
    let stopped = phase === 'before', attempts = 0, discoveries = 0;
    const fetcher = createRadioBrowserFetcher({
      discover: async () => { discoveries++; return advertised(); },
      sleep: async () => { stopped = true; },
      get: async () => {
        attempts++;
        if (phase === 'after-response') { stopped = true; return { data: [] }; }
        if (phase === 'after-failure') stopped = true;
        throw reset();
      },
    });
    await assert.rejects(fetcher(page, config, 'cancel', { ...recover, shouldStop: async () => stopped }), RadioBrowserRequestCancelledError);
    assert.equal(attempts, phase === 'before' ? 0 : phase === 'backoff' ? 2 : 1);
    if (phase === 'before') assert.equal(discoveries, 0);
  });
}

test('a leadership/control read failure is never retried as a provider transport failure', async () => {
  let attempts = 0, checksAfterRequest = 0;
  const leaderFailure = reset();
  const fetcher = createRadioBrowserFetcher({ discover: advertised, get: async () => { attempts++; return { data: [] }; } });
  await assert.rejects(fetcher(page, config, 'leader', { ...recover,
    shouldStop: async () => { if (attempts && ++checksAfterRequest === 1) throw leaderFailure; return false; },
  }), actual => actual === leaderFailure);
  assert.equal(attempts, 1);
});

test('a streaming request is actively aborted at the attempt deadline', async () => {
  let aborts = 0;
  const keepAlive = setTimeout(() => {}, 1000);
  const fetcher = createRadioBrowserFetcher({ discover: advertised,
    get: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener!('abort', () => {
        aborts++;
        reject(Object.assign(new Error('cancelled by deadline'), { code: 'ERR_CANCELED' }));
      });
    }),
  });
  try {
    await assert.rejects(fetcher(page, { timeout: 5 }), error => {
      assert.equal((error as Error).cause && ((error as Error).cause as any).code, 'ETIMEDOUT');
      return true;
    });
    assert.equal(aborts, 2);
  } finally { clearTimeout(keepAlive); }
});
