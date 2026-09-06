/**
 * Process a bounded logo cohort per country using the production PostgreSQL store.
 * BACKFILL_COUNTRIES=US,DE,RU,FR,GB; SAMPLE=15 (1..100).
 */
import {
  initializePostgres,
  closePostgres,
  getPostgresPool,
} from "../postgres-runtime.js";
import { logoProcessor } from "../services/logo-processor.js";

const countries = (process.env.BACKFILL_COUNTRIES || "US,DE,RU,FR,GB")
  .split(",")
  .map((country) => country.trim().toUpperCase())
  .filter(Boolean);
const sample = Number(process.env.SAMPLE || 15);
if (!Number.isInteger(sample) || sample < 1 || sample > 100)
  throw new Error("SAMPLE must be an integer from 1 to 100");
if (countries.some((country) => !/^[A-Z]{2}$/.test(country)))
  throw new Error("BACKFILL_COUNTRIES must contain two-letter country codes");

try {
  await initializePostgres();
  const totals: Record<string, Record<string, number>> = {};
  for (const country of countries) {
    const cohort = (
      await getPostgresPool().query(
        "SELECT id,slug,favicon FROM stations WHERE country_code=$1 AND favicon IS NOT NULL AND favicon NOT IN ('','null') AND slug IS NOT NULL AND (logo_assets IS NULL OR logo_assets='{}'::jsonb) ORDER BY id LIMIT $2",
        [country, sample],
      )
    ).rows;
    const bucket: Record<string, number> = {};
    for (const station of cohort) {
      try {
        const result = await logoProcessor.processFromUrl(
          station.id,
          station.slug,
          station.favicon,
        );
        const key = result.success
          ? "completed"
          : "failed:" + (result.failureType ?? "unknown");
        bucket[key] = (bucket[key] ?? 0) + 1;
      } catch {
        bucket.threw = (bucket.threw ?? 0) + 1;
      }
    }
    totals[country] = bucket;
    console.log(country, JSON.stringify(bucket));
  }
  console.log("TOTALS", JSON.stringify(totals));
} finally {
  await closePostgres();
}
