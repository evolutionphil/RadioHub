/**
 * Strict, full-coverage verifier for Task #19.
 *
 * For every code in SEO_LANGUAGES, asserts that every key in the union of
 * REQUIRED_STATION_SEO_KEYS + REQUIRED_HOMEPAGE_SEO_KEYS (i.e. exactly what
 * `hasCompleteSeoTranslations` enforces) has a non-empty Translation row.
 * Writes a CSV evidence artifact and exits non-zero if any cell is missing.
 *
 * Usage: npx tsx scripts/verify-seo-translations.ts
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import mongoose, { Schema, Types } from 'mongoose';
import {
  SEO_LANGUAGES,
  REQUIRED_STATION_SEO_KEYS,
  REQUIRED_HOMEPAGE_SEO_KEYS,
} from '../shared/seo-config';

const ALL_REQUIRED_KEYS = [
  ...REQUIRED_STATION_SEO_KEYS,
  ...REQUIRED_HOMEPAGE_SEO_KEYS,
] as const;

interface TranslationKeyDoc {
  _id: Types.ObjectId;
  key: string;
}
interface TranslationDoc {
  _id: Types.ObjectId;
  keyId: Types.ObjectId;
  language: string;
  value: string;
}

const REPORT_PATH = path.resolve('attached_assets/task-19-seo-translation-coverage.csv');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri);

  const TK = mongoose.model<TranslationKeyDoc>(
    'TranslationKey',
    new Schema({}, { strict: false }) as Schema<TranslationKeyDoc>,
    'translationkeys',
  );
  const T = mongoose.model<TranslationDoc>(
    'Translation',
    new Schema({}, { strict: false }) as Schema<TranslationDoc>,
    'translations',
  );

  const keys = await TK.find({
    key: { $in: [...ALL_REQUIRED_KEYS] },
  }).lean<TranslationKeyDoc[]>();
  const keyByName = new Map(keys.map(k => [k.key, k]));

  const missingKeys = ALL_REQUIRED_KEYS.filter(k => !keyByName.has(k));
  if (missingKeys.length) {
    console.error(`❌ Missing TranslationKey rows: ${missingKeys.join(', ')}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const keyIds = keys.map(k => k._id);

  const allLangs = SEO_LANGUAGES.map(l => l.code);
  const stillMissing: Record<string, string[]> = {};
  const reportRows: string[] = ['language,' + ALL_REQUIRED_KEYS.join(',')];

  for (const lang of allLangs) {
    const trans = await T.find({ keyId: { $in: keyIds }, language: lang }).lean<TranslationDoc[]>();
    const valueByKeyId = new Map<string, string>();
    for (const t of trans) {
      if (typeof t.value === 'string') valueByKeyId.set(String(t.keyId), t.value);
    }
    const cells: string[] = [lang];
    const miss: string[] = [];
    for (const k of ALL_REQUIRED_KEYS) {
      const tk = keyByName.get(k)!;
      const v = valueByKeyId.get(String(tk._id)) || '';
      const ok = v.trim().length > 0;
      if (!ok) miss.push(k);
      cells.push(ok ? '1' : '0');
    }
    reportRows.push(cells.join(','));
    if (miss.length) stillMissing[lang] = miss;
  }

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, reportRows.join('\n') + '\n', 'utf8');
  console.log(`Wrote coverage report: ${REPORT_PATH}`);

  await mongoose.disconnect();

  if (Object.keys(stillMissing).length === 0) {
    console.log(
      `✅ All ${allLangs.length} SEO_LANGUAGES have all ${ALL_REQUIRED_KEYS.length} required SEO keys.`,
    );
    return;
  }

  console.error(`❌ Missing required SEO keys:`);
  console.error(JSON.stringify(stillMissing, null, 2));
  process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
