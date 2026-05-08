/**
 * One-shot historical coverage backfill (Task #144).
 *
 * Thin CLI wrapper around the reusable `runCoverageBackfill` service in
 * `services/coverage-snapshot-backfill.ts`. Connects to MongoDB,
 * delegates the per-day aggregation/upsert work to the service, then
 * disconnects. The same logic is also exposed via the admin API
 * endpoint `POST /api/admin/coverage/reconstruct-history` (Task #237)
 * so admins can re-seed history without shell access after a bulk
 * import.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/backfill-coverage-snapshots.ts
 *
 * Environment:
 *   - MONGODB_URI / DATABASE_URL / MONGO_URI (required)
 *   - BACKFILL_DAYS=30        How many days back to seed (default 30,
 *                             must be a positive finite integer)
 *   - DRY_RUN=1               Log what would be written, don't write
 */

import mongoose from 'mongoose';
import {
  runCoverageBackfill,
  aggregateForDay,
} from '../services/coverage-snapshot-backfill';
import { logger } from '../utils/logger';

// Re-export the service helpers so existing importers (e.g. tests) that
// pulled them from this script keep working after the extraction.
export { runCoverageBackfill, aggregateForDay };
export type {
  RunCoverageBackfillOptions,
  RunCoverageBackfillResult,
} from '../services/coverage-snapshot-backfill';

function parseDays(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 30;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(
      `BACKFILL_DAYS must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

async function main(): Promise<void> {
  const uri =
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL ||
    process.env.MONGO_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI / DATABASE_URL / MONGO_URI not set in env — cannot connect to Mongo.',
    );
  }
  const days = parseDays(process.env.BACKFILL_DAYS);
  const dryRun =
    process.env.DRY_RUN === '1' ||
    process.env.DRY_RUN === 'true' ||
    process.env.DRY_RUN === 'yes';

  await mongoose.connect(uri);
  try {
    await runCoverageBackfill({ days, dryRun });
  } finally {
    await mongoose.disconnect();
    logger.log('🔌 Disconnected from MongoDB.');
  }
}

const isDirectRun = (() => {
  try {
    const invoked = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : '';
    return invoked === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((err) => {
    console.error('❌ Coverage backfill failed:', err);
    process.exit(1);
  });
}
