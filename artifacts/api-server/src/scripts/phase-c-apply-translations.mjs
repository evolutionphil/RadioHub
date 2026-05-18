/**
 * Phase C — MongoDB apply script
 * Upserts all 57-language × 15-key translations into MongoDB.
 *
 * Run:
 *   MONGODB_URI=mongodb+srv://... node artifacts/api-server/src/scripts/phase-c-apply-translations.mjs
 *
 * Safe to re-run: skips any key that already has a non-empty value.
 */
import { createRequire } from 'module';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const mongoose = require('mongoose');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSLATIONS_PATH = path.resolve(
  __dirname,
  '../../../../../docs/seo-audit-2026-05/phase-c-translations/translations.json',
);

const MONGODB_URI =
  process.env.MONGODB_URI || process.env.DATABASE_URL || process.env.MONGO_URI || '';
if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is required.');
  console.error('Usage: MONGODB_URI=mongodb+srv://... node phase-c-apply-translations.mjs');
  process.exit(1);
}

const TKSchema = new mongoose.Schema(
  { key: String, defaultValue: String, description: String, category: String, isPlural: Boolean },
  { strict: false },
);
const TSchema = new mongoose.Schema(
  {
    keyId: mongoose.Schema.Types.ObjectId,
    language: String,
    value: String,
    isCompleted: Boolean,
    lastModified: Date,
    createdAt: Date,
  },
  { strict: false },
);

async function main() {
  console.log('Loading translations...');
  const TRANSLATIONS = JSON.parse(await fs.readFile(TRANSLATIONS_PATH, 'utf8'));
  const ALL_KEYS = Object.keys(TRANSLATIONS.en);
  const LANG_CODES = Object.keys(TRANSLATIONS);

  console.log(`  ${LANG_CODES.length} languages, ${ALL_KEYS.length} keys per language`);

  // English defaults for TranslationKey.defaultValue
  const EN = TRANSLATIONS.en;

  console.log('\nConnecting to MongoDB...');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected.\n');

  const TK =
    mongoose.models.TranslationKey ||
    mongoose.model('TranslationKey', TKSchema, 'translationkeys');
  const T =
    mongoose.models.Translation ||
    mongoose.model('Translation', TSchema, 'translations');

  // 1. Upsert TranslationKey documents (idempotent via $setOnInsert)
  console.log('Step 1: Upserting TranslationKey documents...');
  const keyIdMap = {};
  for (const key of ALL_KEYS) {
    const doc = await TK.findOneAndUpdate(
      { key },
      {
        $setOnInsert: {
          key,
          defaultValue: EN[key],
          description: '',
          category: 'seo',
          isPlural: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
    keyIdMap[key] = doc._id;
    console.log(`  ✓ ${key} → ${doc._id}`);
  }

  // 2. Upsert Translation documents — skip existing non-empty values
  console.log('\nStep 2: Upserting Translation documents...');
  let inserted = 0;
  let skipped = 0;

  for (const lang of LANG_CODES) {
    const langData = TRANSLATIONS[lang];
    for (const key of ALL_KEYS) {
      const value = langData[key];
      if (!value || !value.trim()) continue;

      const existing = await T.findOne({
        keyId: keyIdMap[key],
        language: lang,
      }).lean();

      if (existing && existing.value && existing.value.trim().length > 0) {
        skipped++;
        continue;
      }

      await T.findOneAndUpdate(
        { keyId: keyIdMap[key], language: lang },
        {
          $set: {
            keyId: keyIdMap[key],
            language: lang,
            value: value.trim(),
            isCompleted: true,
            lastModified: new Date(),
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
      inserted++;
    }
    process.stdout.write(`  ${lang} done\r`);
  }
  console.log(`\n  Inserted/updated: ${inserted} | Skipped (already present): ${skipped}`);

  // 3. Verify all languages now have all 15 keys
  console.log('\nStep 3: Verification...');
  const keyIds = Object.values(keyIdMap);
  let failures = 0;
  for (const lang of LANG_CODES) {
    const count = await T.countDocuments({
      keyId: { $in: keyIds },
      language: lang,
      value: { $exists: true, $ne: '' },
    });
    if (count < ALL_KEYS.length) {
      console.error(`  FAIL ${lang}: ${count}/${ALL_KEYS.length} keys present`);
      failures++;
    }
  }

  await mongoose.disconnect();

  if (failures === 0) {
    console.log(
      `\n✅ All ${LANG_CODES.length} languages × ${ALL_KEYS.length} keys verified in MongoDB.`,
    );
    console.log('\nNext: the qualified-languages cache will refresh within 60 minutes.');
    console.log(
      'To force immediate refresh, restart the API server or call POST /api/admin/cache/clear (if implemented).',
    );
  } else {
    console.error(`\n❌ ${failures} language(s) still incomplete — re-run this script.`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
