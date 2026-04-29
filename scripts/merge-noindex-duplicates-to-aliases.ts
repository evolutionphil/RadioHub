/**
 * Migration: merge `noIndex:true` station records into their canonical sibling
 * via the existing `slugAliases` 301-redirect mechanism.
 *
 * Background: stations with `noIndex:true` (set by `scripts/clean-content-quality-urls.ts`
 * or by manual admin action) currently serve **410 Gone** to bots via the
 * `sendJunkGone` path in `server/index-web.ts:769`. That correctly de-indexes
 * the duplicate but **discards link equity** from any external backlinks
 * pointing to the dup URL.
 *
 * This script promotes the dup's slug into the canonical sibling's
 * `slugAliases` array, so future requests get a **301 redirect** to the
 * canonical URL (handled by `server/seo-renderer.ts:330-385`). The dup record
 * is then deleted to avoid the noIndex+alias double-routing.
 *
 * Sibling identification rule (intentionally STRICT to avoid false merges):
 *   - same trimmed `name` (exact)
 *   - same `countryCode`
 *   - `noIndex !== true`
 *   - exactly ONE such sibling exists in the entire collection
 *
 * Implementation: a single Mongo aggregation groups every station by
 * (countryCode, name), then in-memory we look at each group with at least one
 * noIndex doc + exactly one non-noIndex doc → that's a clean dup→canonical
 * merge. ~50,000 documents → one pass, seconds rather than minutes.
 *
 * If 0 non-noIndex siblings → dup is truly junk (e.g. test feed) → leave with
 * noIndex:true, keep serving 410.
 * If 2+ non-noIndex siblings → ambiguous (multiple distinct stations share
 * same name+country) → skip and log; manual review needed.
 *
 * Idempotent: re-runs are safe — already-merged dups are gone, already-aliased
 * slugs are no-ops via $addToSet.
 *
 * Usage:
 *   tsx scripts/merge-noindex-duplicates-to-aliases.ts --dry-run
 *   tsx scripts/merge-noindex-duplicates-to-aliases.ts          (apply)
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import path from 'path';
import { Station } from '../shared/mongo-schemas';

const DRY_RUN = process.argv.includes('--dry-run');
const DEFAULT_REPORT_PATH = path.join(
  process.cwd(),
  'attached_assets',
  'noindex-dup-merge-report.csv',
);

interface MergeOptions {
  dryRun?: boolean;
  reportPath?: string;
  manageConnection?: boolean;
  log?: (msg: string) => void;
}

interface MergeResult {
  groupsTotal: number;
  candidateGroups: number;
  merged: number;
  alreadyMerged: number;
  noSibling: number;
  ambiguous: number;
  errors: number;
  reportPath: string;
  dryRun: boolean;
}

interface DocLite {
  _id: mongoose.Types.ObjectId;
  slug?: string;
  slugAliases?: string[];
  noIndex?: boolean;
}

interface Group {
  _id: { name: string; cc: string };
  docs: DocLite[];
}

function csvCell(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, "'")}"`;
}

export async function runNoindexDupMerge(
  options: MergeOptions = {},
): Promise<MergeResult> {
  const dryRun = options.dryRun ?? DRY_RUN;
  const reportPath = options.reportPath ?? DEFAULT_REPORT_PATH;
  const manageConnection = options.manageConnection ?? false;
  const log = options.log ?? ((m: string) => console.log(m));

  if (manageConnection) {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set in env');
    log(`[noindex-merge] Connecting to Mongo (dryRun=${dryRun})…`);
    await mongoose.connect(uri);
  }

  const totalNoIndex = await Station.countDocuments({ noIndex: true });
  const totalStations = await Station.countDocuments();
  log(
    `[noindex-merge] noIndex=${totalNoIndex} total=${totalStations} dryRun=${dryRun}`,
  );
  log('[noindex-merge] running aggregation (group by name+countryCode)…');

  const t0 = Date.now();

  // One-pass aggregation: group every station with non-empty name+countryCode
  // by that pair, then keep only groups containing at least one noIndex doc.
  // Each kept group has all the data we need to decide merge/skip in memory.
  const groups: Group[] = await Station.aggregate(
    [
      {
        $match: {
          name: { $type: 'string', $ne: '' },
          countryCode: { $type: 'string', $ne: '' },
          slug: { $type: 'string', $ne: '' },
        },
      },
      {
        $group: {
          _id: { name: '$name', cc: '$countryCode' },
          docs: {
            $push: {
              _id: '$_id',
              slug: '$slug',
              slugAliases: '$slugAliases',
              noIndex: '$noIndex',
            },
          },
        },
      },
      {
        // Keep only groups with >=1 noIndex doc.
        $match: {
          'docs.noIndex': true,
        },
      },
    ],
    { allowDiskUse: true },
  );

  log(
    `[noindex-merge] aggregation done in ${(Date.now() - t0) / 1000}s — candidate groups=${groups.length}`,
  );

  const auditRows: string[] = [
    [
      'dup_slug',
      'dup_id',
      'canonical_slug',
      'canonical_id',
      'name',
      'country_code',
      'action',
      'reason',
      'aliases_added',
    ]
      .map(csvCell)
      .join(','),
  ];

  let merged = 0;
  let alreadyMerged = 0;
  let noSibling = 0;
  let ambiguous = 0;
  let errors = 0;
  let processedGroups = 0;

  // BulkWrite buffers — flush every BULK_FLUSH_SIZE ops or at end.
  // Two parallel buffers: aliases (updateOne $addToSet) and deletes
  // (deleteMany), so order is preserved (aliases-first, then deletes).
  const BULK_FLUSH_SIZE = 200;
  let aliasOps: any[] = [];
  let deleteIds: mongoose.Types.ObjectId[] = [];

  const flushBulk = async () => {
    if (dryRun) {
      aliasOps = [];
      deleteIds = [];
      return;
    }
    if (aliasOps.length > 0) {
      await Station.bulkWrite(aliasOps, { ordered: false });
      aliasOps = [];
    }
    if (deleteIds.length > 0) {
      await Station.deleteMany({ _id: { $in: deleteIds } });
      deleteIds = [];
    }
  };

  for (const group of groups) {
    processedGroups++;
    if (processedGroups % 500 === 0) {
      log(
        `[noindex-merge] groups=${processedGroups}/${groups.length} merged=${merged} alreadyMerged=${alreadyMerged} noSibling=${noSibling} ambiguous=${ambiguous}`,
      );
    }

    const name = group._id.name || '';
    const cc = group._id.cc || '';
    const dups = group.docs.filter((d) => d.noIndex === true);
    const nonDups = group.docs.filter((d) => d.noIndex !== true);

    // No canonical sibling → these dups are truly junk (test feeds, song
    // titles, etc.). Leave them alone — the SSR 410 path is correct for them.
    if (nonDups.length === 0) {
      for (const d of dups) {
        noSibling++;
        auditRows.push(
          [
            d.slug || '',
            String(d._id),
            '',
            '',
            name,
            cc,
            'leave-410',
            'no-canonical-sibling',
            '',
          ]
            .map(csvCell)
            .join(','),
        );
      }
      continue;
    }

    // Multiple non-noIndex stations share the same name+country → ambiguous.
    // Could be two genuinely different stations (e.g. two "Radio Maria" in
    // Italy at different frequencies). Don't auto-merge — manual review.
    if (nonDups.length > 1) {
      const canonicalSlugs = nonDups.map((d) => d.slug || '').join('|');
      const canonicalIds = nonDups.map((d) => String(d._id)).join('|');
      for (const d of dups) {
        ambiguous++;
        auditRows.push(
          [
            d.slug || '',
            String(d._id),
            canonicalSlugs,
            canonicalIds,
            name,
            cc,
            'skip-ambiguous',
            `${nonDups.length}-canonical-siblings`,
            '',
          ]
            .map(csvCell)
            .join(','),
        );
      }
      continue;
    }

    // Exactly 1 canonical → safe to merge every dup in this group into it.
    const canonical = nonDups[0];
    const canonicalSlug = (canonical.slug || '').trim();
    if (!canonicalSlug) {
      for (const d of dups) {
        noSibling++;
        auditRows.push(
          [
            d.slug || '',
            String(d._id),
            '',
            String(canonical._id),
            name,
            cc,
            'skip',
            'canonical-has-empty-slug',
            '',
          ]
            .map(csvCell)
            .join(','),
        );
      }
      continue;
    }

    // Build the union of (dup slug + dup's existing aliases) for every dup in
    // the group. Skip the canonical's own slug (no self-aliasing) and any
    // alias already present on the canonical (no-op).
    const canonicalAliasSet = new Set<string>(
      Array.isArray(canonical.slugAliases) ? canonical.slugAliases : [],
    );
    const candidateAliases = new Set<string>();
    for (const d of dups) {
      if (d.slug) candidateAliases.add(d.slug.trim());
      if (Array.isArray(d.slugAliases)) {
        for (const a of d.slugAliases) {
          if (a && typeof a === 'string') candidateAliases.add(a.trim());
        }
      }
    }
    candidateAliases.delete(canonicalSlug);
    candidateAliases.delete('');

    const aliasesToAdd: string[] = [];
    for (const a of candidateAliases) {
      if (!canonicalAliasSet.has(a)) aliasesToAdd.push(a);
    }

    const dupIds = dups.map((d) => d._id);

    try {
      // Buffer the writes for bulk flush. Order is preserved by flushBulk:
      // aliases-first, then deletes — if delete fails, the canonical already
      // serves the 301; if alias write fails, dup is untouched.
      if (!dryRun) {
        if (aliasesToAdd.length > 0) {
          aliasOps.push({
            updateOne: {
              filter: { _id: canonical._id },
              update: { $addToSet: { slugAliases: { $each: aliasesToAdd } } },
            },
          });
        }
        if (dupIds.length > 0) {
          deleteIds.push(...dupIds);
        }
        if (aliasOps.length >= BULK_FLUSH_SIZE || deleteIds.length >= BULK_FLUSH_SIZE) {
          await flushBulk();
        }
      }

      if (aliasesToAdd.length === 0) {
        // Canonical already has every alias we'd push — just delete orphan dups.
        for (const d of dups) {
          alreadyMerged++;
          auditRows.push(
            [
              d.slug || '',
              String(d._id),
              canonicalSlug,
              String(canonical._id),
              name,
              cc,
              'delete-orphan',
              'aliases-already-present',
              '',
            ]
              .map(csvCell)
              .join(','),
          );
        }
      } else {
        for (const d of dups) {
          merged++;
          auditRows.push(
            [
              d.slug || '',
              String(d._id),
              canonicalSlug,
              String(canonical._id),
              name,
              cc,
              'merge-into-canonical',
              'noindex-dup-with-1-sibling',
              aliasesToAdd.join('|'),
            ]
              .map(csvCell)
              .join(','),
          );
        }
      }
    } catch (err: any) {
      errors++;
      log(
        `[noindex-merge] ERR group name='${name}' cc='${cc}': ${err?.message || err}`,
      );
      for (const d of dups) {
        auditRows.push(
          [
            d.slug || '',
            String(d._id),
            canonicalSlug,
            String(canonical._id),
            name,
            cc,
            'error',
            (err?.message || String(err)).slice(0, 200),
            '',
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
  }

  // Flush any leftover writes from the last partial batch.
  await flushBulk();

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, auditRows.join('\n'), 'utf8');

  log('[noindex-merge] ──────────── summary ────────────');
  log(`[noindex-merge] candidate groups:  ${groups.length}`);
  log(`[noindex-merge] merged dups:       ${merged}`);
  log(`[noindex-merge] already-merged:    ${alreadyMerged}`);
  log(`[noindex-merge] no-sibling (410):  ${noSibling}`);
  log(`[noindex-merge] ambiguous (skip):  ${ambiguous}`);
  log(`[noindex-merge] errors:            ${errors}`);
  log(`[noindex-merge] report:            ${reportPath}`);
  log(`[noindex-merge] elapsed:           ${(Date.now() - t0) / 1000}s`);
  if (dryRun) log('[noindex-merge] DRY RUN — no DB writes performed');

  if (manageConnection) {
    await mongoose.disconnect();
  }

  return {
    groupsTotal: groups.length,
    candidateGroups: groups.length,
    merged,
    alreadyMerged,
    noSibling,
    ambiguous,
    errors,
    reportPath,
    dryRun,
  };
}

const isDirectInvocation =
  !!process.argv[1] &&
  process.argv[1].endsWith('merge-noindex-duplicates-to-aliases.ts');

if (isDirectInvocation) {
  runNoindexDupMerge({ manageConnection: true })
    .catch(async (err) => {
      console.error('[noindex-merge] migration failed:', err);
      try {
        await mongoose.disconnect();
      } catch {}
      process.exit(1);
    });
}
