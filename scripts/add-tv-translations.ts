import mongoose from 'mongoose';
import OpenAI from 'openai';

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || '';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TV_TRANSLATION_KEYS: { key: string; defaultValue: string; description: string }[] = [
  { key: 'tv_login_title', defaultValue: 'Connect Your TV', description: 'Page header title for TV login page' },
  { key: 'tv_login_required_title', defaultValue: 'Login Required', description: 'Title shown when user is not logged in' },
  { key: 'tv_login_required_description', defaultValue: 'Please log in to your Mega Radio account first, then come back here to connect your TV.', description: 'Description when user needs to login first' },
  { key: 'tv_go_to_login', defaultValue: 'Go to Login', description: 'Button to redirect to login page' },
  { key: 'tv_enter_code_title', defaultValue: 'Enter the Code Shown on Your TV', description: 'Title above code input' },
  { key: 'tv_enter_code_description', defaultValue: 'Open Mega Radio on your TV and enter the 6-digit code displayed on the screen.', description: 'Instructions for entering TV code' },
  { key: 'tv_code_placeholder', defaultValue: 'Enter 6-digit code', description: 'Placeholder for code input' },
  { key: 'tv_activating', defaultValue: 'Connecting to your TV...', description: 'Loading text while activating' },
  { key: 'tv_activation_success', defaultValue: 'TV Connected Successfully!', description: 'Success message after activation' },
  { key: 'tv_activation_failed', defaultValue: 'Connection failed. Please try again.', description: 'Error when activation fails' },
  { key: 'tv_network_error', defaultValue: 'Network error. Please check your connection.', description: 'Network error message' },
  { key: 'tv_how_it_works', defaultValue: 'How It Works', description: 'Section title for instructions' },
  { key: 'tv_step1_description', defaultValue: 'Open the Mega Radio app on your Samsung TV or LG TV.', description: 'Step 1 instruction' },
  { key: 'tv_step2_description', defaultValue: 'A 6-digit code will appear on your TV screen. Enter that code above.', description: 'Step 2 instruction' },
  { key: 'tv_step3_description', defaultValue: 'Your TV will automatically connect to your account. You can then cast radio stations from your phone or computer.', description: 'Step 3 instruction' },
  { key: 'tv_supported_devices', defaultValue: 'Supported devices: Samsung Smart TV (Tizen), LG Smart TV (webOS). Your TV stays connected to your account permanently — no need to reconnect.', description: 'Info about supported TV devices' },
  { key: 'tv_step_web', defaultValue: 'Web / Mobile', description: 'Label for web/mobile in flow diagram' },
  { key: 'tv_step_tv', defaultValue: 'TV', description: 'Label for TV in flow diagram' },
];

const LANGUAGES = [
  'tr', 'es', 'fr', 'de', 'ar', 'it', 'pt', 'nl', 'ru', 'pl',
  'sv', 'da', 'no', 'fi', 'el', 'hu', 'cs', 'sk', 'ro', 'bg',
  'hr', 'sr', 'sl', 'lv', 'lt', 'et', 'zh', 'ja', 'ko', 'hi',
  'th', 'vi', 'id', 'ms', 'tl', 'he', 'fa', 'ur', 'bn', 'ta',
  'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'sw', 'am', 'zu', 'af',
  'sq', 'az', 'hy', 'so', 'uk', 'bs'
];

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
  sq: 'Albanian', az: 'Azerbaijani', hy: 'Armenian', so: 'Somali', uk: 'Ukrainian', bs: 'Bosnian'
};

const TranslationKeySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  defaultValue: { type: String, required: true },
  description: { type: String, default: '' },
  category: { type: String, default: 'general' },
  isPlural: { type: Boolean, default: false },
});

const TranslationSchema = new mongoose.Schema({
  keyId: { type: mongoose.Schema.Types.ObjectId, ref: 'TranslationKey', required: true },
  language: { type: String, required: true },
  value: { type: String, required: true },
  isCompleted: { type: Boolean, default: true },
  lastModified: { type: Date, default: Date.now },
});

TranslationSchema.index({ keyId: 1, language: 1 }, { unique: true });

async function translateBatch(texts: { key: string; value: string }[], targetLang: string): Promise<Record<string, string>> {
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;
  
  const prompt = `Translate the following UI texts to ${langName}. These are for a radio streaming app's TV login page.
Keep translations natural and concise. Do NOT translate brand names like "Mega Radio", "Samsung", "LG", "Tizen", "webOS".
Return a JSON object with the same keys and translated values.

${JSON.stringify(Object.fromEntries(texts.map(t => [t.key, t.value])), null, 2)}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are a professional translator. Translate to ${langName}. Return only valid JSON.` },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response');
    return JSON.parse(content);
  } catch (err: any) {
    console.error(`Translation error for ${targetLang}:`, err.message);
    return {};
  }
}

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected!');

  const TranslationKey = mongoose.models.TranslationKey || mongoose.model('TranslationKey', TranslationKeySchema, 'translationkeys');
  const Translation = mongoose.models.Translation || mongoose.model('Translation', TranslationSchema, 'translations');

  console.log('\n1. Creating/updating translation keys...');
  const keyIdMap: Record<string, mongoose.Types.ObjectId> = {};

  for (const tk of TV_TRANSLATION_KEYS) {
    const existing = await TranslationKey.findOne({ key: tk.key });
    if (existing) {
      keyIdMap[tk.key] = existing._id as mongoose.Types.ObjectId;
      console.log(`  ✓ Key exists: ${tk.key}`);
    } else {
      const created = await TranslationKey.create({
        key: tk.key,
        defaultValue: tk.defaultValue,
        description: tk.description,
        category: 'tv',
        isPlural: false,
      });
      keyIdMap[tk.key] = created._id as mongoose.Types.ObjectId;
      console.log(`  + Created: ${tk.key}`);
    }
  }

  console.log('\n2. Adding English translations...');
  for (const tk of TV_TRANSLATION_KEYS) {
    await Translation.findOneAndUpdate(
      { keyId: keyIdMap[tk.key], language: 'en' },
      { value: tk.defaultValue, isCompleted: true, lastModified: new Date() },
      { upsert: true }
    );
  }
  console.log('  ✓ English translations saved');

  console.log('\n3. Translating to all languages with OpenAI...');
  const textsToTranslate = TV_TRANSLATION_KEYS.map(tk => ({ key: tk.key, value: tk.defaultValue }));

  const BATCH_SIZE = 5;
  for (let i = 0; i < LANGUAGES.length; i += BATCH_SIZE) {
    const batch = LANGUAGES.slice(i, i + BATCH_SIZE);
    
    const promises = batch.map(async (lang) => {
      const existingCount = await Translation.countDocuments({
        keyId: { $in: Object.values(keyIdMap) },
        language: lang,
        isCompleted: true,
      });
      
      if (existingCount >= TV_TRANSLATION_KEYS.length) {
        console.log(`  ✓ ${lang} (${LANGUAGE_NAMES[lang]}) - already complete`);
        return;
      }

      console.log(`  → Translating to ${lang} (${LANGUAGE_NAMES[lang]})...`);
      const translated = await translateBatch(textsToTranslate, lang);
      
      let saved = 0;
      for (const [key, value] of Object.entries(translated)) {
        if (keyIdMap[key] && value) {
          await Translation.findOneAndUpdate(
            { keyId: keyIdMap[key], language: lang },
            { value, isCompleted: true, lastModified: new Date() },
            { upsert: true }
          );
          saved++;
        }
      }
      console.log(`  ✓ ${lang} - ${saved}/${TV_TRANSLATION_KEYS.length} translations saved`);
    });

    await Promise.all(promises);
  }

  console.log('\n✅ All TV login translations completed!');
  
  const totalTranslations = await Translation.countDocuments({
    keyId: { $in: Object.values(keyIdMap) },
  });
  console.log(`Total translations: ${totalTranslations} (${TV_TRANSLATION_KEYS.length} keys × ${LANGUAGES.length + 1} languages)`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
