/**
 * 51-URL audit for Bing's NotIndexedAndMayNeedAttention/ContentQuality report.
 *
 * Reads a list of URLs (one per line) from
 *   attached_assets/bing-content-quality-urls.txt
 * and writes a deterministic per-URL status report to
 *   attached_assets/task-17-51url-status.csv
 *
 * For each URL the script reports the post-change status:
 *   - indexable      → SSR will render with robots=index,follow
 *   - noindex        → station is junk, language not eligible, or thin content
 *   - 301:<target>   → URL hits a slugAlias and will redirect to canonical
 *   - removed:404    → station no longer exists (will return HTTP 404)
 *   - homepage-thin  → bare /xx language home with incomplete translations
 *
 * Usage:
 *   tsx scripts/audit-51-urls.ts
 *   tsx scripts/audit-51-urls.ts path/to/custom-list.txt
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { Station } from '../shared/mongo-schemas';
import {
  evaluateJunkStation,
  isLanguageEligibleForStation,
} from '../server/seo/junk-station-rules';
import { hasCompleteSeoTranslations, SEO_LANGUAGES } from '../shared/seo-config';

const INPUT_PATH =
  process.argv[2] || path.resolve('attached_assets/bing-content-quality-urls.txt');
const OUTPUT_PATH = path.resolve('attached_assets/task-17-51url-status.csv');

const VALID_LANGS = new Set(SEO_LANGUAGES.map((l: any) => l.code));

interface Parsed {
  raw: string;
  language: string | null;
  segment: string | null;
  stationSlug: string | null;
}

function parseUrl(raw: string): Parsed {
  try {
    const u = new URL(raw.trim());
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return { raw, language: null, segment: null, stationSlug: null };
    const language = VALID_LANGS.has(parts[0]) ? parts[0] : null;
    const segment = parts[1] || null;
    const stationSlug = parts[2] || null;
    return { raw, language, segment, stationSlug };
  } catch {
    return { raw, language: null, segment: null, stationSlug: null };
  }
}

async function loadTranslationsForLang(lang: string): Promise<Record<string, string>> {
  // Best-effort: fetch translations for this language from the Translation
  // collection. The schema isn't imported here to keep this script standalone;
  // fall back to empty if anything fails so the audit still produces output.
  try {
    const TranslationModel: any =
      mongoose.models.Translation ||
      mongoose.model('Translation', new mongoose.Schema({}, { strict: false }), 'translations');
    const docs = await TranslationModel.find({ language: lang }).lean();
    const out: Record<string, string> = {};
    for (const d of docs as any[]) {
      if (d.key && typeof d.value === 'string') out[d.key] = d.value;
    }
    return out;
  } catch {
    return {};
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is required');

  let raw: string;
  try {
    raw = await fs.readFile(INPUT_PATH, 'utf8');
  } catch {
    console.error(
      `Input file not found: ${INPUT_PATH}\n` +
        `Add one URL per line (the 51 URLs from Bing Webmaster's ContentQuality export) and re-run.`,
    );
    process.exit(2);
  }
  const urls = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  await mongoose.connect(mongoUri);

  const translationCache = new Map<string, Record<string, string>>();
  const rows: string[] = ['url,language,segment,slug,status,canonical_or_reason'];

  for (const u of urls) {
    const p = parseUrl(u);

    if (!p.language) {
      rows.push(`${csv(u)},,,,invalid-url,unparseable`);
      continue;
    }

    // Bare language home or short path = check translation completeness.
    if (!p.stationSlug) {
      let trans = translationCache.get(p.language);
      if (!trans) {
        trans = await loadTranslationsForLang(p.language);
        translationCache.set(p.language, trans);
      }
      const ok = hasCompleteSeoTranslations(trans);
      rows.push(
        `${csv(u)},${p.language},${p.segment ?? ''},,${ok ? 'indexable' : 'homepage-thin'},${ok ? '' : 'missing required translation keys'}`,
      );
      continue;
    }

    // Station URL — look up by canonical slug, then by alias.
    const stationData: any = await Station.findOne({ slug: p.stationSlug }).lean();
    if (!stationData) {
      const alias: any = await Station.findOne({ slugAliases: p.stationSlug }).lean();
      if (alias) {
        const target = u.replace(`/${p.stationSlug}`, `/${alias.slug}`);
        rows.push(`${csv(u)},${p.language},${p.segment ?? ''},${p.stationSlug},301,${csv(target)}`);
        continue;
      }
      rows.push(`${csv(u)},${p.language},${p.segment ?? ''},${p.stationSlug},removed:404,station not found`);
      continue;
    }

    if (stationData.noIndex) {
      rows.push(`${csv(u)},${p.language},${p.segment ?? ''},${p.stationSlug},noindex,station marked noIndex`);
      continue;
    }

    const verdict = evaluateJunkStation(stationData);
    if (verdict.isJunk) {
      rows.push(`${csv(u)},${p.language},${p.segment ?? ''},${p.stationSlug},noindex,junk:${verdict.reason}`);
      continue;
    }

    if (!isLanguageEligibleForStation(stationData, p.language)) {
      rows.push(
        `${csv(u)},${p.language},${p.segment ?? ''},${p.stationSlug},noindex,language not eligible for station`,
      );
      continue;
    }

    rows.push(`${csv(u)},${p.language},${p.segment ?? ''},${p.stationSlug},indexable,`);
  }

  await fs.writeFile(OUTPUT_PATH, rows.join('\n') + '\n', 'utf8');
  console.log(`✅ Wrote ${rows.length - 1} rows to ${OUTPUT_PATH}`);

  await mongoose.disconnect();
}

function csv(v: string): string {
  if (v.includes(',') || v.includes('"')) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
