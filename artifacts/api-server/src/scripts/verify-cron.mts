/**
 * Read-only post-cron logo outcomes from PostgreSQL.
 * BACKFILL_COUNTRIES=US,DE,RU overrides the default cohort.
 */
import {
  initializePostgres,
  closePostgres,
  getPostgresPool,
} from "../postgres-runtime.js";

const countries = (process.env.BACKFILL_COUNTRIES || "US,DE,RU,FR,GB")
  .split(",")
  .map((country) => country.trim().toUpperCase())
  .filter(Boolean);
if (countries.some((country) => !/^[A-Z]{2}$/.test(country)))
  throw new Error("BACKFILL_COUNTRIES must contain two-letter country codes");
try {
  await initializePostgres();
  for (const country of countries) {
    const buckets = (
      await getPostgresPool().query(
        `SELECT jsonb_build_object('status',logo_assets->>'status','failureType',logo_assets->>'failureType') AS "_id",count(*)::integer AS c
       FROM stations WHERE country_code=$1
       AND CASE WHEN pg_input_is_valid(logo_assets->>'lastAttempt','timestamptz')
         THEN (logo_assets->>'lastAttempt')::timestamptz>=now()-interval '36 hours' ELSE false END
       GROUP BY logo_assets->>'status',logo_assets->>'failureType' ORDER BY c DESC`,
        [country],
      )
    ).rows;
    console.log(country, JSON.stringify(buckets));
    const {
      rows: [pending],
    } = await getPostgresPool().query(
      "SELECT count(*)::integer AS count FROM stations WHERE country_code=$1 AND favicon IS NOT NULL AND favicon NOT IN ('','null') AND slug IS NOT NULL AND (logo_assets IS NULL OR logo_assets='{}'::jsonb OR logo_assets->>'status'='pending')",
      [country],
    );
    console.log(country, "still-unset/pending:", pending.count);
  }
} finally {
  await closePostgres();
}
