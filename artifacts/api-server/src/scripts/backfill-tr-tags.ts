/**
 * One-shot backfill: re-fetch Radio-Browser tags for stations whose
 * `tags` field is missing or empty. Re-uses
 * `SyncService.hydrateMissingTagsInBackground({ countryCode })` so the
 * script and the weekly cron (Task #68) follow exactly the same
 * Radio-Browser call pattern, retry posture, and write semantics.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-tr-tags.ts
 *
 * Or via the npm aliases:
 *   pnpm --filter @workspace/api-server run backfill:tr-tags
 *   BACKFILL_COUNTRY=DE pnpm --filter @workspace/api-server run backfill:tags
 *
 * Environment: requires `MONGODB_URI` (or `DATABASE_URL`).
 */

import mongoose from 'mongoose';
import { SyncService } from '../services/sync';
import { BackfillRun } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';

const COUNTRY_CODE = (process.env.BACKFILL_COUNTRY || 'TR').toUpperCase();
const LIMIT = Number(process.env.BACKFILL_LIMIT || 2000);

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

  logger.log(`🔌 Connecting to MongoDB for ${COUNTRY_CODE} tags backfill...`);
  await mongoose.connect(uri);

  const startedAt = new Date();
  const run = await BackfillRun.create({
    trigger: `manual:tags:${COUNTRY_CODE}`,
    status: 'running',
    topN: 1,
    startedAt,
    logos: [],
    tags: [],
  });

  try {
    const sync = new SyncService();
    const result = await sync.hydrateMissingTagsInBackground({
      countryCode: COUNTRY_CODE,
      limit: LIMIT,
    });

    logger.log(
      `📊 Backfill summary (${COUNTRY_CODE}): processed=${result.processed} hydrated=${result.hydrated} upstreamEmpty=${result.emptyUpstream} failed=${result.failed}`,
    );

    run.tags.push({
      countryCode: COUNTRY_CODE,
      processed: result.processed,
      hydrated: result.hydrated,
      emptyUpstream: result.emptyUpstream,
      failed: result.failed,
    });
    const finishedAt = new Date();
    run.status = 'completed';
    run.finishedAt = finishedAt;
    run.durationMs = finishedAt.getTime() - startedAt.getTime();
    await run.save();
  } catch (err) {
    const finishedAt = new Date();
    run.status = 'failed';
    run.finishedAt = finishedAt;
    run.durationMs = finishedAt.getTime() - startedAt.getTime();
    run.errorMessage = err instanceof Error ? err.message : String(err);
    await run.save();
    throw err;
  } finally {
    await mongoose.disconnect();
    logger.log('🔌 Disconnected from MongoDB.');
  }
}

main().catch((err) => {
  console.error('❌ Tags backfill failed:', err);
  process.exit(1);
});
