/**
 * Backfill migration for task #17 — Bing ContentQuality cleanup.
 *
 * Scans every Station and:
 *   1. Re-runs the new transliterating slugifier. If the result differs from
 *      the current slug, the old slug is pushed onto `slugAliases` (so the
 *      301 fallback in the URL middleware / SEO renderer keeps working) and
 *      the new slug is written.
 *   2. Evaluates the central junk rules. If the station qualifies as junk,
 *      `noIndex: true` is set so the sitemap/SSR pipeline drops it.
 *   3. Writes a CSV audit report to `attached_assets/task-17-audit-report.csv`
 *      summarising what changed for each affected station.
 *
 * Idempotent: re-running the script only updates stations whose new state
 * differs from what's already on disk.
 *
 *   tsx scripts/clean-content-quality-urls.ts
 *   tsx scripts/clean-content-quality-urls.ts --dry-run
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import path from 'path';
import { Station } from '../shared/mongo-schemas';
import {
  slugifyStationName,
  evaluateJunkStation,
  getEligibleLanguages,
  frequencyPrefixBaseSlug,
} from '../server/seo/junk-station-rules';

const DRY_RUN = process.argv.includes('--dry-run');
const REPORT_PATH = path.join(
  process.cwd(),
  'attached_assets',
  'task-17-audit-report.csv',
);

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set in env');

  console.log(`[task-17] Connecting to Mongo (dryRun=${DRY_RUN})…`);
  await mongoose.connect(uri);

  const totalStations = await Station.countDocuments();
  console.log(`[task-17] Scanning ${totalStations} stations`);

  const auditRows: string[] = [
    '"slug","name","country","action","reason","new_slug","eligible_languages"',
  ];

  let processed = 0;
  let slugRewrites = 0;
  let junkMarked = 0;
  let bothChanges = 0;

  // Stream via cursor — bounded memory for the whole collection.
  const cursor = Station.find({})
    .select(
      'slug slugAliases noIndex name url homepage tags country countryCode language languageCodes bitrate',
    )
    .lean()
    .cursor({ batchSize: 500 });

  // Track in-memory uniqueness of the new slugs we hand out so we don't
  // accidentally collide two stations onto the same slug during the rewrite.
  const reservedSlugs = new Set<string>();

  for await (const station of cursor as any) {
    processed++;
    if (processed % 5000 === 0) {
      console.log(
        `[task-17] processed=${processed} slugRewrites=${slugRewrites} junkMarked=${junkMarked}`,
      );
    }

    const ops: Record<string, any> = {};
    const updateActions: string[] = [];
    const reasons: string[] = [];

    // ---- 1) Slug regeneration ---------------------------------------------
    const desired = slugifyStationName(station.name || '') || station.slug || '';
    const currentSlug: string = (station.slug || '').toString();

    if (desired && desired !== currentSlug) {
      // Resolve collision by appending a -N counter against existing slugs.
      let candidate = desired;
      let counter = 1;
      // Prefer DB lookup for accuracy; cap iterations.
      // eslint-disable-next-line no-await-in-loop
      while (
        reservedSlugs.has(candidate) ||
        (await Station.exists({
          slug: candidate,
          _id: { $ne: station._id },
        }))
      ) {
        candidate = `${desired}-${counter++}`;
        if (counter > 50) break; // safety
      }

      ops.slug = candidate;
      reservedSlugs.add(candidate);

      if (currentSlug && currentSlug !== candidate) {
        // Preserve the old slug as an alias so existing inbound links still
        // resolve via the SEO renderer's slugAliases lookup.
        const aliases = new Set<string>(
          Array.isArray(station.slugAliases) ? station.slugAliases : [],
        );
        aliases.add(currentSlug);
        ops.slugAliases = Array.from(aliases);
      }

      slugRewrites++;
      updateActions.push('slug-rewrite');
      reasons.push(`old=${currentSlug || '∅'} → new=${candidate}`);
    }

    // ---- 2) Junk evaluation -----------------------------------------------
    const verdict = evaluateJunkStation({
      name: station.name,
      slug: ops.slug ?? currentSlug,
      url: station.url,
      homepage: station.homepage,
      tags: station.tags,
      bitrate: station.bitrate,
    });

    // Sibling-aware duplicate detection: only mark `slug-N` records as junk
    // when an actual sibling exists with the canonical base slug. Prevents
    // legitimate stations whose names happen to end in numbers from being
    // noindexed.
    let dupeOfBase: string | null = null;
    const finalSlugForDupe = ops.slug ?? currentSlug;
    const dupeMatch = /^(.*)-(\d+)$/.exec(finalSlugForDupe || '');
    if (dupeMatch) {
      const baseSlug = dupeMatch[1];
      const counter = parseInt(dupeMatch[2], 10);
      // Only consider small counters typical of collision suffixes.
      if (counter > 0 && counter <= 10) {
        const sibling = await Station.exists({
          slug: baseSlug,
          _id: { $ne: station._id },
        });
        if (sibling) dupeOfBase = baseSlug;
      }
    }

    // Frequency-prefix sibling check: catches "1046-rtl-luxus-hits" when
    // "rtl-luxus-hits" already exists. Same noindex strategy as the -N suffix
    // branch above. Skipped if we already flagged the record as a -N dupe.
    if (!dupeOfBase) {
      const freqBase = frequencyPrefixBaseSlug(finalSlugForDupe || '');
      if (freqBase) {
        const sibling = await Station.exists({
          slug: freqBase,
          _id: { $ne: station._id },
        });
        if (sibling) dupeOfBase = freqBase;
      }
    }

    const isJunk = verdict.isJunk || !!dupeOfBase;
    const junkReason = verdict.isJunk
      ? verdict.reason
      : dupeOfBase
        ? `duplicate-of:${dupeOfBase}`
        : '';

    if (isJunk && station.noIndex !== true) {
      ops.noIndex = true;
      junkMarked++;
      updateActions.push('mark-noindex');
      reasons.push(`junk:${junkReason}`);
    } else if (!isJunk && station.noIndex === true) {
      // Previously flagged but the new ruleset cleared it — un-flag.
      ops.noIndex = false;
      updateActions.push('clear-noindex');
      reasons.push('reclassified-as-valid');
    }

    if (Object.keys(ops).length === 0) continue;

    if (updateActions.includes('slug-rewrite') && (updateActions.includes('mark-noindex') || updateActions.includes('clear-noindex'))) {
      bothChanges++;
    }

    // ---- 3) Audit row ------------------------------------------------------
    const eligible = getEligibleLanguages(station).join('|');
    auditRows.push(
      [
        currentSlug,
        (station.name || '').replace(/"/g, "'"),
        station.country || '',
        updateActions.join('+'),
        reasons.join(' ; ').replace(/"/g, "'"),
        ops.slug ?? currentSlug,
        eligible,
      ]
        .map((v) => `"${v}"`)
        .join(','),
    );

    // ---- 4) Write -----------------------------------------------------------
    if (!DRY_RUN) {
      await Station.updateOne({ _id: station._id }, { $set: ops });
    }
  }

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, auditRows.join('\n'), 'utf8');

  console.log('[task-17] ──────────── summary ────────────');
  console.log(`[task-17] processed:         ${processed}`);
  console.log(`[task-17] slug rewrites:     ${slugRewrites}`);
  console.log(`[task-17] junk marked:       ${junkMarked}`);
  console.log(`[task-17] slug+junk both:    ${bothChanges}`);
  console.log(`[task-17] audit rows:        ${auditRows.length - 1}`);
  console.log(`[task-17] report:            ${REPORT_PATH}`);
  if (DRY_RUN) console.log('[task-17] DRY RUN — no DB writes performed');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[task-17] migration failed:', err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
