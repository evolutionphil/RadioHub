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

import { initializePostgres, closePostgres } from "../postgres-runtime";

import { seedSearchPageTranslations } from "../seo/search-page-translations-seed";
import { logger } from "../utils/logger";

async function main() {
  await initializePostgres();

  try {
    await seedSearchPageTranslations();
    logger.log("search-page translation seed complete.");
  } finally {
    await closePostgres().catch(() => undefined);
  }
}

main().catch((err) => {
  logger.error("search-page translation seed failed:", err);
  process.exit(1);
});
