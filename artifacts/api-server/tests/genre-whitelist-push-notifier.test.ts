/**
 * Regression tests for the genre-whitelist search-engine push alerting
 * pipeline (Task #256).
 *
 * The notifier is the only out-of-band signal we get when the
 * fire-and-forget push pipeline (sitemap rebuild + IndexNow pings) fails
 * after an admin whitelist edit. If it silently stops firing — wrong
 * step name, wrong dedupe key, swallowed error — admins are right back
 * to having to open the dashboard to spot it. These tests lock in:
 *
 *   - any failed step always alerts on the first occurrence
 *   - identical successive failures are de-duplicated inside the window
 *   - a different failure mode (different slugs, step, or error text)
 *     re-fires through the dedupe cache
 *   - the dedupe window is honoured and resets after it elapses
 *   - `ENABLE_GENRE_WHITELIST_PUSH_ALERTS=false` silences entirely
 *   - all-success / mixed-skipped pushes stay silent
 *   - a notifier that throws does NOT bubble out of
 *     `notifyWhitelistPushResult`
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock the mongo schemas so the in-app notification path is a no-op:
// these tests only care about the in-process notifier hook.
// ---------------------------------------------------------------------------

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: {
    User: {
      find: () => ({ lean: async () => [] as Array<{ _id: string }> }),
    },
    UserNotification: {
      insertMany: async () => [],
    },
    // Stub for the persisted push log added by task #255 — these tests
    // only care about the in-process notifier hook, not the database
    // write side-effect of `completePushStatus`.
    GenreWhitelistPushLog: {
      create: async () => ({}),
      find: () => ({
        sort: () => ({
          limit: () => ({ lean: async () => [] }),
        }),
      }),
    },
  },
});

import type { GenreWhitelistPushStatus } from '../src/seo/genre-whitelist-push-status.ts';

const ORIGINAL_DEDUPE_ENV = process.env.GENRE_WHITELIST_PUSH_ALERT_DEDUPE_MS;
const ORIGINAL_ENABLED_ENV = process.env.ENABLE_GENRE_WHITELIST_PUSH_ALERTS;
const ORIGINAL_WEBHOOK_ENV = process.env.BACKFILL_ALERT_WEBHOOK_URL;

before(() => {
  // Make sure the webhook side effect never fires during these tests.
  delete process.env.BACKFILL_ALERT_WEBHOOK_URL;
});

after(() => {
  if (ORIGINAL_DEDUPE_ENV === undefined) {
    delete process.env.GENRE_WHITELIST_PUSH_ALERT_DEDUPE_MS;
  } else {
    process.env.GENRE_WHITELIST_PUSH_ALERT_DEDUPE_MS = ORIGINAL_DEDUPE_ENV;
  }
  if (ORIGINAL_ENABLED_ENV === undefined) {
    delete process.env.ENABLE_GENRE_WHITELIST_PUSH_ALERTS;
  } else {
    process.env.ENABLE_GENRE_WHITELIST_PUSH_ALERTS = ORIGINAL_ENABLED_ENV;
  }
  if (ORIGINAL_WEBHOOK_ENV === undefined) {
    delete process.env.BACKFILL_ALERT_WEBHOOK_URL;
  } else {
    process.env.BACKFILL_ALERT_WEBHOOK_URL = ORIGINAL_WEBHOOK_ENV;
  }
});

beforeEach(async () => {
  delete process.env.GENRE_WHITELIST_PUSH_ALERT_DEDUPE_MS;
  delete process.env.ENABLE_GENRE_WHITELIST_PUSH_ALERTS;
  const { setGenreWhitelistPushNotifier, _resetGenreWhitelistPushDedupe } =
    await import('../src/services/genre-whitelist-push-notifier.ts');
  setGenreWhitelistPushNotifier(null);
  _resetGenreWhitelistPushDedupe();
});

function makeStatus(
  overrides: Partial<GenreWhitelistPushStatus> = {},
): GenreWhitelistPushStatus {
  return {
    triggeredAt: '2026-05-08T12:00:00.000Z',
    completedAt: '2026-05-08T12:00:01.000Z',
    triggeredBy: 'alice',
    trigger: 'add-slug',
    affectedSlugs: ['jazz'],
    sitemapRebuild: { status: 'success' },
    indexnowSitemap: { status: 'success' },
    indexnowGenreUrls: { status: 'success' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Failure detection
// ---------------------------------------------------------------------------

test('all-success push stays silent (notifier never invoked)', async () => {
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  let calls = 0;
  setGenreWhitelistPushNotifier(() => {
    calls += 1;
  });

  const result = await notifyWhitelistPushResult(makeStatus());
  assert.equal(result.failed, false);
  assert.equal(result.notified, false);
  assert.equal(result.suppressedReason, 'no-failures');
  assert.equal(calls, 0);
});

test('mixed success + skipped (no failures) stays silent', async () => {
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  let calls = 0;
  setGenreWhitelistPushNotifier(() => {
    calls += 1;
  });

  const result = await notifyWhitelistPushResult(
    makeStatus({
      indexnowGenreUrls: { status: 'skipped' },
    }),
  );
  assert.equal(result.failed, false);
  assert.equal(calls, 0);
});

test('null status is a no-op (no throw, no invocation)', async () => {
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  let calls = 0;
  setGenreWhitelistPushNotifier(() => {
    calls += 1;
  });

  const result = await notifyWhitelistPushResult(null);
  assert.equal(result.failed, false);
  assert.equal(result.notified, false);
  assert.equal(calls, 0);
});

test('any failed step alerts on first occurrence with the failed step list', async () => {
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  const calls: Array<{
    trigger: string;
    slugs: string[];
    failed: Array<{ step: string; error: string }>;
  }> = [];
  setGenreWhitelistPushNotifier((status, failed) => {
    calls.push({
      trigger: status.trigger,
      slugs: status.affectedSlugs,
      failed: failed.map((f) => ({ step: f.step, error: f.error })),
    });
  });

  const result = await notifyWhitelistPushResult(
    makeStatus({
      indexnowSitemap: { status: 'failed', error: 'IndexNow returned 503' },
    }),
  );
  assert.equal(result.failed, true);
  assert.equal(result.notified, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].trigger, 'add-slug');
  assert.deepEqual(calls[0].slugs, ['jazz']);
  assert.deepEqual(calls[0].failed, [
    { step: 'indexnowSitemap', error: 'IndexNow returned 503' },
  ]);
});

test('multiple failed steps in a single push are all reported', async () => {
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  const calls: Array<Array<string>> = [];
  setGenreWhitelistPushNotifier((_status, failed) => {
    calls.push(failed.map((f) => f.step));
  });

  await notifyWhitelistPushResult(
    makeStatus({
      sitemapRebuild: { status: 'failed', error: 'mongo down' },
      indexnowSitemap: { status: 'failed', error: 'fetch timeout' },
    }),
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['sitemapRebuild', 'indexnowSitemap']);
});

test('a failed step with no error message defaults to "unknown error"', async () => {
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  const errors: string[] = [];
  setGenreWhitelistPushNotifier((_status, failed) => {
    errors.push(...failed.map((f) => f.error));
  });

  await notifyWhitelistPushResult(
    makeStatus({
      sitemapRebuild: { status: 'failed' },
    }),
  );
  assert.deepEqual(errors, ['unknown error']);
});

// ---------------------------------------------------------------------------
// De-duplication
// ---------------------------------------------------------------------------

test('identical failure inside the dedupe window is suppressed', async () => {
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  let calls = 0;
  setGenreWhitelistPushNotifier(() => {
    calls += 1;
  });

  const failure: Partial<GenreWhitelistPushStatus> = {
    indexnowSitemap: { status: 'failed', error: 'IndexNow returned 503' },
  };

  const first = await notifyWhitelistPushResult(makeStatus(failure));
  assert.equal(first.notified, true);

  const second = await notifyWhitelistPushResult(makeStatus(failure));
  assert.equal(second.failed, true);
  assert.equal(second.notified, false);
  assert.equal(second.suppressedReason, 'deduped');

  assert.equal(calls, 1, 'identical failure should only alert once');
});

test('identical failure dedupes across different triggers (re-push by another route)', async () => {
  // Regression: dedupe must NOT key on `trigger`. Otherwise an admin
  // re-pushing the same slug via `manual-repush` after the original
  // `add-slug` push failed would still spam the channel.
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  let calls = 0;
  setGenreWhitelistPushNotifier(() => {
    calls += 1;
  });

  const failure = {
    affectedSlugs: ['jazz'],
    indexnowSitemap: { status: 'failed' as const, error: 'boom' },
  };

  await notifyWhitelistPushResult(makeStatus({ trigger: 'add-slug', ...failure }));
  await notifyWhitelistPushResult(
    makeStatus({ trigger: 'manual-repush', ...failure }),
  );

  assert.equal(calls, 1, 'same failure under different trigger should still dedupe');
});

test('zero-slug push with a failed earlier step still notifies', async () => {
  // Regression: covers the `affectedSlugs.length === 0` short-circuit
  // in `triggerSearchEnginePush` — a sitemap rebuild or IndexNow
  // sitemap ping failure on a zero-slug trigger must still alert,
  // even though the per-URL ping step is `skipped`.
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  const calls: Array<{ slugs: string[]; failed: string[] }> = [];
  setGenreWhitelistPushNotifier((status, failed) => {
    calls.push({
      slugs: status.affectedSlugs,
      failed: failed.map((f) => f.step),
    });
  });

  const result = await notifyWhitelistPushResult(
    makeStatus({
      affectedSlugs: [],
      sitemapRebuild: { status: 'success' },
      indexnowSitemap: { status: 'failed', error: 'IndexNow returned 503' },
      indexnowGenreUrls: { status: 'skipped' },
    }),
  );
  assert.equal(result.notified, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slugs, []);
  assert.deepEqual(calls[0].failed, ['indexnowSitemap']);
});

test('per-push isolation: concurrent pushes each notify with their own snapshot', async () => {
  // Regression for the "status race / misattribution" risk: two
  // overlapping pushes must each notify with their own failure
  // context, not whichever snapshot happens to be in the singleton
  // when the async work completes. After rebase onto task #255,
  // isolation is provided by `pushId`-keyed storage; the notifier
  // receives the snapshot returned by `completePushStatus(pushId)`.
  const {
    startPushStatus,
    updatePushStep,
    completePushStatus,
    getLastPushStatus,
    _resetPushStatusForTests,
  } = await import('../src/seo/genre-whitelist-push-status.ts');
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');
  _resetPushStatusForTests();

  const calls: Array<{ slugs: string[]; failed: string[]; trigger: string }> = [];
  setGenreWhitelistPushNotifier((status, failed) => {
    calls.push({
      slugs: [...status.affectedSlugs],
      failed: failed.map((f) => f.step),
      trigger: status.trigger,
    });
  });

  // Push A starts first, fails IndexNow sitemap ping for ['jazz'].
  const idA = startPushStatus({
    triggeredBy: 'alice',
    trigger: 'add-slug',
    affectedSlugs: ['jazz'],
  });
  updatePushStep(idA, 'sitemapRebuild', { status: 'success' });
  updatePushStep(idA, 'indexnowSitemap', { status: 'failed', error: 'A boom' });

  // Push B starts mid-flight (overwrites the singleton's "last" pointer),
  // fails the per-URL ping for ['rock'].
  const idB = startPushStatus({
    triggeredBy: 'bob',
    trigger: 'remove-slug',
    affectedSlugs: ['rock'],
  });
  updatePushStep(idB, 'sitemapRebuild', { status: 'success' });
  updatePushStep(idB, 'indexnowSitemap', { status: 'success', urlCount: 1 });

  // The "last push" pointer now reflects push B (the most recent start).
  assert.deepEqual(getLastPushStatus()?.affectedSlugs, ['rock']);

  // Push A finishes its remaining step and notifies with its own snapshot.
  updatePushStep(idA, 'indexnowGenreUrls', { status: 'skipped' });
  const finalA = completePushStatus(idA);
  await notifyWhitelistPushResult(finalA);

  // Push B finishes and notifies.
  updatePushStep(idB, 'indexnowGenreUrls', { status: 'failed', error: 'B boom' });
  const finalB = completePushStatus(idB);
  await notifyWhitelistPushResult(finalB);

  assert.equal(calls.length, 2, 'each push run should produce its own alert');
  // Push A's alert must carry A's slugs and A's failed step — not B's.
  assert.deepEqual(calls[0], {
    slugs: ['jazz'],
    failed: ['indexnowSitemap'],
    trigger: 'add-slug',
  });
  assert.deepEqual(calls[1], {
    slugs: ['rock'],
    failed: ['indexnowGenreUrls'],
    trigger: 'remove-slug',
  });
});

test('different affected slugs re-fire through the dedupe cache', async () => {
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  let calls = 0;
  setGenreWhitelistPushNotifier(() => {
    calls += 1;
  });

  await notifyWhitelistPushResult(
    makeStatus({
      affectedSlugs: ['jazz'],
      indexnowSitemap: { status: 'failed', error: 'boom' },
    }),
  );
  await notifyWhitelistPushResult(
    makeStatus({
      affectedSlugs: ['rock'],
      indexnowSitemap: { status: 'failed', error: 'boom' },
    }),
  );

  assert.equal(calls, 2);
});

test('different failed step re-fires through the dedupe cache', async () => {
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  let calls = 0;
  setGenreWhitelistPushNotifier(() => {
    calls += 1;
  });

  await notifyWhitelistPushResult(
    makeStatus({
      indexnowSitemap: { status: 'failed', error: 'boom' },
    }),
  );
  await notifyWhitelistPushResult(
    makeStatus({
      sitemapRebuild: { status: 'failed', error: 'boom' },
    }),
  );

  assert.equal(calls, 2);
});

test('different error message re-fires through the dedupe cache', async () => {
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  let calls = 0;
  setGenreWhitelistPushNotifier(() => {
    calls += 1;
  });

  await notifyWhitelistPushResult(
    makeStatus({
      indexnowSitemap: { status: 'failed', error: 'IndexNow returned 503' },
    }),
  );
  await notifyWhitelistPushResult(
    makeStatus({
      indexnowSitemap: { status: 'failed', error: 'IndexNow returned 429' },
    }),
  );

  assert.equal(calls, 2);
});

test('GENRE_WHITELIST_PUSH_ALERT_DEDUPE_MS=0 disables dedupe entirely', async () => {
  process.env.GENRE_WHITELIST_PUSH_ALERT_DEDUPE_MS = '0';
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  let calls = 0;
  setGenreWhitelistPushNotifier(() => {
    calls += 1;
  });

  const failure: Partial<GenreWhitelistPushStatus> = {
    indexnowSitemap: { status: 'failed', error: 'boom' },
  };

  await notifyWhitelistPushResult(makeStatus(failure));
  await notifyWhitelistPushResult(makeStatus(failure));
  await notifyWhitelistPushResult(makeStatus(failure));

  assert.equal(calls, 3, 'dedupe=0 should re-alert every time');
});

test('dedupe entry expires once the window elapses (custom 100ms window)', async () => {
  process.env.GENRE_WHITELIST_PUSH_ALERT_DEDUPE_MS = '50';
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  let calls = 0;
  setGenreWhitelistPushNotifier(() => {
    calls += 1;
  });

  const failure: Partial<GenreWhitelistPushStatus> = {
    indexnowSitemap: { status: 'failed', error: 'boom' },
  };

  await notifyWhitelistPushResult(makeStatus(failure));
  await notifyWhitelistPushResult(makeStatus(failure));
  assert.equal(calls, 1, 'second call inside window should be deduped');

  await new Promise((resolve) => setTimeout(resolve, 80));

  await notifyWhitelistPushResult(makeStatus(failure));
  assert.equal(calls, 2, 'call after window elapsed should re-alert');
});

// ---------------------------------------------------------------------------
// Kill-switch + safety
// ---------------------------------------------------------------------------

test('ENABLE_GENRE_WHITELIST_PUSH_ALERTS=false silences the notifier entirely', async () => {
  process.env.ENABLE_GENRE_WHITELIST_PUSH_ALERTS = 'false';
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  let calls = 0;
  setGenreWhitelistPushNotifier(() => {
    calls += 1;
  });

  const result = await notifyWhitelistPushResult(
    makeStatus({
      indexnowSitemap: { status: 'failed', error: 'boom' },
    }),
  );
  assert.equal(result.notified, false);
  assert.equal(result.suppressedReason, 'disabled');
  assert.equal(calls, 0);
});

test('a notifier that throws is caught — notifyWhitelistPushResult never rejects', async () => {
  const { notifyWhitelistPushResult, setGenreWhitelistPushNotifier } =
    await import('../src/services/genre-whitelist-push-notifier.ts');

  setGenreWhitelistPushNotifier(() => {
    throw new Error('alert channel exploded');
  });

  await assert.doesNotReject(
    notifyWhitelistPushResult(
      makeStatus({
        indexnowSitemap: { status: 'failed', error: 'boom' },
      }),
    ),
  );
});

test('getFailedSteps surfaces only `failed` steps (not `pending` or `skipped`)', async () => {
  const { getFailedSteps } = await import(
    '../src/services/genre-whitelist-push-notifier.ts'
  );

  const steps = getFailedSteps(
    makeStatus({
      sitemapRebuild: { status: 'pending' },
      indexnowSitemap: { status: 'failed', error: 'boom' },
      indexnowGenreUrls: { status: 'skipped' },
    }),
  );
  assert.deepEqual(steps, [{ step: 'indexnowSitemap', error: 'boom' }]);
});
