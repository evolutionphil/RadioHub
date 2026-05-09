/**
 * Task #362 — regression coverage for the scheduled sitemap rebuild's
 * IndexNow ping (added in Task #272).
 *
 * The 6-hour `startManifestRefreshLoop` cron pings IndexNow with trigger
 * `'sitemap-regen'` only when at least one (type, lang) manifest got swapped
 * to a fresh active version (`activatedCount > 0`). Without this guard we'd
 * either ping on every cycle (burning the daily IndexNow quota and looking
 * like spam to Bing) or never ping at all (slow indexing of new content).
 *
 * These tests exercise the extracted `runScheduledManifestRefreshTick` seam
 * with an injected builder + a mocked `IndexNowService` and assert:
 *
 *   - activatedCount > 0  → submitSitemaps called once with
 *                            (undefined, 'sitemap-regen')
 *   - activatedCount = 0  → submitSitemaps NOT called (no-op rebuild)
 *   - built = false        → submitSitemaps NOT called (skipped rebuild)
 *   - IndexNow throws      → no error escapes the cron callback
 *   - builder throws       → no error escapes the cron callback
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock IndexNowService BEFORE importing the manifest builder so the builder
// picks up the mocked module via its `import { IndexNowService } from
// '../services/indexnow'` binding.
// ---------------------------------------------------------------------------

interface SubmitCall {
  host: string | undefined;
  trigger: string;
}
const submitCalls: SubmitCall[] = [];
let submitImpl: (host: string | undefined, trigger: string) => Promise<unknown> = async () => ({
  ok: true,
});

const FakeIndexNowService = {
  submitSitemaps: async (host: string | undefined, trigger: string) => {
    submitCalls.push({ host, trigger });
    return submitImpl(host, trigger);
  },
};

mock.module(
  new URL('../src/services/indexnow.ts', import.meta.url).href,
  {
    namedExports: {
      IndexNowService: FakeIndexNowService,
    },
  },
);

// Silence the manifest-builder's logger.error calls so an expected failure
// path doesn't pollute the test output.
mock.module(
  new URL('../src/utils/logger.ts', import.meta.url).href,
  {
    namedExports: {
      logger: {
        log: () => {},
        warn: () => {},
        error: () => {},
        info: () => {},
        debug: () => {},
      },
    },
  },
);

// Import AFTER the mocks are registered.
const { runScheduledManifestRefreshTick } = await import(
  '../src/seo/sitemap-manifest-builder.ts'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BuildResult = Awaited<ReturnType<typeof import(
  '../src/seo/sitemap-manifest-builder.ts'
).buildAllSitemapManifests>>;

function makeBuilder(result: BuildResult | (() => Promise<BuildResult>)) {
  return async () => (typeof result === 'function' ? result() : result);
}

beforeEach(() => {
  submitCalls.length = 0;
  submitImpl = async () => ({ ok: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('pings IndexNow once with sitemap-regen when activatedCount > 0', async () => {
  await runScheduledManifestRefreshTick(
    makeBuilder({
      built: true,
      qualifiedLanguagesHash: 'h1',
      qualifiedLanguages: ['en', 'de'],
      activatedCount: 3,
    }),
  );

  assert.equal(submitCalls.length, 1, 'expected exactly one IndexNow submission');
  assert.deepEqual(submitCalls[0], { host: undefined, trigger: 'sitemap-regen' });
});

test('does NOT ping IndexNow on a no-op rebuild (activatedCount === 0)', async () => {
  await runScheduledManifestRefreshTick(
    makeBuilder({
      built: true,
      qualifiedLanguagesHash: 'h1',
      qualifiedLanguages: ['en', 'de'],
      activatedCount: 0,
    }),
  );

  assert.equal(submitCalls.length, 0);
});

test('does NOT ping IndexNow when the build was skipped entirely (built=false)', async () => {
  // e.g. fresh-window short-circuit or qualified-languages unavailable
  await runScheduledManifestRefreshTick(
    makeBuilder({
      built: false,
      qualifiedLanguagesHash: 'h1',
      qualifiedLanguages: ['en', 'de'],
      activatedCount: 0,
    }),
  );

  assert.equal(submitCalls.length, 0);
});

test('does NOT ping IndexNow when activatedCount is missing (undefined)', async () => {
  // Defensive: an older builder version returning {built:true} without
  // activatedCount must not be treated as "something changed".
  await runScheduledManifestRefreshTick(
    makeBuilder({
      built: true,
      qualifiedLanguagesHash: 'h1',
      qualifiedLanguages: ['en'],
    } as BuildResult),
  );

  assert.equal(submitCalls.length, 0);
});

test('IndexNow failure is swallowed and does not throw out of the cron callback', async () => {
  submitImpl = async () => {
    throw new Error('simulated IndexNow 500');
  };

  await assert.doesNotReject(
    runScheduledManifestRefreshTick(
      makeBuilder({
        built: true,
        qualifiedLanguagesHash: 'h1',
        qualifiedLanguages: ['en'],
        activatedCount: 1,
      }),
    ),
  );
  assert.equal(submitCalls.length, 1, 'submission was still attempted');
});

test('builder failure is swallowed and IndexNow is not pinged', async () => {
  await assert.doesNotReject(
    runScheduledManifestRefreshTick(async () => {
      throw new Error('simulated rebuild failure');
    }),
  );
  assert.equal(submitCalls.length, 0);
});
