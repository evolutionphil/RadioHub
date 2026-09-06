/**
 * Phase C — Translation Completion (offline mode)
 *
 * Generates translations for all 57 SEO_LANGUAGES × 15 required keys using
 * gpt-4o-mini, then writes:
 *   1. docs/seo-audit-2026-05/phase-c-translations/translations.json
 *   2. docs/seo-audit-2026-05/phase-c-translations/mongodb-seed.js  (mongosh script)
 *
 * Run:
 *   OPENAI_API_KEY=sk-... node artifacts/api-server/src/scripts/phase-c-generate-translations.mjs
 *
 * MongoDB apply (after providing URI):
 *   MONGODB_URI=mongodb+srv://... node artifacts/api-server/src/scripts/phase-c-apply-translations.mjs
 */

import { createRequire } from 'module';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const OpenAI = require('openai').default || require('openai');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const OUT_DIR = path.join(REPO_ROOT, 'docs/seo-audit-2026-05/phase-c-translations');

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── English source values ────────────────────────────────────────────────────
const KEY_DEFAULTS = {
  // REQUIRED_STATION_SEO_KEYS (7)
  default_station_about:
    'Enjoy listening to {STATION_NAME}! Tune into Mega Radio to stream thousands of radio stations in HD quality, online, and free of charge.',
  from: 'from',
  genres: 'Genres',
  station_additional_info:
    'Listen live, anytime, anywhere — free online radio in HD quality on Mega Radio.',
  live_radio: 'live radio',
  online_radio: 'online radio',
  radio_streaming: 'radio streaming',
  // REQUIRED_HOMEPAGE_SEO_KEYS (8)
  hero_worlds_best_radio: "The world's best radio applications",
  hero_over_100_countries: 'Over 60,000 stations from 120+ countries',
  hero_listen_everywhere: 'Listen everywhere, anytime, free',
  nav_genres: 'Genres',
  nav_regions: 'Countries',
  nav_stations: 'Stations',
  popular_genres_title: 'Popular radio genres',
  popular_countries_title: 'Radio stations by country',
};

const ALL_KEYS = Object.keys(KEY_DEFAULTS);

// ── All 57 SEO languages ─────────────────────────────────────────────────────
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'tr', name: 'Turkish' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ar', name: 'Arabic' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'ru', name: 'Russian' },
  { code: 'pl', name: 'Polish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'el', name: 'Greek' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'cs', name: 'Czech' },
  { code: 'sk', name: 'Slovak' },
  { code: 'ro', name: 'Romanian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'hr', name: 'Croatian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'et', name: 'Estonian' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'tl', name: 'Filipino' },
  { code: 'he', name: 'Hebrew' },
  { code: 'fa', name: 'Persian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'mr', name: 'Marathi' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'sw', name: 'Swahili' },
  { code: 'am', name: 'Amharic' },
  { code: 'zu', name: 'Zulu' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'sq', name: 'Albanian' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'hy', name: 'Armenian' },
  { code: 'so', name: 'Somali' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'bs', name: 'Bosnian' },
];

async function translateBatch(texts, targetLangName) {
  const prompt = `Translate the following short SEO strings for an online radio streaming site to ${targetLangName}. Keep them concise and natural for SEO meta descriptions, keywords, and on-page labels. Do NOT translate the brand name "Mega Radio" or the placeholder "{STATION_NAME}". Lower-case keyword phrases ("live radio", "online radio", "radio streaming") should stay lower-case in the target language when grammatically appropriate. The "from" key must be the single short connector word used in phrases like "Station X from Country Y" — not a full sentence. Return a JSON object with the exact same keys and only the translated string values.

${JSON.stringify(texts, null, 2)}`;

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a professional translator. Translate to ${targetLangName}. Return only valid JSON.`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

  const content = resp.choices[0]?.message?.content;
  if (!content) throw new Error(`Empty response for ${targetLangName}`);
  return JSON.parse(content);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // Result map: { [langCode]: { [key]: translatedValue } }
  const result = {};
  const failures = [];

  // English is source — no API call needed
  result['en'] = { ...KEY_DEFAULTS };
  console.log('✓ en (English): source values set');

  const nonEnglish = LANGUAGES.filter(l => l.code !== 'en');

  // Process in batches of 5 concurrent languages
  const CONCURRENCY = 5;
  for (let i = 0; i < nonEnglish.length; i += CONCURRENCY) {
    const batch = nonEnglish.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ code, name }) => {
        try {
          const translated = await translateBatch(KEY_DEFAULTS, name);
          // Validate all keys present
          const missing = ALL_KEYS.filter(k => !translated[k] || !translated[k].trim());
          if (missing.length > 0) {
            console.warn(`  ⚠ ${code} (${name}): missing keys ${missing.join(', ')}, using English fallback`);
            for (const k of missing) translated[k] = KEY_DEFAULTS[k];
          }
          result[code] = translated;
          console.log(`✓ ${code} (${name})`);
        } catch (err) {
          console.error(`✗ ${code} (${name}): ${err.message}`);
          failures.push({ code, name, error: err.message });
          // Fall back to English for failed languages so seed script still works
          result[code] = { ...KEY_DEFAULTS };
        }
      }),
    );
  }

  // ── Write translations.json ──────────────────────────────────────────────
  const outJson = path.join(OUT_DIR, 'translations.json');
  await fs.writeFile(outJson, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\nWrote ${outJson}`);

  // ── Write coverage summary ───────────────────────────────────────────────
  const csvRows = ['language,' + ALL_KEYS.join(',')];
  for (const { code } of LANGUAGES) {
    const langData = result[code] || {};
    const row = [code, ...ALL_KEYS.map(k => (langData[k] ? '1' : '0'))].join(',');
    csvRows.push(row);
  }
  const csvPath = path.join(OUT_DIR, 'coverage.csv');
  await fs.writeFile(csvPath, csvRows.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${csvPath}`);

  // ── Write MongoDB seed script (mongosh-compatible) ───────────────────────
  const seedLines = [
    '// Phase C — MongoDB seed script',
    '// Run with: mongosh "$MONGODB_URI" phase-c-mongodb-seed.js',
    '// Idempotent: upserts only, preserves existing non-empty translations.',
    '',
    `const ALL_KEYS = ${JSON.stringify(ALL_KEYS, null, 2)};`,
    '',
    `const KEY_DEFAULTS = ${JSON.stringify(KEY_DEFAULTS, null, 2)};`,
    '',
    `const TRANSLATIONS = ${JSON.stringify(result, null, 2)};`,
    '',
    '// 1. Upsert TranslationKey documents',
    'print("Step 1: Upserting TranslationKey documents...");',
    'for (const key of ALL_KEYS) {',
    '  const res = db.translationkeys.updateOne(',
    '    { key: key },',
    '    { $setOnInsert: { key, defaultValue: KEY_DEFAULTS[key], description: "", category: "seo", isPlural: false, createdAt: new Date(), updatedAt: new Date() } },',
    '    { upsert: true }',
    '  );',
    '  if (res.upsertedCount > 0) print("  + created TranslationKey: " + key);',
    '  else print("  ✓ exists: " + key);',
    '}',
    '',
    '// 2. Build keyId map',
    'print("\\nStep 2: Building keyId map...");',
    'const keyIdMap = {};',
    'for (const key of ALL_KEYS) {',
    '  const doc = db.translationkeys.findOne({ key });',
    '  if (!doc) { print("ERROR: missing TranslationKey for " + key); quit(1); }',
    '  keyIdMap[key] = doc._id;',
    '}',
    '',
    '// 3. Upsert Translation documents',
    'print("\\nStep 3: Upserting Translation documents...");',
    'let inserted = 0, skipped = 0;',
    'for (const [langCode, keyValues] of Object.entries(TRANSLATIONS)) {',
    '  for (const [key, value] of Object.entries(keyValues)) {',
    '    const existing = db.translations.findOne({ keyId: keyIdMap[key], language: langCode });',
    '    if (existing && existing.value && existing.value.trim().length > 0) {',
    '      skipped++;',
    '      continue;',
    '    }',
    '    db.translations.updateOne(',
    '      { keyId: keyIdMap[key], language: langCode },',
    '      { $set: { keyId: keyIdMap[key], language: langCode, value: String(value).trim(), isCompleted: true, lastModified: new Date(), createdAt: new Date() } },',
    '      { upsert: true }',
    '    );',
    '    inserted++;',
    '  }',
    '}',
    'print("  inserted/updated: " + inserted + ", skipped (already present): " + skipped);',
    '',
    '// 4. Verify all languages now have all 15 keys',
    'print("\\nStep 4: Verification...");',
    'let allPass = true;',
    'for (const langCode of Object.keys(TRANSLATIONS)) {',
    '  const count = db.translations.countDocuments({',
    '    keyId: { $in: Object.values(keyIdMap) },',
    '    language: langCode,',
    '    value: { $exists: true, $ne: "" }',
    '  });',
    '  if (count < ALL_KEYS.length) {',
    '    print("  FAIL " + langCode + ": only " + count + "/" + ALL_KEYS.length + " keys");',
    '    allPass = false;',
    '  }',
    '}',
    'if (allPass) print("\\n✅ All " + Object.keys(TRANSLATIONS).length + " languages have all " + ALL_KEYS.length + " required keys.");',
    'else print("\\n⚠ Some languages still incomplete — re-run the script.");',
  ];

  const seedPath = path.join(OUT_DIR, 'phase-c-mongodb-seed.js');
  await fs.writeFile(seedPath, seedLines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${seedPath}`);

  // ── Write apply script (Node.js with mongoose) ───────────────────────────
  const applyScript = `/**
 * Phase C — MongoDB apply script (Node.js / Mongoose)
 * Run: MONGODB_URI=mongodb+srv://... node phase-c-apply-translations.mjs
 */
import { createRequire } from 'module';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const mongoose = require('mongoose');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSLATIONS_PATH = path.join(__dirname, '../../../../../docs/seo-audit-2026-05/phase-c-translations/translations.json');

const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL || '';
if (!MONGODB_URI) throw new Error('MONGODB_URI env var required');

const ALL_KEYS = ${JSON.stringify(ALL_KEYS)};
const KEY_DEFAULTS = ${JSON.stringify(KEY_DEFAULTS, null, 2)};

const TKSchema = new mongoose.Schema({ key: String, defaultValue: String, description: String, category: String, isPlural: Boolean }, { strict: false });
const TSchema = new mongoose.Schema({ keyId: mongoose.Schema.Types.ObjectId, language: String, value: String, isCompleted: Boolean, lastModified: Date, createdAt: Date }, { strict: false });

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const TK = mongoose.models.TranslationKey || mongoose.model('TranslationKey', TKSchema, 'translationkeys');
  const T = mongoose.models.Translation || mongoose.model('Translation', TSchema, 'translations');

  // Load generated translations
  const translations = JSON.parse(await fs.readFile(TRANSLATIONS_PATH, 'utf8'));

  // 1. Upsert TranslationKey rows
  console.log('\\n1. Upserting TranslationKey documents...');
  const keyIdMap = {};
  for (const key of ALL_KEYS) {
    const doc = await TK.findOneAndUpdate(
      { key },
      { $setOnInsert: { key, defaultValue: KEY_DEFAULTS[key], description: '', category: 'seo', isPlural: false, createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true, new: true }
    );
    keyIdMap[key] = doc._id;
    console.log('  ✓ ' + key + ' -> ' + doc._id);
  }

  // 2. Upsert Translation rows
  console.log('\\n2. Upserting Translation documents...');
  let inserted = 0, skipped = 0;
  for (const [lang, keyValues] of Object.entries(translations)) {
    for (const [key, value] of Object.entries(keyValues)) {
      const existing = await T.findOne({ keyId: keyIdMap[key], language: lang }).lean();
      if (existing && existing.value && existing.value.trim()) { skipped++; continue; }
      await T.findOneAndUpdate(
        { keyId: keyIdMap[key], language: lang },
        { $set: { keyId: keyIdMap[key], language: lang, value: String(value).trim(), isCompleted: true, lastModified: new Date(), createdAt: new Date() } },
        { upsert: true }
      );
      inserted++;
    }
  }
  console.log('  inserted/updated:', inserted, '| skipped:', skipped);

  // 3. Verify
  console.log('\\n3. Verifying...');
  const langs = Object.keys(translations);
  let fails = 0;
  for (const lang of langs) {
    const count = await T.countDocuments({ keyId: { $in: Object.values(keyIdMap) }, language: lang, value: { $exists: true, $ne: '' } });
    if (count < ALL_KEYS.length) { console.error('  FAIL', lang, count + '/' + ALL_KEYS.length); fails++; }
  }
  if (fails === 0) console.log('\\n✅ All ' + langs.length + ' languages × ' + ALL_KEYS.length + ' keys verified in MongoDB.');
  else console.error('\\n❌ ' + fails + ' language(s) incomplete.');

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
`;

  const applyPath = path.join(
    __dirname,
    '../../scripts/phase-c-apply-translations.mjs',
  );
  await fs.writeFile(applyPath, applyScript, 'utf8');
  console.log(`Wrote apply script: ${applyPath}`);

  // ── Summary ──────────────────────────────────────────────────────────────
  const successCount = LANGUAGES.length - failures.length;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Phase C Translation Generation Complete`);
  console.log(`  Languages translated: ${successCount}/${LANGUAGES.length}`);
  console.log(`  Keys per language: ${ALL_KEYS.length}`);
  console.log(`  Total translations: ${successCount * ALL_KEYS.length}`);
  if (failures.length > 0) {
    console.log(`  Failures (fell back to English): ${failures.map(f => f.code).join(', ')}`);
  }
  console.log(`\nNext step: set MONGODB_URI and run phase-c-apply-translations.mjs`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
