/**
 * One-shot backfill: enqueue Turkish stations whose logoAssets are missing
 * or never completed back into the existing logo-processor pipeline.
 *
 * The TR audit found 251 TR stations with `logoAssets` either absent or stuck
 * on a non-completed status, so they never get a webp48/webp96/webp256 mirror
 * on S3. This script unsets `logoAssets` on every such station so the next
 * scheduled-logo-processor sweep (or the admin bulk endpoint) picks them up.
 *
 * The candidate filter mirrors `ScheduledLogoProcessor.runOnce` exactly:
 *   - `favicon` is a non-empty URL, `slug` is non-null
 *   - `logoAssets` missing, OR status `pending`, OR
 *   - status `failed` with a NON-permanent failureType (we exclude
 *     `http_error` and `invalid_format` — those are dead source URLs and
 *     re-enqueueing them would just churn), OR
 *   - status `processing` that is stale (lastAttempt/processedAt older than
 *     1 hour, matching cron's `STALE_PROCESSING_MS`).
 *
 * Idempotent: completed assets and recent in-flight `processing` rows are
 * left untouched, and re-running the script on an already-enqueued station
 * is a no-op (the row no longer matches the filter once `logoAssets` is unset
 * and a fresh attempt starts).
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-tr-logos.ts
 *
 * Or via the npm alias:
 *   pnpm --filter @workspace/api-server run backfill:tr-logos
 *
 * Environment: requires `MONGODB_URI` (or `DATABASE_URL`) — same as the
 * running api-server.
 */

import mongoose from 'mongoose';
import { Station } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';

const COUNTRY_CODE = (process.env.BACKFILL_COUNTRY || 'TR').toUpperCase();

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

  logger.log(`🔌 Connecting to MongoDB for ${COUNTRY_CODE} logo backfill...`);
  await mongoose.connect(uri);

  // Mirror the cron's stale-processing pivot (1h) so we don't poach in-flight
  // jobs from a concurrently running scheduled-logo-processor pass.
  const STALE_PROCESSING_MS = 60 * 60 * 1000;
  const stalePivot = new Date(Date.now() - STALE_PROCESSING_MS);

  const filter: Record<string, unknown> = {
    countryCode: COUNTRY_CODE,
    favicon: { $exists: true, $nin: ['', null, 'null'] },
    slug: { $exists: true, $ne: null },
    $or: [
      { logoAssets: { $exists: false } },
      { 'logoAssets.status': { $exists: false } },
      { 'logoAssets.status': 'pending' },
      // Only retry transient failures. http_error / invalid_format are
      // permanent dead-source markers; cron skips them so we do too.
      {
        'logoAssets.status': 'failed',
        'logoAssets.failureType': { $nin: ['http_error', 'invalid_format'] },
      },
      {
        'logoAssets.status': 'failed',
        'logoAssets.failureType': { $exists: false },
      },
      // Stale-processing recovery only — match cron exactly.
      {
        'logoAssets.status': 'processing',
        $or: [
          { 'logoAssets.lastAttempt': { $lt: stalePivot } },
          { 'logoAssets.lastAttempt': { $exists: false }, 'logoAssets.processedAt': { $lt: stalePivot } },
          { 'logoAssets.lastAttempt': { $exists: false }, 'logoAssets.processedAt': { $exists: false } },
        ],
      },
    ],
  };

  const totalCandidates = await Station.countDocuments(filter);
  logger.log(
    `🔎 Found ${totalCandidates} ${COUNTRY_CODE} stations needing logo (re)processing`,
  );

  if (totalCandidates === 0) {
    logger.log('✅ Nothing to enqueue — exiting.');
    await mongoose.disconnect();
    return;
  }

  // Unset any partial/non-completed logoAssets so the scanners treat the
  // station as fresh on their next pass. Stations with completed assets are
  // excluded by the filter above, so this is safe and idempotent.
  const result = await Station.updateMany(filter, {
    $unset: { logoAssets: '' },
  });

  logger.log(
    `📥 Enqueued ${result.modifiedCount}/${totalCandidates} ${COUNTRY_CODE} stations into the logo pipeline (logoAssets unset). The nightly cron and admin bulk endpoint will now pick these up.`,
  );

  await mongoose.disconnect();
  logger.log('🔌 Disconnected from MongoDB.');
}

main().catch((err) => {
  console.error('❌ Logo backfill failed:', err);
  process.exit(1);
});
