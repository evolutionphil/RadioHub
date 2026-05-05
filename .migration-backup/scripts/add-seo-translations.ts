import 'dotenv/config';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import { SEO_LANGUAGES } from '../shared/seo-config';

// --- Process hardening: keep stdout/stderr unbuffered when piped to a file,
// and turn unhandled errors into a non-zero exit (so partial runs cannot be
// reported as success). ---
type WritableHandle = { setBlocking?: (value: boolean) => void };
type WithHandle = { _handle?: WritableHandle };
function setBlocking(stream: NodeJS.WriteStream): void {
  const handle = (stream as unknown as WithHandle)._handle;
  handle?.setBlocking?.(true);
}
setBlocking(process.stdout);
setBlocking(process.stderr);

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || '';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000 });

interface SeoKey {
  key: string;
  defaultValue: string;
  description: string;
  category: string;
  /** Strict character-length window. Required for meta-description keys. */
  lengthTarget?: { min: number; max: number };
}

// All meta-description keys must satisfy the same Bing target window.
const DESC_RANGE = { min: 150, max: 160 } as const;

const SEO_TRANSLATION_KEYS: SeoKey[] = [
  {
    key: 'search_page_title',
    defaultValue: 'Search Radio Stations — Find Live Radio by Name, Genre or Country | Mega Radio',
    description: 'Search page <title> tag',
    category: 'seo',
  },
  {
    key: 'search_page_description',
    defaultValue: 'Search 60,000+ live radio stations from 120+ countries on Mega Radio. Find your favourite station by name, genre, language, or country and listen free online.',
    description: 'Search page meta description (150-160 chars)',
    category: 'seo',
    lengthTarget: { ...DESC_RANGE },
  },
  {
    key: 'search_page_h1',
    defaultValue: 'Search Live Radio Stations',
    description: 'Search page H1 heading',
    category: 'seo',
  },
  {
    key: 'search_page_intro',
    defaultValue: "Search Mega Radio's catalogue of 60,000+ live radio stations from 120+ countries. Type a station name, music genre, language, or country to start streaming free online radio instantly.",
    description: 'Search page intro paragraph (SSR body)',
    category: 'seo',
  },
  {
    key: 'faq_page_title',
    defaultValue: 'Radio Streaming FAQ — Common Questions about Online Radio | Mega Radio',
    description: 'FAQ page <title> tag',
    category: 'seo',
  },
  {
    key: 'faq_page_description',
    defaultValue: 'Frequently asked questions about Mega Radio: how to listen to online radio, supported devices, free streaming, mobile apps, station coverage, and account help.',
    description: 'FAQ page meta description (150-160 chars)',
    category: 'seo',
    lengthTarget: { ...DESC_RANGE },
  },
  {
    key: 'faq_page_h1',
    defaultValue: 'Mega Radio Frequently Asked Questions',
    description: 'FAQ page H1 heading',
    category: 'seo',
  },
  {
    key: 'faq_page_intro',
    defaultValue: 'Answers to common questions about Mega Radio: how online radio streaming works, supported devices, free access, mobile apps, station coverage across 120+ countries, and account help.',
    description: 'FAQ page intro paragraph (SSR body)',
    category: 'seo',
  },
  {
    key: 'home_page_description',
    defaultValue: 'Listen to 60,000+ free live radio stations from 120+ countries on Mega Radio. Stream music, news, sports and talk radio on any device, anywhere today.',
    description: 'Home page meta description (150-160 chars)',
    category: 'seo',
    lengthTarget: { ...DESC_RANGE },
  },
  {
    key: 'about_page_description',
    defaultValue: 'Learn about Mega Radio, the free online radio service offering 60,000+ live stations from 120+ countries with full multilingual support around the world.',
    description: 'About page meta description (150-160 chars)',
    category: 'seo',
    lengthTarget: { ...DESC_RANGE },
  },
  {
    key: 'contact_page_description',
    defaultValue: 'Contact the Mega Radio team for support, feedback, partnership inquiries, or station submissions. We are here to help with your free radio streaming experience.',
    description: 'Contact page meta description (150-160 chars)',
    category: 'seo',
    lengthTarget: { ...DESC_RANGE },
  },
  {
    key: 'privacy_page_description',
    defaultValue: 'Read the Mega Radio privacy policy to see how we collect, use and protect your personal data while you stream 60,000+ free live radio stations online.',
    description: 'Privacy page meta description (150-160 chars)',
    category: 'seo',
    lengthTarget: { ...DESC_RANGE },
  },
  {
    key: 'terms_page_description',
    defaultValue: 'Read the Mega Radio Terms and Conditions covering service use, account rules, intellectual property and listener responsibilities for online streaming.',
    description: 'Terms page meta description (150-160 chars)',
    category: 'seo',
    lengthTarget: { ...DESC_RANGE },
  },
  {
    key: 'general_page_description',
    defaultValue: 'Listen to 60,000+ free online radio stations from 120+ countries on Mega Radio. Stream live music, news, sports and talk radio anywhere on desktop or mobile.',
    description: 'Default/general page meta description fallback (150-160 chars)',
    category: 'seo',
    lengthTarget: { ...DESC_RANGE },
  },
  { key: 'free_streaming', defaultValue: 'Free live streaming', description: 'Station fallback fragment: "Free live streaming"', category: 'seo' },
  { key: 'on_mega_radio', defaultValue: 'on Mega Radio', description: 'Station fallback fragment: "on Mega Radio"', category: 'seo' },
  { key: 'desktop_and_mobile', defaultValue: 'desktop and mobile', description: 'Station fallback fragment: "desktop and mobile"', category: 'seo' },
  { key: 'online', defaultValue: 'online', description: 'Single-word fragment used in station meta', category: 'seo' },
  { key: 'nav_genres', defaultValue: 'Radio Genres', description: 'SSR nav link label: Genres', category: 'navigation' },
  { key: 'nav_regions', defaultValue: 'Radio by Country', description: 'SSR nav link label: Regions/Countries', category: 'navigation' },
  { key: 'nav_stations', defaultValue: 'All Stations', description: 'SSR nav link label: Stations', category: 'navigation' },
  { key: 'nav_home', defaultValue: 'Home', description: 'SSR nav link label: Home', category: 'navigation' },
  { key: 'nav_about', defaultValue: 'About Us', description: 'SSR nav link label: About', category: 'navigation' },
  { key: 'nav_contact', defaultValue: 'Contact', description: 'SSR nav link label: Contact', category: 'navigation' },
];

// Source non-English language codes from shared/seo-config.ts so this script
// stays in sync if SEO_LANGUAGES changes.
const LANGUAGES = SEO_LANGUAGES
  .filter((l) => l.enabled && l.code !== 'en')
  .map((l) => l.code);

const LANGUAGE_NAMES: Record<string, string> = {
  tr: 'Turkish', es: 'Spanish', fr: 'French', de: 'German', ar: 'Arabic',
  it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', pl: 'Polish',
  sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', el: 'Greek',
  hu: 'Hungarian', cs: 'Czech', sk: 'Slovak', ro: 'Romanian', bg: 'Bulgarian',
  hr: 'Croatian', sr: 'Serbian', sl: 'Slovenian', lv: 'Latvian', lt: 'Lithuanian',
  et: 'Estonian', zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean', hi: 'Hindi',
  th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', tl: 'Filipino',
  he: 'Hebrew', fa: 'Persian', ur: 'Urdu', bn: 'Bengali', ta: 'Tamil',
  te: 'Telugu', mr: 'Marathi', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam',
  pa: 'Punjabi', sw: 'Swahili', am: 'Amharic', zu: 'Zulu', af: 'Afrikaans',
  sq: 'Albanian', az: 'Azerbaijani', hy: 'Armenian', so: 'Somali', uk: 'Ukrainian', bs: 'Bosnian',
};

interface ITranslationKeyDoc extends mongoose.Document {
  key: string;
  defaultValue: string;
  description: string;
  category: string;
  isPlural: boolean;
}
interface ITranslationDoc extends mongoose.Document {
  keyId: mongoose.Types.ObjectId;
  language: string;
  value: string;
  isCompleted: boolean;
  lastModified: Date;
}

const TranslationKeySchema = new mongoose.Schema<ITranslationKeyDoc>({
  key: { type: String, required: true, unique: true },
  defaultValue: { type: String, required: true },
  description: { type: String, default: '' },
  category: { type: String, default: 'general' },
  isPlural: { type: Boolean, default: false },
});

const TranslationSchema = new mongoose.Schema<ITranslationDoc>({
  keyId: { type: mongoose.Schema.Types.ObjectId, ref: 'TranslationKey', required: true },
  language: { type: String, required: true },
  value: { type: String, required: true },
  isCompleted: { type: Boolean, default: true },
  lastModified: { type: Date, default: Date.now },
});
TranslationSchema.index({ keyId: 1, language: 1 }, { unique: true });

function buildPrompt(
  targetLang: string,
  items: SeoKey[],
  previous?: Record<string, string>,
): string {
  const langName = LANGUAGE_NAMES[targetLang] ?? targetLang;
  const lines: string[] = [];
  lines.push(`Translate the following SEO copy for the radio streaming site "Mega Radio" into ${langName}.`);
  lines.push('Rules:');
  lines.push('- Keep brand names untranslated: "Mega Radio".');
  lines.push('- Keep numeric figures and the "+" sign as-is (e.g. 60,000+, 120+).');
  lines.push(`- Use natural, idiomatic ${langName} suitable for search engines.`);
  lines.push('- Do NOT add quotation marks around the values.');
  lines.push('- Preserve punctuation pipes "|" and em-dashes "—".');
  lines.push('- For keys with [target N-M chars], the translated string MUST be between N and M characters INCLUSIVE.');
  lines.push('  * If the natural translation is shorter than the minimum, add a second clause with concrete extra context (music/news/sports/talk genres, mobile and desktop devices, free streaming, multilingual support) until the character count fits.');
  lines.push('  * If it is longer than the maximum, rephrase concisely. Do NOT pad with filler punctuation.');
  lines.push('  * For logographic / abugida scripts (Chinese, Japanese, Korean, Amharic, Thai, Indic scripts), each character (including spaces) counts as one character. You may need to write significantly longer copy than the English source to reach the minimum.');
  lines.push('- For short fragments / nav labels, keep the translation short and natural.');
  lines.push('');
  lines.push('Output format (STRICT): a single JSON object that maps each input key directly to its translated STRING value (not an object). Example:');
  lines.push('{"some_key": "translated text", "other_key": "translated text"}');
  lines.push('');
  lines.push('Items to translate:');
  for (const it of items) {
    const target = it.lengthTarget ? ` [target length: ${it.lengthTarget.min}-${it.lengthTarget.max} chars]` : '';
    lines.push(`- key: ${it.key}${target}`);
    lines.push(`  english: ${it.defaultValue}`);
    if (it.lengthTarget) {
      const mid = Math.round((it.lengthTarget.min + it.lengthTarget.max) / 2);
      lines.push(`  target_length_chars: aim for about ${mid} characters (range ${it.lengthTarget.min}-${it.lengthTarget.max} INCLUSIVE)`);
    }
    if (previous && it.lengthTarget) {
      const prev = previous[it.key];
      if (prev) {
        const reason = prev.length < it.lengthTarget.min ? 'TOO SHORT' : prev.length > it.lengthTarget.max ? 'TOO LONG' : '';
        if (reason) {
          const delta = reason === 'TOO LONG'
            ? prev.length - it.lengthTarget.max
            : it.lengthTarget.min - prev.length;
          const action = reason === 'TOO LONG'
            ? `REMOVE roughly ${delta} characters: drop redundant words, omit one detail (e.g. one of: streaming/devices/genres), use shorter synonyms.`
            : `ADD roughly ${delta} characters: include one extra concrete detail (genres like music/news/sports/talk, mobile and desktop, free, multilingual).`;
          lines.push(`  previous_attempt: ${prev}`);
          lines.push(`  previous_length: ${prev.length} (${reason}, must be ${it.lengthTarget.min}-${it.lengthTarget.max})`);
          lines.push(`  fix_action: ${action}`);
        }
      }
    }
  }
  return lines.join('\n');
}

async function translateBatchOnce(
  targetLang: string,
  items: SeoKey[],
  previous?: Record<string, string>,
): Promise<Record<string, string>> {
  const langName = LANGUAGE_NAMES[targetLang] ?? targetLang;
  const prompt = buildPrompt(targetLang, items, previous);

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a professional SEO translator. Translate to ${langName}. Respect character-length targets strictly for description-type keys. Return only valid JSON.`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('OpenAI response is not a JSON object');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v.trim();
  }
  return out;
}

function findOffenders(items: SeoKey[], translations: Record<string, string>): SeoKey[] {
  return items.filter((k) => {
    const val = translations[k.key];
    if (!val) return true;
    if (!k.lengthTarget) return false;
    return val.length < k.lengthTarget.min || val.length > k.lengthTarget.max;
  });
}

async function translateLanguage(
  targetLang: string,
  maxRetries: number,
  initial: Record<string, string> | null,
  onProgress?: (translations: Record<string, string>) => Promise<void>,
): Promise<Record<string, string>> {
  let translations: Record<string, string>;
  if (initial && Object.keys(initial).length > 0) {
    // Resume from any existing translations; only re-translate keys that are
    // missing or fail the length window.
    const missingOrBad = SEO_TRANSLATION_KEYS.filter((k) => {
      const v = initial[k.key];
      if (!v) return true;
      if (k.lengthTarget && (v.length < k.lengthTarget.min || v.length > k.lengthTarget.max)) return true;
      return false;
    });
    if (missingOrBad.length === 0) return initial;
    console.log(`    • ${targetLang}: resuming with ${SEO_TRANSLATION_KEYS.length - missingOrBad.length} existing key(s); ${missingOrBad.length} still need work`);
    const fixed = await translateBatchOnce(targetLang, missingOrBad, initial);
    translations = { ...initial, ...fixed };
  } else {
    translations = await translateBatchOnce(targetLang, SEO_TRANSLATION_KEYS);
  }
  if (onProgress) await onProgress(translations);
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const offenders = findOffenders(SEO_TRANSLATION_KEYS, translations);
    if (offenders.length === 0) return translations;
    console.log(`    ↻ ${targetLang}: re-translating ${offenders.length} key(s) to fit length target (attempt ${attempt}/${maxRetries})`);
    const fixed = await translateBatchOnce(targetLang, offenders, translations);
    translations = { ...translations, ...fixed };
    if (onProgress) await onProgress(translations);
  }
  return translations;
}

interface ValidationFailure {
  language: string;
  key: string;
  reason: 'missing' | 'empty' | 'too_short' | 'too_long';
  length?: number;
  target?: { min: number; max: number };
}

async function validateAll(
  Translation: mongoose.Model<ITranslationDoc>,
  keyIdMap: Record<string, mongoose.Types.ObjectId>,
): Promise<ValidationFailure[]> {
  const failures: ValidationFailure[] = [];
  const allLangs = ['en', ...LANGUAGES];
  // Fetch every relevant translation in a single query, then index in memory.
  const docs = await Translation.find({
    keyId: { $in: Object.values(keyIdMap) },
    language: { $in: allLangs },
  }).lean<{ keyId: mongoose.Types.ObjectId; language: string; value: string }[]>();
  const idx = new Map<string, string>();
  for (const d of docs) idx.set(`${String(d.keyId)}|${d.language}`, d.value ?? '');
  for (const lang of allLangs) {
    for (const tk of SEO_TRANSLATION_KEYS) {
      const raw = idx.get(`${String(keyIdMap[tk.key])}|${lang}`);
      if (raw === undefined) {
        failures.push({ language: lang, key: tk.key, reason: 'missing' });
        continue;
      }
      const val = raw.trim();
      if (!val) {
        failures.push({ language: lang, key: tk.key, reason: 'empty' });
        continue;
      }
      if (tk.lengthTarget) {
        if (val.length < tk.lengthTarget.min) {
          failures.push({ language: lang, key: tk.key, reason: 'too_short', length: val.length, target: tk.lengthTarget });
        } else if (val.length > tk.lengthTarget.max) {
          failures.push({ language: lang, key: tk.key, reason: 'too_long', length: val.length, target: tk.lengthTarget });
        }
      }
    }
  }
  return failures;
}

async function main(): Promise<void> {
  if (!MONGO_URI) throw new Error('MONGODB_URI not set');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected!');

  const TranslationKey =
    (mongoose.models.TranslationKey as mongoose.Model<ITranslationKeyDoc> | undefined) ||
    mongoose.model<ITranslationKeyDoc>('TranslationKey', TranslationKeySchema, 'translationkeys');
  const Translation =
    (mongoose.models.Translation as mongoose.Model<ITranslationDoc> | undefined) ||
    mongoose.model<ITranslationDoc>('Translation', TranslationSchema, 'translations');

  console.log('\n1. Creating/updating translation keys...');
  const keyIdMap: Record<string, mongoose.Types.ObjectId> = {};
  for (const tk of SEO_TRANSLATION_KEYS) {
    const existing = await TranslationKey.findOne({ key: tk.key });
    if (existing) {
      keyIdMap[tk.key] = existing._id as mongoose.Types.ObjectId;
      if (!existing.description || existing.category === 'general') {
        existing.description = tk.description;
        existing.category = tk.category;
        await existing.save();
      }
      console.log(`  ✓ Key exists: ${tk.key}`);
    } else {
      const created = await TranslationKey.create({
        key: tk.key,
        defaultValue: tk.defaultValue,
        description: tk.description,
        category: tk.category,
        isPlural: false,
      });
      keyIdMap[tk.key] = created._id as mongoose.Types.ObjectId;
      console.log(`  + Created: ${tk.key}`);
    }
  }

  console.log('\n2. Saving English source translations...');
  for (const tk of SEO_TRANSLATION_KEYS) {
    await Translation.findOneAndUpdate(
      { keyId: keyIdMap[tk.key], language: 'en' },
      { value: tk.defaultValue, isCompleted: true, lastModified: new Date() },
      { upsert: true },
    );
  }
  console.log('  ✓ English saved');

  const FORCE = process.env.FORCE_RETRANSLATE === '1';
  const ONLY = process.env.ONLY_LANG ? new Set(process.env.ONLY_LANG.split(',')) : null;
  const MAX_RETRIES = Number(process.env.LENGTH_RETRIES ?? 3);
  const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 4);
  const VALIDATE_ONLY = process.env.VALIDATE_ONLY === '1';

  const failedLanguages: string[] = [];

  if (VALIDATE_ONLY) {
    console.log('\n3. (skipped — VALIDATE_ONLY=1)');
  } else {
  console.log('\n3. Translating to all languages...');
  const targetLangs = ONLY ? LANGUAGES.filter((l) => ONLY.has(l)) : LANGUAGES;
  for (let i = 0; i < targetLangs.length; i += BATCH_SIZE) {
    const batch = targetLangs.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (lang) => {

        if (!FORCE) {
          // "Already complete" requires every key to be present AND, where
          // applicable, within the strict length window.
          const docs = await Translation.find({
            keyId: { $in: Object.values(keyIdMap) },
            language: lang,
          }).lean<{ keyId: mongoose.Types.ObjectId; value: string }[]>();
          const byKeyId = new Map(docs.map((d) => [String(d.keyId), d.value]));
          const isComplete = SEO_TRANSLATION_KEYS.every((tk) => {
            const v = byKeyId.get(String(keyIdMap[tk.key]));
            if (!v || !v.trim()) return false;
            if (tk.lengthTarget) {
              const len = v.length;
              if (len < tk.lengthTarget.min || len > tk.lengthTarget.max) return false;
            }
            return true;
          });
          if (isComplete) {
            console.log(`  ✓ ${lang} (${LANGUAGE_NAMES[lang]}) - already complete`);
            return;
          }
        }

        console.log(`  → Translating to ${lang} (${LANGUAGE_NAMES[lang]})...`);
        try {
          // Persist after every retry round so partial progress survives if the
          // process is killed by the sandbox before all retries finish.
          const persist = async (translations: Record<string, string>): Promise<void> => {
            for (const tk of SEO_TRANSLATION_KEYS) {
              const value = translations[tk.key];
              if (!value) continue;
              await Translation.findOneAndUpdate(
                { keyId: keyIdMap[tk.key], language: lang },
                { value, isCompleted: true, lastModified: new Date() },
                { upsert: true },
              );
            }
          };
          const existingDocs = await Translation.find({
            keyId: { $in: Object.values(keyIdMap) },
            language: lang,
          }).lean<{ keyId: mongoose.Types.ObjectId; value: string }[]>();
          const initial: Record<string, string> = {};
          const keyIdToKey = new Map<string, string>();
          for (const tk of SEO_TRANSLATION_KEYS) keyIdToKey.set(String(keyIdMap[tk.key]), tk.key);
          for (const d of existingDocs) {
            const k = keyIdToKey.get(String(d.keyId));
            if (k && d.value) initial[k] = d.value;
          }
          const translated = await translateLanguage(
            lang,
            MAX_RETRIES,
            FORCE ? null : initial,
            persist,
          );
          let saved = 0;
          for (const tk of SEO_TRANSLATION_KEYS) {
            if (translated[tk.key]) saved++;
            else console.warn(`    ⚠ ${lang}/${tk.key}: missing/non-string value, will fail validation`);
          }
          console.log(`  ✓ ${lang} - ${saved}/${SEO_TRANSLATION_KEYS.length} saved`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ✗ ${lang} failed: ${msg}`);
          failedLanguages.push(lang);
        }
      }),
    );
  }
  }

  console.log('\n4. Validating coverage and length constraints...');
  const failures = await validateAll(Translation, keyIdMap);
  const totalTranslations = await Translation.countDocuments({
    keyId: { $in: Object.values(keyIdMap) },
  });
  console.log(
    `   Translations stored: ${totalTranslations} (expected ${SEO_TRANSLATION_KEYS.length} × ${LANGUAGES.length + 1} = ${SEO_TRANSLATION_KEYS.length * (LANGUAGES.length + 1)}).`,
  );

  if (failures.length === 0 && failedLanguages.length === 0) {
    console.log('\n✅ Done. All keys present and within length targets across all 57 languages.');
    await mongoose.disconnect();
    return;
  }

  // Group failures by language for readability.
  const grouped = new Map<string, ValidationFailure[]>();
  for (const f of failures) {
    const list = grouped.get(f.language) ?? [];
    list.push(f);
    grouped.set(f.language, list);
  }
  console.error(`\n❌ Validation FAILED. ${failures.length} key/language issue(s) across ${grouped.size} language(s).`);
  for (const [lang, items] of Array.from(grouped.entries())) {
    console.error(`  ${lang}: ${items.length} issue(s)`);
    for (const it of items) {
      const detail =
        it.reason === 'too_short' || it.reason === 'too_long'
          ? ` len=${it.length} target=${it.target?.min}-${it.target?.max}`
          : '';
      console.error(`    - ${it.key} (${it.reason})${detail}`);
    }
  }
  if (failedLanguages.length > 0) {
    console.error(`\n  Languages whose translation step threw an error: ${failedLanguages.join(', ')}`);
  }
  await mongoose.disconnect();
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
