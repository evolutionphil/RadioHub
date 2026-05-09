/**
 * Regression tests for the manual genre-slug cleanup endpoint
 * (Task #348).
 *
 * Task #263 added `POST /api/admin/maintenance/genre-slug-cleanup/run`
 * which is gated behind `requireAdmin` and uses the singleton lock on
 * `scheduledGenreSlugCleanup` to prevent two concurrent sweeps from
 * doubling read pressure on the Genre collection. There is no other
 * automated coverage of that contract, so a future refactor of the
 * scheduled service could quietly let two sweeps overlap.
 *
 * These tests lock in:
 *   - Non-admin POSTs are rejected by the requireAdmin middleware.
 *   - A second POST while the first run is still in flight returns
 *     409 with the live status payload (isRunning=true, lastRunId).
 *   - Once the first run completes, a fresh POST is accepted again
 *     (the lock is not sticky after the run resolves).
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

// ---------------------------------------------------------------------------
// Mutable fake state for `scheduledGenreSlugCleanup`. The route only
// touches `getStatus()` and `runOnce()`, so we expose just enough surface
// to drive the lock contract without booting Mongo / cron.
// ---------------------------------------------------------------------------

let isRunning = false;
let lastRunAt: Date | null = null;
let lastRunId: string | null = null;
let runOnceCalls = 0;
let pendingResolve: ((value: unknown) => void) | null = null;

const fakeScheduled = {
  getStatus: () => ({ isRunning, lastRunAt, lastRunId }),
  runOnce: (_trigger: string) => {
    runOnceCalls += 1;
    isRunning = true;
    lastRunId = `run-${runOnceCalls}`;
    return new Promise((resolve) => {
      pendingResolve = resolve;
    });
  },
};

function finishPendingRun() {
  const resolve = pendingResolve;
  pendingResolve = null;
  isRunning = false;
  lastRunAt = new Date();
  resolve?.(null);
}

function resetState() {
  isRunning = false;
  lastRunAt = null;
  lastRunId = null;
  runOnceCalls = 0;
  pendingResolve = null;
}

// ---------------------------------------------------------------------------
// Module mocks — installed BEFORE importing the routes module.
// ---------------------------------------------------------------------------

mock.module(
  new URL(
    '../src/services/scheduled-genre-slug-cleanup.ts',
    import.meta.url,
  ).href,
  {
    namedExports: {
      scheduledGenreSlugCleanup: fakeScheduled,
      getGenreSlugCleanupRetention: () => ({ days: 90, maxRows: 200 }),
    },
  },
);

mock.module(
  new URL(
    '../src/services/genre-slug-cleanup-notifier.ts',
    import.meta.url,
  ).href,
  {
    namedExports: {
      getGenreSlugCleanupAlertThreshold: () => 5,
    },
  },
);

// The route module also imports a handful of unrelated services / models
// at the top of the file. They aren't exercised by the cleanup endpoint
// but must resolve at import time, so we stub them with no-op surfaces.

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: {
    Station: {},
    BackfillRun: {},
    Genre: {},
    GenreSlugCleanupRun: {},
    AdminSetting: {},
  },
});

mock.module(
  new URL('../src/services/scheduled-backfill.ts', import.meta.url).href,
  {
    namedExports: {
      BACKFILL_RETENTION_DAYS_MAX: 3650,
      BACKFILL_RETENTION_DAYS_MIN: 1,
      BACKFILL_RETENTION_MAX_ROWS_MAX: 100000,
      BACKFILL_RETENTION_MAX_ROWS_MIN: 10,
      BACKFILL_RETENTION_SETTINGS_KEY: 'backfill-retention',
      getDefaultBackfillRetention: () => ({ days: 90, maxRows: 200 }),
      getEnvBackfillRetention: () => ({
        days: { source: 'default' as const, value: 90 },
        maxRows: { source: 'default' as const, value: 200 },
      }),
      invalidateBackfillRetentionCache: () => {},
      loadStoredBackfillRetentionSettings: async () => null,
      resolveBackfillRetentionSettings: async () => ({
        days: 90,
        maxRows: 200,
        source: 'default' as const,
      }),
      scheduledBackfill: {
        start: async () => null,
        getStatus: () => ({ isRunning: false }),
      },
    },
  },
);

mock.module(
  new URL('../src/services/radio-browser.ts', import.meta.url).href,
  {
    namedExports: {
      radioBrowserService: {
        getStationByUuid: async () => null,
      },
    },
  },
);

mock.module(
  new URL('../src/services/admin-setting-audit.ts', import.meta.url).href,
  {
    namedExports: {
      clearAdminSettingWithHistory: async () => null,
      listAdminSettingHistory: async () => [],
      parseHistoryLimit: () => 20,
      upsertAdminSettingWithHistory: async () => null,
    },
  },
);

mock.module(new URL('../src/utils/logger.ts', import.meta.url).href, {
  namedExports: {
    logger: {
      log: () => {},
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    },
  },
});

// ---------------------------------------------------------------------------
// Boot Express app with mocked deps.
// ---------------------------------------------------------------------------

let server: HttpServer;
let baseUrl: string;

before(async () => {
  process.env.NODE_ENV = 'test';

  const mod = (await import(
    '../src/routes/admin-maintenance-routes.ts'
  )) as {
    registerAdminMaintenanceRoutes: (
      app: Express,
      deps: {
        requireAdmin: (
          req: Request,
          res: Response,
          next: NextFunction,
        ) => void;
      },
    ) => void;
  };

  const app = express();
  app.use(express.json());

  // Test-only requireAdmin: callers opt in by sending `x-admin: 1`.
  // Mirrors the pattern used by admin-genres-create-route.test.ts so the
  // 401 path can be exercised without standing up Passport / sessions.
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (req.header('x-admin') === '1') return next();
    return void res.status(401).json({ error: 'Admin required' });
  };

  mod.registerAdminMaintenanceRoutes(app, { requireAdmin });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ENDPOINT = '/api/admin/maintenance/genre-slug-cleanup/run';

test('POST cleanup/run rejects non-admins with 401 and never invokes runOnce', async () => {
  resetState();
  const res = await fetch(`${baseUrl}${ENDPOINT}`, { method: 'POST' });
  assert.equal(res.status, 401, 'requireAdmin must reject anonymous callers');
  assert.equal(
    runOnceCalls,
    0,
    'runOnce must NOT be invoked when the request is rejected by requireAdmin',
  );
});

test('POST cleanup/run returns 409 with the live status while a previous run is still in flight', async () => {
  resetState();

  // First call kicks off a run that we deliberately leave pending so the
  // singleton lock stays held across the second POST.
  const first = await fetch(`${baseUrl}${ENDPOINT}`, {
    method: 'POST',
    headers: { 'x-admin': '1' },
  });
  assert.equal(first.status, 200, 'first admin POST must start a run');
  const firstBody = (await first.json()) as {
    ok: boolean;
    status: { isRunning: boolean; lastRunId: string | null };
  };
  assert.equal(firstBody.ok, true);
  assert.equal(
    firstBody.status.isRunning,
    true,
    'status echoed by the first response must show the run is in flight',
  );
  assert.equal(firstBody.status.lastRunId, 'run-1');
  assert.equal(runOnceCalls, 1);

  // Second POST while the first is still pending: must be rejected with
  // 409 and echo back the current status so the dashboard can render
  // "already running" without an extra round-trip.
  const second = await fetch(`${baseUrl}${ENDPOINT}`, {
    method: 'POST',
    headers: { 'x-admin': '1' },
  });
  assert.equal(
    second.status,
    409,
    'concurrent POST must be rejected with 409 (already_running)',
  );
  const secondBody = (await second.json()) as {
    error: string;
    status: { isRunning: boolean; lastRunId: string | null };
  };
  assert.equal(secondBody.error, 'already_running');
  assert.equal(
    secondBody.status.isRunning,
    true,
    '409 payload must include the live status with isRunning=true',
  );
  assert.equal(
    secondBody.status.lastRunId,
    'run-1',
    '409 payload must echo the in-flight runId so the dashboard can deep-link',
  );
  assert.equal(
    runOnceCalls,
    1,
    'runOnce must NOT be invoked a second time while the lock is held',
  );

  // After the in-flight run finishes, a fresh POST is accepted again —
  // proves the 409 path is the singleton lock and not a sticky flag.
  finishPendingRun();
  // Yield once so the route's fire-and-forget `.catch()` settles before
  // we inspect state.
  await new Promise((r) => setImmediate(r));

  const third = await fetch(`${baseUrl}${ENDPOINT}`, {
    method: 'POST',
    headers: { 'x-admin': '1' },
  });
  assert.equal(
    third.status,
    200,
    'POST after the previous run finished must start a new run',
  );
  assert.equal(
    runOnceCalls,
    2,
    'runOnce must be invoked exactly once for the follow-up admin POST',
  );

  // Cleanup: resolve the run we just started so the `after` hook can
  // close the server without a dangling promise.
  finishPendingRun();
});
