/**
 * One-shot runner for `seedSearchPageTranslations`.
 *
 * The seeder also runs at every server boot from `routes.ts`, but this
 * standalone entrypoint lets the build/CI pipeline backfill the rows
 * without spinning up the full Express stack — useful when the
 * `tests/search-translations-db-coverage.test.ts` guard is red and we
 * just need to populate the DB once.
 *
 * Usage:  tsx src/scripts/run-search-translations-seed.ts
 */

import mongoose from 'mongoose';

import { seedSearchPageTranslations } from '../seo/search-page-translations-seed';
import { logger } from '../utils/logger';

async function main() {
  const uri =
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL ||
    process.env.MONGO_URI ||
    '';
  if (!uri) {
    logger.error(
      'No Mongo URI configured (MONGODB_URI / DATABASE_URL / MONGO_URI). Aborting.',
    );
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  try {
    await seedSearchPageTranslations();
    logger.log('search-page translation seed complete.');
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  logger.error('search-page translation seed failed:', err);
  process.exit(1);
});
