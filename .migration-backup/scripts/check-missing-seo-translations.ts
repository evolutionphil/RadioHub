/**
 * Read-only audit: which SEO_LANGUAGES are missing any of the
 * REQUIRED_STATION_SEO_KEYS in the Translation collection.
 *
 * Single source of truth: `shared/seo-config.ts`.
 *
 * Usage: npx tsx scripts/check-missing-seo-translations.ts
 */

import 'dotenv/config';
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
  defaultValue?: string;
}

interface TranslationDoc {
  _id: Types.ObjectId;
  keyId: Types.ObjectId;
  language: string;
  value: string;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
  if (!uri) throw new Error('MONGODB_URI required');
  await mongoose.connect(uri);

  const TranslationKey = mongoose.model<TranslationKeyDoc>(
    'TranslationKey',
    new Schema({}, { strict: false }) as Schema<TranslationKeyDoc>,
    'translationkeys',
  );
  const Translation = mongoose.model<TranslationDoc>(
    'Translation',
    new Schema({}, { strict: false }) as Schema<TranslationDoc>,
    'translations',
  );

  const keys = await TranslationKey.find({
    key: { $in: [...ALL_REQUIRED_KEYS] },
  }).lean<TranslationKeyDoc[]>();

  console.log('Found TranslationKey rows:');
  for (const k of keys) console.log(`  ${k.key}: "${k.defaultValue ?? ''}"`);

  const missingKeys = ALL_REQUIRED_KEYS.filter(r => !keys.find(k => k.key === r));
  if (missingKeys.length) console.log('Missing TranslationKey entries:', missingKeys);

  const keyIds = keys.map(k => k._id);
  const missing: Record<string, string[]> = {};
  for (const lang of SEO_LANGUAGES.map(l => l.code)) {
    const trans = await Translation.find({ keyId: { $in: keyIds }, language: lang })
      .lean<TranslationDoc[]>();
    const have = new Set(
      trans
        .filter(t => typeof t.value === 'string' && t.value.trim().length > 0)
        .map(t => String(t.keyId)),
    );
    const miss = keys.filter(k => !have.has(String(k._id))).map(k => k.key);
    if (miss.length) missing[lang] = miss;
  }
  console.log('\nMissing per language:');
  console.log(JSON.stringify(missing, null, 2));
  console.log('\nLanguages missing >=1 key:', Object.keys(missing).length);

  await mongoose.disconnect();
  if (Object.keys(missing).length || missingKeys.length) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
