/**
 * One-shot backfill: enqueue stations whose `logoAssets` are missing or
 * never completed back into the existing logo-processor pipeline. The
 * filter and enqueue logic now live in
 * `services/scheduled-backfill.ts` (Task #68) so the weekly cron and
 * this manual escape hatch share exactly the same code path.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-tr-logos.ts
 *
 * Or via the npm aliases:
 *   pnpm --filter @workspace/api-server run backfill:tr-logos
 *   BACKFILL_COUNTRY=DE pnpm --filter @workspace/api-server run backfill:logos
 *
 * Environment: requires `DATABASE_URL`.
 */

import { initializePostgres, closePostgres } from "../postgres-runtime";
import { pgCoverage } from "../data/postgres-coverage-store";
import { enqueueLogosForCountry } from "../services/scheduled-backfill";
import { logger } from "../utils/logger";

const COUNTRY_CODE = (process.env.BACKFILL_COUNTRY || "TR").toUpperCase();

async function main(): Promise<void> {
  try {
    await initializePostgres();
    const startedAt = new Date();
    const run = await pgCoverage().createRun({
      trigger: `manual:logos:${COUNTRY_CODE}`,
      status: "running",
      topN: 1,
      startedAt,
      logos: [],
      tags: [],
    });

    try {
      const { candidates, enqueued } =
        await enqueueLogosForCountry(COUNTRY_CODE);
      logger.log(
        `🔎 Found ${candidates} ${COUNTRY_CODE} stations needing logo (re)processing`,
      );
      if (candidates === 0) {
        logger.log("✅ Nothing to enqueue — exiting.");
      } else {
        logger.log(
          `📥 Enqueued ${enqueued}/${candidates} ${COUNTRY_CODE} stations into the logo pipeline (logoAssets unset). The nightly cron and admin bulk endpoint will now pick these up.`,
        );
      }
      run.logos.push({ countryCode: COUNTRY_CODE, candidates, enqueued });
      const finishedAt = new Date();
      run.status = "completed";
      run.finishedAt = finishedAt;
      run.durationMs = finishedAt.getTime() - startedAt.getTime();
      await pgCoverage().saveRun(run);
    } catch (err) {
      const finishedAt = new Date();
      run.status = "failed";
      run.finishedAt = finishedAt;
      run.durationMs = finishedAt.getTime() - startedAt.getTime();
      run.errorMessage = err instanceof Error ? err.message : String(err);
      await pgCoverage().saveRun(run);
      throw err;
    }
  } finally {
    await closePostgres();
    logger.log("🔌 Disconnected from PostgreSQL.");
  }
}

main().catch((err) => {
  console.error("❌ Logo backfill failed:", err);
  process.exit(1);
});
