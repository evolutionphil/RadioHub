/**
 * Task #19: Translate the missing SEO keys for languages currently dropped
 * from the sitemap.
 *
 * `hasCompleteSeoTranslations` (shared/seo-config.ts) requires every key in
 * REQUIRED_STATION_SEO_KEYS to be present and non-empty. Five of those seven
 * keys (`from`, `station_additional_info`, `live_radio`, `online_radio`,
 * `radio_streaming`) had no TranslationKey row at all, so every language
 * (including English) was being dropped from the sitemap.
 *
 * This script:
 *   1. Upserts TranslationKey rows for all 7 REQUIRED_STATION_SEO_KEYS using
 *      sensible English defaults.
 *   2. Upserts the English Translation rows.
 *   3. For every other SEO_LANGUAGES entry, fills any missing/empty
 *      translation value via OpenAI (one batched call per language).
 *
 * Idempotent: existing non-empty translations are kept untouched.
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import mongoose, { Schema, Types } from 'mongoose';
import OpenAI from 'openai';
import {
  SEO_LANGUAGES,
  REQUIRED_STATION_SEO_KEYS,
  REQUIRED_HOMEPAGE_SEO_KEYS,
} from '../shared/seo-config';

// `hasCompleteSeoTranslations` requires the union of station + homepage keys.
// Filling only one set still leaves languages dropped from the sitemap, so we
// process both together as a single source of truth.
const ALL_REQUIRED_KEYS = [
  ...REQUIRED_STATION_SEO_KEYS,
  ...REQUIRED_HOMEPAGE_SEO_KEYS,
] as const;
type RequiredKey = (typeof ALL_REQUIRED_KEYS)[number];

interface TranslationKeyDoc {
  _id: Types.ObjectId;
  key: string;
  defaultValue: string;
  description?: string;
  category?: string;
}

interface TranslationDoc {
  _id: Types.ObjectId;
  keyId: Types.ObjectId;
  language: string;
  value: string;
  isCompleted?: boolean;
}

const REPORT_PATH = path.resolve('attached_assets/task-19-seo-translation-coverage.csv');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || '';
if (!MONGO_URI) throw new Error('MONGODB_URI is required');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// English defaults + descriptions for every required station SEO key.
// `default_station_about` and `genres` already exist in the database; we only
// upsert their TranslationKey row when missing so existing English copy wins.
const KEY_DEFAULTS: Record<RequiredKey, { defaultValue: string; description: string }> = {
  default_station_about: {
    defaultValue:
      'Enjoy listening to {STATION_NAME}! Tune into Mega Radio to stream thousands of radio stations in HD quality, online, and free of charge.',
    description: 'Base description template for a station page.',
  },
  from: {
    defaultValue: 'from',
    description: 'Connector word used in "Station X from Country Y".',
  },
  genres: {
    defaultValue: 'Genres',
    description: 'Section label listing the music genres of a station.',
  },
  station_additional_info: {
    defaultValue:
      'Listen live, anytime, anywhere — free online radio in HD quality on Mega Radio.',
    description: 'Closing call-to-action appended to station SEO copy.',
  },
  live_radio: {
    defaultValue: 'live radio',
    description: 'Intent keyword: "live radio".',
  },
  online_radio: {
    defaultValue: 'online radio',
    description: 'Intent keyword: "online radio".',
  },
  radio_streaming: {
    defaultValue: 'radio streaming',
    description: 'Intent keyword: "radio streaming".',
  },

  // Homepage SEO keys — required by hasCompleteSeoTranslations so bare
  // `/sl`, `/da`, etc. can re-enter the sitemap with localized content.
  hero_worlds_best_radio: {
    defaultValue: "The world's best radio applications",
    description: 'Homepage hero H1 / page title.',
  },
  hero_over_100_countries: {
    defaultValue: 'Over 60,000 stations from 120+ countries',
    description: 'Homepage hero subline below the H1.',
  },
  hero_listen_everywhere: {
    defaultValue: 'Listen everywhere, anytime, free',
    description: 'Homepage secondary hero line.',
  },
  nav_genres: {
    defaultValue: 'Genres',
    description: 'Top navigation label: genres.',
  },
  nav_regions: {
    defaultValue: 'Countries',
    description: 'Top navigation label: regions / countries.',
  },
  nav_stations: {
    defaultValue: 'Stations',
    description: 'Top navigation label: all stations.',
  },
  popular_genres_title: {
    defaultValue: 'Popular radio genres',
    description: 'Homepage section heading: popular genres.',
  },
  popular_countries_title: {
    defaultValue: 'Radio stations by country',
    description: 'Homepage section heading: popular countries.',
  },
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', tr: 'Turkish', es: 'Spanish', fr: 'French', de: 'German',
  ar: 'Arabic', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ru: 'Russian',
  pl: 'Polish', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish',
  el: 'Greek', hu: 'Hungarian', cs: 'Czech', sk: 'Slovak', ro: 'Romanian',
  bg: 'Bulgarian', hr: 'Croatian', sr: 'Serbian', sl: 'Slovenian',
  lv: 'Latvian', lt: 'Lithuanian', et: 'Estonian',
  zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean', hi: 'Hindi',
  th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay',
  tl: 'Filipino', he: 'Hebrew', fa: 'Persian', ur: 'Urdu', bn: 'Bengali',
  ta: 'Tamil', te: 'Telugu', mr: 'Marathi', gu: 'Gujarati', kn: 'Kannada',
  ml: 'Malayalam', pa: 'Punjabi', sw: 'Swahili', am: 'Amharic',
  zu: 'Zulu', af: 'Afrikaans', sq: 'Albanian', az: 'Azerbaijani',
  hy: 'Armenian', so: 'Somali', uk: 'Ukrainian', bs: 'Bosnian',
};

const TranslationKeySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    defaultValue: { type: String, required: true },
    description: { type: String, default: '' },
    category: { type: String, default: 'general' },
    isPlural: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { strict: false },
);

const TranslationSchema = new mongoose.Schema(
  {
    keyId: { type: mongoose.Schema.Types.ObjectId, ref: 'TranslationKey', required: true },
    language: { type: String, required: true },
    value: { type: String, required: true },
    isCompleted: { type: Boolean, default: true },
    lastModified: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { strict: false },
);

async function translateBatch(
  texts: Record<string, string>,
  targetLang: string,
): Promise<Record<string, string>> {
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;
  const prompt = `Translate the following short SEO strings for an online radio
streaming site to ${langName}. Keep them concise and natural for SEO meta
descriptions, keywords, and on-page labels. Do NOT translate the brand name
"Mega Radio" or the placeholder "{STATION_NAME}". Lower-case keyword phrases
("live radio", "online radio", "radio streaming") should stay lower-case in
the target language when grammatically appropriate. The "from" key must be the
single short connector word used in phrases like "Station X from Country Y" —
not a full sentence. Return a JSON object with the exact same keys and only
the translated string values.

${JSON.stringify(texts, null, 2)}`;

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a professional translator. Translate to ${langName}. Return only valid JSON.`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

  const content = resp.choices[0]?.message?.content;
  if (!content) throw new Error(`Empty translation response for ${targetLang}`);
  return JSON.parse(content);
}

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.\n');

  const TranslationKey = (mongoose.models.TranslationKey ||
    mongoose.model<TranslationKeyDoc>(
      'TranslationKey',
      TranslationKeySchema as Schema<TranslationKeyDoc>,
      'translationkeys',
    )) as mongoose.Model<TranslationKeyDoc>;
  const Translation = (mongoose.models.Translation ||
    mongoose.model<TranslationDoc>(
      'Translation',
      TranslationSchema as Schema<TranslationDoc>,
      'translations',
    )) as mongoose.Model<TranslationDoc>;

  // 1. Upsert TranslationKey rows for all 7 required keys.
  console.log('1. Ensuring TranslationKey rows exist...');
  const keyIdMap = {} as Record<RequiredKey, Types.ObjectId>;
  for (const key of ALL_REQUIRED_KEYS) {
    const meta = KEY_DEFAULTS[key];
    const existing = await TranslationKey.findOne({ key }).lean<TranslationKeyDoc>();
    if (existing) {
      keyIdMap[key] = existing._id;
      console.log(`   ✓ exists: ${key}`);
    } else {
      const created = await TranslationKey.create({
        key,
        defaultValue: meta.defaultValue,
        description: meta.description,
        category: 'seo',
        isPlural: false,
      });
      keyIdMap[key] = created._id;
      console.log(`   + created: ${key}`);
    }
  }

  // 2. Upsert English translations.
  console.log('\n2. Upserting English translations...');
  for (const key of ALL_REQUIRED_KEYS) {
    const existing = await Translation.findOne({
      keyId: keyIdMap[key],
      language: 'en',
    }).lean<TranslationDoc>();
    if (existing && typeof existing.value === 'string' && existing.value.trim()) {
      console.log(`   ✓ en/${key}: kept existing`);
      continue;
    }
    await Translation.findOneAndUpdate(
      { keyId: keyIdMap[key], language: 'en' },
      {
        keyId: keyIdMap[key],
        language: 'en',
        value: KEY_DEFAULTS[key].defaultValue,
        isCompleted: true,
        lastModified: new Date(),
      },
      { upsert: true, new: true },
    );
    console.log(`   + en/${key}: set default`);
  }

  // 3. Fill missing per-language translations.
  console.log('\n3. Filling missing per-language translations...');
  const targetLangs = SEO_LANGUAGES.map(l => l.code).filter(c => c !== 'en');
  const failures: Array<{ lang: string; reason: string }> = [];

  const CONCURRENCY = 5;
  for (let i = 0; i < targetLangs.length; i += CONCURRENCY) {
    const batch = targetLangs.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async lang => {
        const existing = await Translation.find({
          keyId: { $in: Object.values(keyIdMap) },
          language: lang,
        }).lean<TranslationDoc[]>();
        const haveByKeyId = new Map<string, string>();
        for (const t of existing) {
          if (typeof t.value === 'string' && t.value.trim().length > 0) {
            haveByKeyId.set(String(t.keyId), t.value);
          }
        }

        // A key needs a translation when:
        //   (a) no value exists, OR
        //   (b) the value is exactly the English default (untranslated stub
        //       left over from earlier ingestion). Genuine translations that
        //       happen to share the English form for a given language are
        //       extremely rare for these phrases.
        const missingKeys = ALL_REQUIRED_KEYS.filter(k => {
          const current = haveByKeyId.get(String(keyIdMap[k]));
          if (!current) return true;
          const englishDefault = KEY_DEFAULTS[k].defaultValue.trim().toLowerCase();
          return current.trim().toLowerCase() === englishDefault;
        });

        if (missingKeys.length === 0) {
          console.log(`   ✓ ${lang} (${LANGUAGE_NAMES[lang] || lang}) complete`);
          return;
        }

        const sourceTexts: Record<string, string> = {};
        for (const k of missingKeys) sourceTexts[k] = KEY_DEFAULTS[k].defaultValue;

        try {
          const translated = await translateBatch(sourceTexts, lang);
          let saved = 0;
          for (const k of missingKeys) {
            const value = translated[k];
            if (typeof value !== 'string' || !value.trim()) continue;
            await Translation.findOneAndUpdate(
              { keyId: keyIdMap[k], language: lang },
              {
                keyId: keyIdMap[k],
                language: lang,
                value: value.trim(),
                isCompleted: true,
                lastModified: new Date(),
              },
              { upsert: true, new: true },
            );
            saved++;
          }
          console.log(
            `   + ${lang} (${LANGUAGE_NAMES[lang] || lang}): ${saved}/${missingKeys.length} added`,
          );
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`   ✗ ${lang}: ${reason}`);
          failures.push({ lang, reason });
        }
      }),
    );
  }

  // 4. Strict full-coverage verification + CSV evidence artifact.
  console.log('\n4. Verifying coverage across all SEO_LANGUAGES x all required keys...');
  const allLangs = SEO_LANGUAGES.map(l => l.code);
  const stillMissing: Record<string, string[]> = {};
  const reportRows: string[] = ['language,' + ALL_REQUIRED_KEYS.join(',')];

  for (const lang of allLangs) {
    const trans = await Translation.find({
      keyId: { $in: Object.values(keyIdMap) },
      language: lang,
    }).lean<TranslationDoc[]>();
    const valueByKeyId = new Map<string, string>();
    for (const t of trans) {
      if (typeof t.value === 'string') valueByKeyId.set(String(t.keyId), t.value);
    }
    const cells: string[] = [lang];
    const miss: string[] = [];
    for (const k of ALL_REQUIRED_KEYS) {
      const v = valueByKeyId.get(String(keyIdMap[k])) || '';
      const ok = v.trim().length > 0;
      if (!ok) miss.push(k);
      cells.push(ok ? '1' : '0');
    }
    reportRows.push(cells.join(','));
    if (miss.length) stillMissing[lang] = miss;
  }

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, reportRows.join('\n') + '\n', 'utf8');
  console.log(`   wrote evidence artifact: ${REPORT_PATH}`);

  await mongoose.disconnect();

  const missingCount = Object.keys(stillMissing).length;
  if (missingCount === 0 && failures.length === 0) {
    console.log(
      `\n✅ All ${allLangs.length} SEO_LANGUAGES have all ${ALL_REQUIRED_KEYS.length} required station + homepage SEO keys.`,
    );
    return;
  }

  if (missingCount > 0) {
    console.error(
      `\n❌ ${missingCount} language(s) still missing required keys:\n` +
        JSON.stringify(stillMissing, null, 2),
    );
  }
  if (failures.length > 0) {
    console.error(
      `\n❌ ${failures.length} per-language translation call(s) failed:\n` +
        JSON.stringify(failures, null, 2),
    );
  }
  process.exitCode = 1;
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
