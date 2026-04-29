import type { Express } from "express";
import { TranslationKey, Translation, TranslationLanguage, Genre, Station, User, Language, UserFavorite, UserNotification, UserFollow, AuthToken, StationRating, SyncLog, BlacklistedStation } from "../../shared/mongo-schemas";
import CacheManager from "../cache";
import { logger } from "../utils/logger";
import { stripPlaceholders } from "./shared-utils";
import { refreshCommunityFavoritesCache, fetchTranslationsForLanguage, refreshTranslationsCache } from "./cache-refresh-utils";
import { syncService } from "../services/sync";
import { isQuotaExceeded, isQuotaError, handleQuotaError, safeWrite } from "../utils/quota-guard";
import { performanceCache } from "../performance-cache";

export function registerTranslationAdminRoutes(app: Express, deps: any) {
  const { requireAuth, requireAdmin } = deps;

  // Remove duplicate endpoint - using the one below that includes auto-population

  // ADMIN TRANSLATION LANGUAGES API - Manage translation languages 
  app.get("/api/admin/translation-languages", requireAdmin, async (req, res) => {
    try {
      // Fetch all translation languages from database
      const languages = await TranslationLanguage.find().sort({ createdAt: -1 }).lean();
      
      // Get completion percentage for each language
      const translationLanguages = await Promise.all(
        languages.map(async (lang) => {
          const totalKeys = await TranslationKey.countDocuments();
          
          // Count translations by joining with translations collection
          const translatedKeys = await Translation.countDocuments({
            language: lang.code,
            isCompleted: true
          });
          
          return {
            ...lang,
            completionPercentage: totalKeys > 0 ? Math.round((translatedKeys / totalKeys) * 100) : 0
          };
        })
      );

      res.json(translationLanguages);
    } catch (error) {
      // console.error('Error fetching translation languages:', error);
      res.status(500).json({ error: 'Failed to fetch translation languages' });
    }
  });

  // CREATE Translation Language
  app.post("/api/admin/translation-languages", requireAdmin, async (req, res) => {
    try {
      const { code, name, isEnabled, isDefault } = req.body;

      // Validate required fields
      if (!code || !name) {
        return res.status(400).json({ error: 'Language code and name are required' });
      }

      // Check if language code already exists
      const existingLanguage = await TranslationLanguage.findOne({ code: code.toLowerCase() });
      if (existingLanguage) {
        return res.status(409).json({ error: 'Language with this code already exists' });
      }

      // If setting as default, unset other defaults
      if (isDefault) {
        await TranslationLanguage.updateMany({}, { $set: { isDefault: false } });
      }

      // Create new translation language
      const newLanguage = new TranslationLanguage({
        code: code.toLowerCase(),
        name,
        isEnabled: isEnabled !== undefined ? isEnabled : true,
        isDefault: isDefault || false
      });

      await newLanguage.save();

      res.status(201).json(newLanguage);
    } catch (error) {
      // console.error('Error creating translation language:', error);
      res.status(500).json({ error: 'Failed to create translation language' });
    }
  });

  // UPDATE Translation Language
  app.put("/api/admin/translation-languages/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { code, name, isEnabled, isDefault } = req.body;

      // Find the language
      const language = await TranslationLanguage.findById(id);
      if (!language) {
        return res.status(404).json({ error: 'Translation language not found' });
      }

      // If changing code, check for duplicates
      if (code && code.toLowerCase() !== language.code) {
        const existingLanguage = await TranslationLanguage.findOne({ 
          code: code.toLowerCase(),
          _id: { $ne: id }
        });
        if (existingLanguage) {
          return res.status(409).json({ error: 'Language with this code already exists' });
        }
      }

      // If setting as default, unset other defaults
      if (isDefault && !language.isDefault) {
        await TranslationLanguage.updateMany(
          { _id: { $ne: id } },
          { $set: { isDefault: false } }
        );
      }

      // Update fields
      if (code) language.code = code.toLowerCase();
      if (name) language.name = name;
      if (isEnabled !== undefined) language.isEnabled = isEnabled;
      if (isDefault !== undefined) language.isDefault = isDefault;

      await language.save();

      res.json(language);
    } catch (error) {
      // console.error('Error updating translation language:', error);
      res.status(500).json({ error: 'Failed to update translation language' });
    }
  });

  // DELETE Translation Language
  app.delete("/api/admin/translation-languages/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      // Find the language
      const language = await TranslationLanguage.findById(id);
      if (!language) {
        return res.status(404).json({ error: 'Translation language not found' });
      }

      // Prevent deleting default language
      if (language.isDefault) {
        return res.status(400).json({ error: 'Cannot delete the default language' });
      }

      // Delete the language
      await TranslationLanguage.findByIdAndDelete(id);

      // Optionally delete associated translations
      await Translation.deleteMany({ language: language.code });

      res.json({ message: 'Translation language deleted successfully' });
    } catch (error) {
      // console.error('Error deleting translation language:', error);
      res.status(500).json({ error: 'Failed to delete translation language' });
    }
  });

  // GET Translation Metadata - for cache versioning
  app.get("/api/admin/translation-metadata", requireAdmin, async (req, res) => {
    try {
      const { getTranslationMetadata } = await import('../services/translation-version');
      const metadata = await getTranslationMetadata();
      res.json(metadata);
    } catch (error) {
      console.error('Error fetching translation metadata:', error);
      res.status(500).json({ error: 'Failed to fetch translation metadata' });
    }
  });

  // POST Bump Translation Version - invalidates client caches
  app.post("/api/admin/translation-metadata/bump", requireAdmin, async (req, res) => {
    try {
      const { notes } = req.body;
      const { bumpTranslationVersion } = await import('../services/translation-version');
      const result = await bumpTranslationVersion(notes);
      
      if (result.success) {
        res.json({ 
          success: true, 
          version: result.version,
          message: `Translation version bumped to ${result.version}`
        });
      } else {
        res.status(500).json({ error: 'Failed to bump translation version' });
      }
    } catch (error) {
      console.error('Error bumping translation version:', error);
      res.status(500).json({ error: 'Failed to bump translation version' });
    }
  });

  // SEED Translation Languages - Sync all 55 URL translation languages to database
  app.post("/api/admin/seed-translation-languages", requireAdmin, async (req, res) => {
    try {
      const languageMapping = {
        "af": "Afrikaans", "am": "Amharic", "ar": "Arabic", "az": "Azerbaijani",
        "bg": "Bulgarian", "bn": "Bengali", "cs": "Czech", "da": "Danish",
        "de": "German", "el": "Greek", "es": "Spanish", "et": "Estonian",
        "fa": "Persian", "fi": "Finnish", "fr": "French", "gu": "Gujarati",
        "he": "Hebrew", "hi": "Hindi", "hr": "Croatian", "hu": "Hungarian",
        "hy": "Armenian", "id": "Indonesian", "it": "Italian", "ja": "Japanese",
        "kn": "Kannada", "ko": "Korean", "lt": "Lithuanian", "lv": "Latvian",
        "ml": "Malayalam", "mr": "Marathi", "ms": "Malay", "nl": "Dutch",
        "no": "Norwegian", "pa": "Punjabi", "pl": "Polish", "pt": "Portuguese",
        "ro": "Romanian", "ru": "Russian", "sk": "Slovak", "sl": "Slovenian",
        "so": "Somali", "sq": "Albanian", "sr": "Serbian", "sv": "Swedish",
        "sw": "Swahili", "ta": "Tamil", "te": "Telugu", "th": "Thai",
        "tl": "Tagalog", "tr": "Turkish", "uk": "Ukrainian", "ur": "Urdu",
        "vi": "Vietnamese", "zh": "Chinese", "zu": "Zulu"
      };

      let created = 0;
      let updated = 0;
      let skipped = 0;

      // Check if there's already a default language
      const hasDefault = await TranslationLanguage.findOne({ isDefault: true });

      for (const [code, name] of Object.entries(languageMapping)) {
        const existingLanguage = await TranslationLanguage.findOne({ code });

        if (existingLanguage) {
          skipped++;
        } else {
          // Create new language - set English, Hebrew, and Turkish as default
          const isDefaultLanguage = !hasDefault && (code === 'en' || code === 'he' || code === 'tr');
          await TranslationLanguage.create({
            code,
            name,
            isEnabled: true,
            isDefault: isDefaultLanguage
          });
          created++;
        }
      }

      res.json({
        message: 'Translation languages seeded successfully',
        stats: {
          total: Object.keys(languageMapping).length,
          created,
          updated,
          skipped
        }
      });
    } catch (error) {
      console.error('Error seeding translation languages:', error);
      res.status(500).json({ error: 'Failed to seed translation languages' });
    }
  });

  // AUTO-TRANSLATE Language via OpenAI - Enhanced with English detection and brand protection
  app.post("/api/admin/translation-languages/:code/translate", requireAdmin, async (req, res) => {
    try {
      const { code } = req.params;
      // missingOnly=true → only insert truly missing translations, never overwrite existing rows
      const missingOnly = req.query.missingOnly === 'true' || req.body?.missingOnly === true;

      // Skip English - no need to translate
      if (code.toLowerCase() === 'en') {
        return res.json({
          message: 'English is the source language, no translation needed',
          stats: { total: 0, existing: 0, translated: 0, fixed: 0, failed: 0 }
        });
      }

      // Find the language
      const language = await TranslationLanguage.findOne({ code: code.toLowerCase() });
      if (!language) {
        return res.status(404).json({ error: 'Translation language not found' });
      }

      // Protected terms that should NOT be translated (brand names and placeholders)
      const PROTECTED_TERMS = [
        'Mega Radio', 'MegaRadio', 'mega radio',
        '{STATION_NAME}', '{stationname}', '{station_name}', '{station}',
        '{country}', '{COUNTRY}', '{Country}',
        '{genre}', '{GENRE}', '{Genre}',
        '{language}', '{LANGUAGE}', '{Language}',
        '{city}', '{CITY}', '{City}',
        '{count}', '{COUNT}', '{name}', '{NAME}',
        '{url}', '{URL}', '{link}', '{LINK}',
        '{time}', '{TIME}', '{date}', '{DATE}',
        '{number}', '{NUMBER}', '{value}', '{VALUE}'
      ];

      // Common English words to detect incorrect translations (excluding protected terms)
      const COMMON_ENGLISH_WORDS = [
        'the', 'and', 'for', 'with', 'your', 'you', 'are', 'have', 'has', 'this', 'that',
        'from', 'will', 'can', 'all', 'more', 'when', 'there', 'their', 'what', 'about',
        'which', 'would', 'make', 'like', 'just', 'over', 'such', 'into', 'than', 'other',
        'been', 'some', 'could', 'them', 'being', 'these', 'because', 'each', 'through',
        'listen', 'radio', 'station', 'stations', 'streaming', 'music', 'live', 'online',
        'discover', 'explore', 'find', 'search', 'browse', 'play', 'playing', 'favorite',
        'favorites', 'settings', 'loading', 'error', 'please', 'wait', 'welcome', 'hello',
        'world', 'country', 'countries', 'genre', 'genres', 'popular', 'trending', 'new',
        'free', 'unlimited', 'access', 'anywhere', 'anytime', 'best', 'top', 'quality'
      ];

      // Function to detect if translation contains English content
      const hasEnglishContent = (text: string, isEnglishSource: boolean = false): boolean => {
        if (!text || isEnglishSource) return false;
        
        // Remove ALL placeholder patterns (any format: {xxx}, %xxx%, {{xxx}}, etc.)
        let cleanText = text;
        cleanText = cleanText.replace(/\{[^}]+\}/gi, ''); // {placeholder}
        cleanText = cleanText.replace(/%[^%]+%/gi, '');   // %placeholder%
        cleanText = cleanText.replace(/\{\{[^}]+\}\}/gi, ''); // {{placeholder}}
        
        // Remove brand name "Mega Radio" in any case variation
        cleanText = cleanText.replace(/mega\s*radio/gi, '');
        
        // Trim and check if there's meaningful text left
        cleanText = cleanText.trim();
        if (!cleanText || cleanText.length < 3) {
          // Text is mainly placeholders/brand names - skip
          return false;
        }
        
        // Split into words and check for common English words
        const words = cleanText.toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const englishWordCount = words.filter(word => 
          COMMON_ENGLISH_WORDS.includes(word.replace(/[.,!?;:'"()]/g, ''))
        ).length;
        
        // Calculate ratio: if more than 30% of words are common English words, likely incorrect
        const englishRatio = words.length > 0 ? englishWordCount / words.length : 0;
        
        // Flag as English if: 2+ common words AND >25% of text is English
        return englishWordCount >= 2 && englishRatio > 0.25;
      };

      // Get all translation keys
      const allKeys = await TranslationKey.find({}).lean();
      
      // Get existing translations for this language - use keyId to map
      const existingTranslations = await Translation.find({ language: code.toLowerCase() }).lean();
      // Map by keyId (ObjectId) since Translation uses keyId reference, not key string
      const existingTranslationsMap = new Map(existingTranslations.map((t: any) => [t.keyId?.toString(), t]));
      
      // Find keys that need translation (missing OR have English content)
      const keysToTranslate: any[] = [];
      const keysToFix: string[] = [];
      
      for (const key of allKeys) {
        // Look up by key._id (TranslationKey ObjectId) matching Translation.keyId
        const existing = existingTranslationsMap.get(key._id?.toString());
        if (!existing) {
          // Missing translation
          keysToTranslate.push({ ...key, isNew: true });
        } else if (!missingOnly) {
          // Check if translation needs fixing (skip in missingOnly mode):
          // 1. Value is same as key name (untranslated)
          // 2. Value contains underscores (likely key name, not real translation)
          // 3. Value is same as English default (not translated at all)
          // 4. Value has English content
          const value = existing.value?.trim() || '';
          const defaultValue = key.defaultValue?.trim() || '';
          
          const isUntranslated = value === key.key || 
            (value.includes('_') && !value.includes('{') && value.length < 50) ||
            (defaultValue && value.toLowerCase() === defaultValue.toLowerCase()) ||
            hasEnglishContent(value);
          
          if (isUntranslated) {
            keysToTranslate.push({ ...key, isNew: false, existingId: existing._id, existingValue: existing.value });
            keysToFix.push(key.key);
          }
        }
      }
      
      if (keysToTranslate.length === 0) {
        return res.json({
          message: 'All translations are complete and correct for this language',
          stats: {
            total: allKeys.length,
            existing: existingTranslations.length,
            translated: 0,
            fixed: 0,
            failed: 0
          }
        });
      }

      logger.log(`🔄 ${language.name}: Found ${keysToTranslate.filter(k => k.isNew).length} missing, ${keysToFix.length} to fix`);

      // Complete language mapping for all 57 languages
      const languageMapping: {[key: string]: {name: string, nativeName: string}} = {
        af: { name: 'Afrikaans', nativeName: 'Afrikaans' },
        am: { name: 'Amharic', nativeName: 'አማርኛ' },
        ar: { name: 'Arabic', nativeName: 'العربية' },
        az: { name: 'Azerbaijani', nativeName: 'Azərbaycan' },
        bg: { name: 'Bulgarian', nativeName: 'Български' },
        bn: { name: 'Bengali', nativeName: 'বাংলা' },
        bs: { name: 'Bosnian', nativeName: 'Bosanski' },
        cs: { name: 'Czech', nativeName: 'Čeština' },
        da: { name: 'Danish', nativeName: 'Dansk' },
        de: { name: 'German', nativeName: 'Deutsch' },
        el: { name: 'Greek', nativeName: 'Ελληνικά' },
        es: { name: 'Spanish', nativeName: 'Español' },
        et: { name: 'Estonian', nativeName: 'Eesti' },
        fa: { name: 'Persian', nativeName: 'فارسی' },
        fi: { name: 'Finnish', nativeName: 'Suomi' },
        fr: { name: 'French', nativeName: 'Français' },
        gu: { name: 'Gujarati', nativeName: 'ગુજરાતી' },
        he: { name: 'Hebrew', nativeName: 'עברית' },
        hi: { name: 'Hindi', nativeName: 'हिन्दी' },
        hr: { name: 'Croatian', nativeName: 'Hrvatski' },
        hu: { name: 'Hungarian', nativeName: 'Magyar' },
        hy: { name: 'Armenian', nativeName: 'Հայերեն' },
        id: { name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
        it: { name: 'Italian', nativeName: 'Italiano' },
        ja: { name: 'Japanese', nativeName: '日本語' },
        kn: { name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
        ko: { name: 'Korean', nativeName: '한국어' },
        lt: { name: 'Lithuanian', nativeName: 'Lietuvių' },
        lv: { name: 'Latvian', nativeName: 'Latviešu' },
        ml: { name: 'Malayalam', nativeName: 'മലയാളം' },
        mr: { name: 'Marathi', nativeName: 'मराठी' },
        ms: { name: 'Malay', nativeName: 'Bahasa Melayu' },
        nl: { name: 'Dutch', nativeName: 'Nederlands' },
        no: { name: 'Norwegian', nativeName: 'Norsk' },
        pa: { name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
        pl: { name: 'Polish', nativeName: 'Polski' },
        pt: { name: 'Portuguese', nativeName: 'Português' },
        ro: { name: 'Romanian', nativeName: 'Română' },
        ru: { name: 'Russian', nativeName: 'Русский' },
        sk: { name: 'Slovak', nativeName: 'Slovenčina' },
        sl: { name: 'Slovenian', nativeName: 'Slovenščina' },
        so: { name: 'Somali', nativeName: 'Soomaali' },
        sq: { name: 'Albanian', nativeName: 'Shqip' },
        sr: { name: 'Serbian', nativeName: 'Српски' },
        sv: { name: 'Swedish', nativeName: 'Svenska' },
        sw: { name: 'Swahili', nativeName: 'Kiswahili' },
        ta: { name: 'Tamil', nativeName: 'தமிழ்' },
        te: { name: 'Telugu', nativeName: 'తెలుగు' },
        th: { name: 'Thai', nativeName: 'ไทย' },
        tl: { name: 'Filipino', nativeName: 'Tagalog' },
        tr: { name: 'Turkish', nativeName: 'Türkçe' },
        uk: { name: 'Ukrainian', nativeName: 'Українська' },
        ur: { name: 'Urdu', nativeName: 'اردو' },
        vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt' },
        zh: { name: 'Chinese', nativeName: '中文' },
        zu: { name: 'Zulu', nativeName: 'isiZulu' }
      };

      const langConfig = languageMapping[code] || { name: language.name, nativeName: language.name };

      // Translate in batches
      const batchSize = 20;
      let translated = 0;
      let fixed = 0;
      let failed = 0;

      for (let i = 0; i < keysToTranslate.length; i += batchSize) {
        const batch = keysToTranslate.slice(i, i + batchSize);
        
        // Create translation prompt with protected terms
        const keysText = batch.map((k: any) => `${k.key}: ${k.defaultValue}`).join('\n');
        
        const prompt = `Translate these UI texts to ${langConfig.name} (${langConfig.nativeName}).

PROTECTED TERMS - DO NOT TRANSLATE, keep exactly as shown:
- Brand name: "Mega Radio" (keep as "Mega Radio")
- All placeholders in {curly braces}: {STATION_NAME}, {country}, {genre}, {language}, {city}, {count}, etc.

TRANSLATION RULES:
1. Translate ALL other text to native ${langConfig.name} - NO English words allowed
2. Keep placeholders exactly as they appear: {country} stays {country}, {STATION_NAME} stays {STATION_NAME}
3. Use natural, fluent ${langConfig.name} that native speakers would use
4. For UI terms like "Settings", "Search", "Loading" - use the standard ${langConfig.name} equivalent
5. Return format: key: translated_text

Keys to translate:
${keysText}`;

        try {
          const openAIModule = await import('openai');
          const openai = new openAIModule.default({
            apiKey: process.env.OPENAI_API_KEY
          });

          const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You are an expert ${langConfig.name} translator for a radio streaming app. You produce 100% native ${langConfig.name} translations with NO English words (except brand name "Mega Radio" and {placeholders}). You understand that placeholders like {country}, {STATION_NAME} must remain unchanged.`
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.2,
            max_tokens: 4000
          });
          
          const translatedText = response.choices[0].message.content || '';
          
          // Parse the response
          const lines = translatedText.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
              const key = line.substring(0, colonIndex).trim();
              let translation = line.substring(colonIndex + 1).trim();
              
              // Remove any quotes around the translation
              translation = translation.replace(/^["']|["']$/g, '');
              
              const originalKey = batch.find((k: any) => k.key === key);
              if (originalKey && translation) {
                try {
                  if (originalKey.isNew) {
                    // Insert new translation (keyId references TranslationKey._id)
                    await Translation.create({
                      keyId: originalKey._id,
                      language: code.toLowerCase(),
                      value: translation,
                      isCompleted: true,
                      lastModified: new Date()
                    });
                    translated++;
                  } else {
                    // Only update if new translation differs from existing (avoid redundant writes)
                    const existingValue = originalKey.existingValue?.trim();
                    const newValue = translation.trim();
                    
                    if (existingValue !== newValue) {
                      await Translation.updateOne(
                        { _id: originalKey.existingId },
                        { 
                          $set: { 
                            value: newValue, 
                            isCompleted: true,
                            updatedAt: new Date()
                          } 
                        }
                      );
                      fixed++;
                    }
                    // Skip if values are identical (no change needed)
                  }
                } catch (dbError) {
                  // Skip duplicate key errors
                  if ((dbError as any).code !== 11000) {
                    console.error(`DB error for key ${key}:`, dbError);
                    failed++;
                  }
                }
              }
            }
          }
          
        } catch (error) {
          console.error(`Error translating batch:`, error);
          failed += batch.length;
        }
        
        // Small delay between batches to avoid rate limiting
        if (i + batchSize < keysToTranslate.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Clear translation caches
      if (translated > 0 || fixed > 0) {
        await CacheManager.clearByPattern(`sitemap_translations:${code}`);
        await CacheManager.clearByPattern(`translations:${code}`);
        logger.log(`✅ ${language.name}: Translated ${translated} new, fixed ${fixed} incorrect`);
      }

      res.json({
        message: `Translation complete for ${language.name}`,
        stats: {
          total: allKeys.length,
          existing: existingTranslations.length,
          translated,
          fixed,
          failed,
          keysFixed: keysToFix
        }
      });
    } catch (error) {
      console.error('Error auto-translating language:', error);
      res.status(500).json({ error: 'Failed to auto-translate language' });
    }
  });

  // ADMIN REAL LANGUAGES API - Manage real languages from station database (Admin Only)
  app.get("/api/admin/real-languages", requireAdmin, async (req, res) => {
    try {
      // Language grouping map to consolidate variants
      const languageGroups = {
        'Turkish': ['turkish', 'türkiye', 'turk', 'türkçe', 'turkey'],
        'German': ['german', 'deutsch', 'germany', 'deutsche'],
        'English': ['english', 'en', 'eng'],
        'Spanish': ['spanish', 'español', 'espanol', 'spain', 'es'],
        'French': ['french', 'français', 'francais', 'france', 'fr'],
        'Italian': ['italian', 'italiano', 'italy', 'it'],
        'Portuguese': ['portuguese', 'português', 'portugues', 'brazil', 'brasil', 'pt'],
        'Russian': ['russian', 'русский', 'russia', 'ru'],
        'Chinese': ['chinese', 'china', 'zh', '中文'],
        'Japanese': ['japanese', 'japan', 'ja', '日本語'],
        'Korean': ['korean', 'korea', 'ko', '한국어'],
        'Arabic': ['arabic', 'عربي', 'ar'],
        'Dutch': ['dutch', 'nederlands', 'netherlands', 'nl'],
        'Polish': ['polish', 'polski', 'poland', 'pl'],
        'Swedish': ['swedish', 'svenska', 'sweden', 'se'],
        'Norwegian': ['norwegian', 'norsk', 'norway', 'no'],
        'Danish': ['danish', 'dansk', 'denmark', 'dk'],
        'Finnish': ['finnish', 'suomi', 'finland', 'fi'],
        'Greek': ['greek', 'ελληνικά', 'greece', 'gr'],
        'Czech': ['czech', 'čeština', 'czechia', 'cz'],
        'Hungarian': ['hungarian', 'magyar', 'hungary', 'hu'],
        'Romanian': ['romanian', 'română', 'romania', 'ro'],
        'Bulgarian': ['bulgarian', 'български', 'bulgaria', 'bg'],
        'Croatian': ['croatian', 'hrvatski', 'croatia', 'hr'],
        'Serbian': ['serbian', 'srpski', 'serbia', 'rs'],
        'Ukrainian': ['ukrainian', 'українська', 'ukraine', 'ua'],
        'Slovenian': ['slovenian', 'slovenščina', 'slovenia', 'si'],
        'Slovak': ['slovak', 'slovenčina', 'slovakia', 'sk'],
        'Lithuanian': ['lithuanian', 'lietuvių', 'lithuania', 'lt'],
        'Latvian': ['latvian', 'latviešu', 'latvia', 'lv'],
        'Estonian': ['estonian', 'eesti', 'estonia', 'ee']
      };

      // Get all unique languages from stations
      const rawLanguages = await Station.aggregate([
        {
          $match: {
            language: { $exists: true, $nin: ["", null] }
          }
        },
        {
          $group: {
            _id: "$language",
            stationCount: { $sum: 1 }
          }
        },
        {
          $project: {
            language: "$_id",
            stationCount: 1,
            _id: 0
          }
        }
      ]);

      // Group languages by their main language
      const groupedLanguages = {};
      const ungroupedLanguages = [];

      rawLanguages.forEach(langData => {
        const langName = langData.language.toLowerCase().trim();
        let grouped = false;

        // Check if this language belongs to any group
        for (const [mainLang, variants] of Object.entries(languageGroups)) {
          if (variants.some(variant => langName.includes(variant) || variant.includes(langName))) {
            if (!groupedLanguages[mainLang]) {
              groupedLanguages[mainLang] = {
                mainLanguage: mainLang,
                variants: [],
                totalStations: 0
              };
            }
            groupedLanguages[mainLang].variants.push({
              originalName: langData.language,
              stationCount: langData.stationCount
            });
            groupedLanguages[mainLang].totalStations += langData.stationCount;
            grouped = true;
            break;
          }
        }

        // If not grouped, add to ungrouped
        if (!grouped) {
          ungroupedLanguages.push({
            language: langData.language,
            stationCount: langData.stationCount
          });
        }
      });

      // Convert grouped languages to array and sort by station count
      const finalLanguages = Object.values(groupedLanguages)
        .sort((a, b) => b.totalStations - a.totalStations)
        .map(group => ({
          ...group,
          variants: group.variants.sort((a, b) => b.stationCount - a.stationCount)
        }));

      // Add ungrouped languages at the end, sorted by station count
      const sortedUngrouped = ungroupedLanguages
        .sort((a, b) => b.stationCount - a.stationCount)
        .map(lang => ({
          mainLanguage: lang.language,
          variants: [{ originalName: lang.language, stationCount: lang.stationCount }],
          totalStations: lang.stationCount
        }));

      const allLanguages = [...finalLanguages, ...sortedUngrouped];

      res.json({
        languages: allLanguages,
        total: allLanguages.length,
        totalStations: allLanguages.reduce((sum, lang) => sum + lang.totalStations, 0)
      });
    } catch (error) {
      console.error('Error fetching real languages:', error);
      res.status(500).json({ error: 'Failed to fetch real languages' });
    }
  });

  // ADMIN MERGE STATIONS API - Merge duplicate stations manually (Admin Only)
  app.post("/api/admin/stations/merge", requireAdmin, async (req, res) => {
    try {
      const { primaryStationId, duplicateStationIds, mergeData } = req.body;
      
      // logger.log(`🔗 Merging ${duplicateStationIds.length} stations into primary station ${primaryStationId}`);
      
      // Get primary station
      const primaryStation = await Station.findById(primaryStationId);
      if (!primaryStation) {
        return res.status(404).json({ error: 'Primary station not found' });
      }

      // Get duplicate stations
      const duplicateStations = await Station.find({ _id: { $in: duplicateStationIds } });
      
      // Merge data (take best values from all stations)
      const mergedData = {
        name: mergeData.name || primaryStation.name,
        url: mergeData.url || primaryStation.url,
        homepage: mergeData.homepage || primaryStation.homepage,
        favicon: mergeData.favicon || primaryStation.favicon,
        country: mergeData.country || primaryStation.country,
        language: mergeData.language || primaryStation.language,
        genre: mergeData.genre || primaryStation.genre,
        // Combine votes from all stations
        votes: duplicateStations.reduce((total, station) => total + (station.votes || 0), primaryStation.votes || 0),
        // Keep the earliest creation date
        lastChangedTime: duplicateStations.reduce((earliest, station) => {
          const stationTime = new Date(station.lastChangedTime);
          const earliestTime = new Date(earliest);
          return stationTime < earliestTime ? station.lastChangedTime : earliest;
        }, primaryStation.lastChangedTime)
      };

      await Station.findByIdAndUpdate(primaryStationId, mergedData);
      if (primaryStation.slug) performanceCache.invalidateStationCache(primaryStation.slug);
      for (const dup of duplicateStations) {
        if (dup.slug) performanceCache.invalidateStationCache(dup.slug);
      }
      await Station.deleteMany({ _id: { $in: duplicateStationIds } });
      
      // logger.log(`✅ Successfully merged ${duplicateStationIds.length} duplicate stations`);
      
      res.json({
        success: true,
        message: `Successfully merged ${duplicateStationIds.length} stations`,
        mergedStation: await Station.findById(primaryStationId)
      });
    } catch (error) {
      // console.error('Error merging stations:', error);
      res.status(500).json({ error: 'Failed to merge stations' });
    }
  });

  // ADMIN GENRES API - Returns only real genres from database for management (Admin Only)
  app.get("/api/admin/genres", requireAdmin, async (req, res) => {
    try {
      logger.log('🎵 Fetching ONLY real genres from database for admin management...');
      
      // Extract query parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = (req.query.search as string)?.trim() || '';
      const sortBy = (req.query.sortBy as string) || 'stationCount';
      
      // Build MongoDB query
      const query: any = {};
      
      // Add search filter if provided (case-insensitive search in name field)
      if (search) {
        query.name = { $regex: search, $options: 'i' };
      }
      
      // Count total matching documents
      const total = await Genre.countDocuments(query);
      
      // Get paginated genres from database (not dynamic ones generated from stations)
      const skip = (page - 1) * limit;
      
      // Determine sort order
      let sortOptions: any = { stationCount: -1 }; // Default: most popular first
      if (sortBy === 'name') {
        sortOptions = { name: 1 }; // Alphabetical A-Z
      } else if (sortBy === 'recent') {
        sortOptions = { createdAt: -1 }; // Newest first
      }
      
      const realGenres = await Genre.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean();
      
      logger.log(`📊 Found ${realGenres.length} genres (page ${page}/${Math.ceil(total / limit)}, search: "${search}")`);
      
      // If no genres exist at all, populate from station tags first
      if (total === 0 && !search) {
        logger.log('📊 No genres found, attempting to populate from station tags...');
        try {
          await populateGenresFromStations();
          const newTotal = await Genre.countDocuments(query);
          const newGenres = await Genre.find(query).sort(sortOptions).skip(skip).limit(limit).lean();
          logger.log(`✅ Successfully populated ${newTotal} genres from station data`);
          return res.json({
            data: newGenres,
            total: newTotal,
            currentPage: page,
            totalPages: Math.ceil(newTotal / limit),
            populated: true
          });
        } catch (populateError) {
          console.error('Failed to populate genres:', populateError);
        }
      }
      
      // Return in the format expected by the frontend
      res.json({
        data: realGenres,
        total,
        currentPage: page,
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      console.error('Error fetching admin genres:', error);
      res.status(500).json({ error: 'Failed to fetch admin genres' });
    }
  });

  // ADMIN GENRE POPULATION API - Manually trigger genre population from station tags
  app.post("/api/admin/populate-genres", requireAdmin, async (req, res) => {
    try {
      logger.log('🎵 Manually triggering genre population from station tags...');
      
      const result = await populateGenresFromStations();
      
      res.json({
        success: true,
        message: `Successfully populated ${result.genresCreated} genres from station data`,
        genresCreated: result.genresCreated,
        tagsProcessed: result.tagsProcessed
      });
    } catch (error) {
      console.error('Error manually populating genres:', error);
      res.status(500).json({ error: 'Failed to populate genres' });
    }
  });

  // Helper function to populate genres from station tags
  async function populateGenresFromStations() {
    try {
      logger.log('🎵 Starting genre population from station tags...');
      
      // Get all stations with tags
      const stations = await Station.find({ 
        $or: [
          { tags: { $exists: true, $nin: [null, ''] } },
          { genre: { $exists: true, $nin: [null, ''] } }
        ]
      }).lean();
      
      logger.log(`📊 Found ${stations.length} stations with tags/genres`);
      
      const tagCounts = {};
      
      // Parse and count all tags
      stations.forEach(station => {
        const allTags = [];
        
        // Handle 'tags' field
        if (station.tags) {
          if (typeof station.tags === 'string') {
            // Handle comma-separated tags
            allTags.push(...station.tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0));
          } else if (Array.isArray(station.tags)) {
            allTags.push(...station.tags);
          }
        }
        
        // Handle 'genre' field
        if (station.genre && typeof station.genre === 'string') {
          allTags.push(station.genre.trim());
        }
        
        allTags.forEach(tag => {
          const normalizedTag = tag.toLowerCase().trim();
          if (normalizedTag.length > 0 && normalizedTag.length < 50) { // Reasonable tag length
            tagCounts[normalizedTag] = (tagCounts[normalizedTag] || 0) + 1;
          }
        });
      });
      
      logger.log(`📈 Found ${Object.keys(tagCounts).length} unique tags`);
      
      // Create genres for tags with at least 1 station
      let genresCreated = 0;
      for (const [tag, count] of Object.entries(tagCounts)) {
        if (count >= 1) {
          const genreData = {
            name: tag.charAt(0).toUpperCase() + tag.slice(1), // Capitalize first letter
            slug: tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
            stationCount: count,
            isDiscoverable: count >= 2, // Make discoverable if 2+ stations
            createdAt: new Date(),
            updatedAt: new Date()
          };
          
          // Insert genre (update if exists)
          await Genre.findOneAndUpdate(
            { slug: genreData.slug },
            genreData,
            { upsert: true, new: true }
          );
          genresCreated++;
        }
      }
      
      logger.log(`✅ Successfully populated ${genresCreated} genres!`);
      
      return {
        genresCreated,
        tagsProcessed: Object.keys(tagCounts).length
      };
    } catch (error) {
      console.error('❌ Error populating genres:', error);
      throw error;
    }
  }

  // LOCATION API - IP-based geolocation detection
  // 🚀 OPTIMIZED: Uses Cloudflare headers for instant detection (0ms vs 300-800ms)
  app.get("/api/location", async (req, res) => {
    // CRITICAL: Prevent Cloudflare from caching location responses (user-specific data)
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Vary': 'CF-Connecting-IP, X-Forwarded-For'
    });
    
    try {
      // Get the client's IP address
      let rawIP = req.headers['cf-connecting-ip'] || 
                  req.headers['x-forwarded-for'] || 
                  req.headers['x-real-ip'] || 
                  req.connection.remoteAddress || 
                  req.socket.remoteAddress || 
                  (req.connection as any)?.socket?.remoteAddress ||
                  req.ip;

      // Parse the IP address - extract the first valid public IP from comma-separated list
      let clientIP = rawIP;
      if (typeof rawIP === 'string' && rawIP.includes(',')) {
        const ips = rawIP.split(',').map(ip => ip.trim());
        const publicIP = ips.find(ip => {
          const isNotLocalhost = !ip.includes('127.0.0.1') && !ip.includes('::1') && ip !== '::ffff:127.0.0.1';
          const isNotPrivate = !ip.includes('192.168.') && !ip.includes('10.0.') && !ip.includes('10.81.');
          const isNotIPv6Local = !ip.includes('::ffff:') && !ip.includes('::1');
          const hasValidFormat = ip.length > 0 && /^\d+\.\d+\.\d+\.\d+$/.test(ip);
          return isNotLocalhost && isNotPrivate && isNotIPv6Local && hasValidFormat;
        });
        clientIP = publicIP || ips[0];
      }

      let locationData = {
        country: 'all',
        countryCode: 'all',
        city: null as string | null,
        region: null as string | null,
        lat: null as number | null,
        lng: null as number | null,
        detected: false
      };

      // 🚀 PRIORITY 1: Cloudflare headers (INSTANT - 0ms)
      const cfCountryCode = req.headers['cf-ipcountry'] as string;
      const isCloudflareRequest = !!req.headers['cf-ray']; // CF-Ray header indicates Cloudflare
      
      if (cfCountryCode && cfCountryCode !== 'XX' && cfCountryCode !== 'T1') {
        // Convert 2-letter code to full country name using existing mapping
        const countryName = CODE_TO_COUNTRY[cfCountryCode.toLowerCase()];
        if (countryName) {
          locationData = {
            country: countryName,
            countryCode: cfCountryCode.toUpperCase(),
            city: null,
            region: null,
            lat: null,
            lng: null,
            detected: true
          };
          
          return res.json({
            location: locationData,
            ip: rawIP,
            source: 'cloudflare'
          });
        }
      }

      // 🔄 FALLBACK: ip-api.com for any environment when Cloudflare detection fails
      const ipStr = typeof clientIP === 'string' ? clientIP : '';
      const isLocalhost = !ipStr || 
          ipStr === '127.0.0.1' || 
          ipStr === '::1' || 
          ipStr.includes('192.168.') || 
          ipStr.includes('10.0.') ||
          ipStr.includes('10.81.') ||
          ipStr === '::ffff:127.0.0.1';

      const cleanIP = ipStr.includes(',') ? ipStr.split(',')[0].trim() : ipStr;

      if (!isLocalhost) {
        try {
          const fetch = (await import('node-fetch')).default;
          const response = await Promise.race([
            fetch(`http://ip-api.com/json/${cleanIP}?fields=status,message,country,countryCode,region,city,lat,lon`),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 2000))
          ]) as any;
          const data = await response.json() as any;
          
          if (data && data.status === 'success') {
            locationData = {
              country: data.country,
              countryCode: data.countryCode,
              city: data.city,
              region: data.region,
              lat: data.lat,
              lng: data.lon,
              detected: true
            };
          }
        } catch (geoError: any) {
          // Silent fallback - location detection is optional
        }
      }

      res.json({
        location: locationData,
        ip: rawIP,
        source: isLocalhost ? 'localhost' : 'ip-api'
      });
    } catch (error) {
      res.json({
        location: {
          country: 'all',
          countryCode: 'all',
          city: null,
          region: null,
          lat: null,
          lng: null,
          detected: false
        },
        ip: null,
        source: 'fallback'
      });
    }
  });

  // FILTERS COUNTRIES API
  app.get("/api/filters/countries", async (req, res) => {
    try {
      const countries = await Station.distinct('country').lean();
      const filteredCountries = countries.filter(country => country && country.trim() !== '');
      res.json(filteredCountries.sort());
    } catch (error) {
      // console.error('Error fetching filter countries:', error);
      res.status(500).json({ error: 'Failed to fetch filter countries' });
    }
  });

  // FILTERS LANGUAGES API
  app.get("/api/filters/languages", async (req, res) => {
    try {
      // logger.log('🗣️ Fetching CLEAN languages with station counts...');
      
      // Get aggregated language data with counts
      const languageStats = await Station.aggregate([
        {
          $match: {
            $and: [
              { language: { $exists: true, $ne: "" } },
              { language: { $ne: null } }
            ]
          }
        },
        {
          $group: {
            _id: "$language",
            count: { $sum: 1 }
          }
        },
        {
          $match: {
            count: { $gte: 3 } // Only languages with 3+ stations
          }
        },
        {
          $sort: { count: -1 }
        }
      ]);

      // Clean up the language names - remove malformed data
      const cleanLanguages = languageStats
        .map(item => item._id)
        .filter(lang => lang && lang.trim())
        .map(lang => {
          // Clean up common issues
          lang = lang.trim();
          if (lang.startsWith('"') && lang.endsWith('"')) {
            lang = lang.slice(1, -1);
          }
          if (lang.startsWith('#')) {
            lang = lang.substring(1);
          }
          // Split multi-language entries and take first clean one
          if (lang.includes(',')) {
            lang = lang.split(',')[0].trim().replace('#', '');
          }
          return lang;
        })
        .filter(lang => lang && lang.length > 1 && lang.length < 30) // Remove very short or long entries
        .filter(lang => !lang.match(/^[^a-zA-Z]/) && !lang.includes('#')) // Remove entries starting with special chars or containing #
        .filter((lang, index, arr) => arr.indexOf(lang) === index) // Remove duplicates
        .slice(0, 50) // Limit results
        .sort();

      // logger.log(`📊 Clean Languages response: { languageCount: ${cleanLanguages.length} }`);
      res.json(cleanLanguages);
    } catch (error) {
      // console.error('Error fetching filter languages:', error);
      res.status(500).json({ error: 'Failed to fetch filter languages' });
    }
  });

  // FILTERS GENRES API
  app.get("/api/filters/genres", async (req, res) => {
    try {
      // logger.log('🎵 Fetching genres from tags field...');
      
      // Get all distinct tags from stations
      const allTags = await Station.distinct('tags').lean();
      
      // Extract unique genre values from tags (tags are comma-separated)
      const genreSet = new Set();
      
      allTags.forEach(tagString => {
        if (tagString && typeof tagString === 'string') {
          // Split comma-separated tags and clean them up
          const tags = tagString.split(',').map(tag => tag.trim().toLowerCase());
          tags.forEach(tag => {
            if (tag && tag.length > 0) {
              genreSet.add(tag);
            }
          });
        }
      });
      
      // Debug logging to see what we're getting
      logger.log('🔍 Tags debug:', { 
        totalTags: allTags.length, 
        sampleTags: allTags.slice(0, 5),
        genreCount: genreSet.size,
        sampleGenres: Array.from(genreSet).slice(0, 10)
      });
      
      // Convert to sorted array
      const genres = Array.from(genreSet).sort();
      
      // logger.log(`📊 Genres from tags:`, { genreCount: genres.length, sample: genres.slice(0, 10) });
      res.json(genres);
    } catch (error) {
      // console.error('Error fetching filter genres:', error);
      res.status(500).json({ error: 'Failed to fetch filter genres' });
    }
  });

  // Get stations by genre (for genre pages)
  app.get("/api/stations/by-genre/:genre", async (req, res) => {
    try {
      const { genre } = req.params;
      const { page = 1, limit = 20, country } = req.query;
      
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      
      let query: any = {
        $or: [
          { genre: new RegExp(genre, 'i') },
          { tags: new RegExp(genre, 'i') }
        ]
      };
      
      if (country && country !== 'All') {
        query.country = country;
      }
      
      const stations = await Station.find(query)
        .sort({ votes: -1, clickCount: -1 })
        .skip(skip)
        .limit(parseInt(limit as string))
        .lean();
        
      const total = await Station.countDocuments(query);
      
      res.json({
        stations,
        total,
        page: parseInt(page as string),
        totalPages: Math.ceil(total / parseInt(limit as string))
      });
    } catch (error) {
      // console.error('Error fetching stations by genre:', error);
      res.status(500).json({ error: 'Failed to fetch stations by genre' });
    }
  });

  // Get genre statistics for landing pages
  app.get("/api/genres/:slug/stats", async (req, res) => {
    try {
      const { slug } = req.params;
      
      // Convert slug back to genre name (replace hyphens with spaces, capitalize)
      const genreName = slug.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');
      
      // Get top countries for this genre
      const topCountries = await Station.aggregate([
        {
          $match: {
            $or: [
              { genre: new RegExp(genreName, 'i') },
              { tags: new RegExp(genreName, 'i') }
            ]
          }
        },
        {
          $group: {
            _id: "$country",
            count: { $sum: 1 },
            avgVotes: { $avg: "$votes" }
          }
        },
        {
          $match: { _id: { $nin: [null, ""] } }
        },
        {
          $sort: { count: -1 }
        },
        {
          $limit: 50
        },
        {
          $project: {
            name: "$_id",
            count: 1,
            avgVotes: { $round: ["$avgVotes", 1] }
          }
        }
      ]);

      // Get related genres based on stations that share multiple tags
      const relatedGenres = await Station.aggregate([
        {
          $match: {
            $or: [
              { genre: new RegExp(genreName, 'i') },
              { tags: new RegExp(genreName, 'i') }
            ]
          }
        },
        {
          $project: {
            tags: { $split: ["$tags", ","] }
          }
        },
        {
          $unwind: "$tags"
        },
        {
          $group: {
            _id: { $trim: { input: "$tags" } },
            count: { $sum: 1 }
          }
        },
        {
          $match: {
            _id: { 
              $ne: genreName,
              $ne: "",
              $ne: null,
              $nin: ["music", "radio", "online", "live", "stream", "station"]
            },
            count: { $gte: 5 }
          }
        },
        {
          $sort: { count: -1 }
        },
        {
          $limit: 8
        },
        {
          $project: {
            name: "$_id",
            slug: {
              $toLower: {
                $replaceAll: {
                  input: { $replaceAll: { input: "$_id", find: " ", replacement: "-" } },
                  find: "--",
                  replacement: "-"
                }
              }
            },
            count: 1
          }
        }
      ]);

      res.json({
        topCountries,
        relatedGenres
      });
    } catch (error) {
      console.error('Error fetching genre stats:', error);
      res.status(500).json({ error: 'Failed to fetch genre statistics' });
    }
  });



  // STATION CLICK TRACKING
  app.post("/api/stations/:id/click", async (req, res) => {
    try {
      const { id } = req.params;
      await Station.findByIdAndUpdate(id, {
        $inc: { clickcount: 1 },
        $set: { clickTimestamp: new Date() }
      });
      // logger.log(` Station ${id} click tracked`);
      res.json({ success: true });
    } catch (error) {
      // console.error('Error tracking station click:', error);
      res.status(500).json({ error: 'Failed to track click' });
    }
  });

  // STATION RATING SYSTEM
  // Calculate rating statistics for a station
  async function calculateStationRatingStats(stationId: string) {
    const ratings = await StationRating.find({ stationId }).lean();
    
    if (ratings.length === 0) {
      return {
        averageRating: 0,
        totalRatings: 0,
        ratingBreakdown: { stars1: 0, stars2: 0, stars3: 0, stars4: 0, stars5: 0 }
      };
    }

    const breakdown = { stars1: 0, stars2: 0, stars3: 0, stars4: 0, stars5: 0 };
    let totalScore = 0;

    for (const rating of ratings) {
      totalScore += rating.rating;
      breakdown[`stars${rating.rating}` as keyof typeof breakdown]++;
    }

    const averageRating = totalScore / ratings.length;

    return {
      averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
      totalRatings: ratings.length,
      ratingBreakdown: breakdown
    };
  }

  // Rate a station
  app.post("/api/stations/:id/rate", async (req, res) => {
    try {
      const { id: stationId } = req.params;
      const { rating, userId, sessionId } = req.body;
      let comment = req.body.comment;
      if (comment && typeof comment === 'string') {
        comment = comment.replace(/<[^>]*>/g, '').trim().slice(0, 1000);
      }

      // Validate rating
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5 stars' });
      }

      // Get user identifier and IP for duplicate prevention
      const userIdentifier = userId || sessionId;
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent');

      if (!userIdentifier && !ipAddress) {
        return res.status(400).json({ error: 'User identification required' });
      }

      // Check if station exists
      const station = await Station.findById(stationId);
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }

      // Build query for existing rating (prioritize userId, fallback to sessionId, then IP)
      let existingRatingQuery: any = { stationId };
      if (userId) {
        existingRatingQuery.userId = userId;
      } else if (sessionId) {
        existingRatingQuery.sessionId = sessionId;
      } else {
        existingRatingQuery.ipAddress = ipAddress;
      }

      // Update or create rating
      const existingRating = await StationRating.findOne(existingRatingQuery);

      let ratingDoc;
      if (existingRating) {
        // Update existing rating
        ratingDoc = await StationRating.findByIdAndUpdate(
          existingRating._id,
          { 
            rating, 
            comment: comment || undefined,
            updatedAt: new Date()
          },
          { new: true }
        );
      } else {
        // Create new rating
        ratingDoc = await StationRating.create({
          stationId,
          userId: userId || undefined,
          sessionId: sessionId || undefined,
          rating,
          comment: comment || undefined,
          ipAddress,
          userAgent,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      // Recalculate station rating statistics
      const stats = await calculateStationRatingStats(stationId);

      // Update station with new rating statistics and increment votes
      await Station.findByIdAndUpdate(stationId, {
        averageRating: stats.averageRating,
        totalRatings: stats.totalRatings,
        ratingBreakdown: stats.ratingBreakdown,
        $inc: { votes: existingRating ? 0 : 1 } // Only increment votes for new ratings
      });

      res.json({
        success: true,
        rating: ratingDoc,
        stats: {
          averageRating: stats.averageRating,
          totalRatings: stats.totalRatings,
          ratingBreakdown: stats.ratingBreakdown,
          votes: station.votes + (existingRating ? 0 : 1)
        }
      });

    } catch (error) {
      console.error('Error rating station:', error);
      res.status(500).json({ error: 'Failed to rate station' });
    }
  });

  // Get station ratings
  app.get("/api/stations/:id/ratings", async (req, res) => {
    try {
      const { id: stationId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      const ratings = await StationRating.find({ stationId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      for (const r of ratings as any[]) {
        if (r.comment && typeof r.comment === 'string') {
          r.comment = r.comment.replace(/<[^>]*>/g, '').trim();
        }
      }

      // Get total count
      const total = await StationRating.countDocuments({ stationId });

      // Calculate statistics
      const stats = await calculateStationRatingStats(stationId);

      res.json({
        ratings,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        stats
      });

    } catch (error) {
      console.error('Error fetching station ratings:', error);
      res.status(500).json({ error: 'Failed to fetch ratings' });
    }
  });

  // Vote for a station - increments vote count by 1
  app.post("/api/stations/:id/vote", async (req, res) => {
    try {
      const { id: stationId } = req.params;
      
      // Find station and increment votes
      const station = await Station.findByIdAndUpdate(
        stationId,
        { $inc: { votes: 1 } },
        { new: true }
      );
      
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }
      
      res.json({
        success: true,
        votes: station.votes
      });
      
    } catch (error) {
      console.error('Error voting for station:', error);
      res.status(500).json({ error: 'Failed to vote for station' });
    }
  });

  // Get user's rating for a specific station
  app.get("/api/stations/:id/user-rating", async (req, res) => {
    try {
      const { id: stationId } = req.params;
      let { userId, sessionId } = req.query;

      // Gracefully handle missing parameters - return null rating instead of 400
      if (!userId && !sessionId) {
        return res.json({ rating: null });
      }

      // Ensure userId and sessionId are strings (not arrays from query params)
      if (Array.isArray(userId)) userId = userId[0];
      if (Array.isArray(sessionId)) sessionId = sessionId[0];

      // Build query
      let query: any = { stationId };
      if (userId && typeof userId === 'string') {
        query.userId = userId;
      } else if (sessionId && typeof sessionId === 'string') {
        query.sessionId = sessionId;
      }

      const rating = await StationRating.findOne(query).lean();

      res.json({ rating: rating || null });

    } catch (error) {
      console.error('Error fetching user rating:', error);
      res.json({ rating: null }); // Graceful fallback instead of 500
    }
  });

  // ENSURE USER PROFILE IS PUBLIC (for testing purposes)
  app.post("/api/test/make-user-public", async (req, res) => {
    try {
      const { email } = req.body;
      // logger.log(' Making user profile public for testing:', email);
      
      const user = await User.findOneAndUpdate(
        { email: email },
        { 
          isPublicProfile: true,
          name: email.split('@')[0] // Use email prefix as name if no name set
        },
        { new: true }
      );
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // logger.log(' User profile set to public:', user.email);
      res.json({ message: 'User profile is now public', user: { email: user.email, isPublicProfile: user.isPublicProfile } });
    } catch (error) {
      // console.error('Error making user public:', error);
      res.status(500).json({ error: 'Failed to update user profile' });
    }
  });

  // ADD FAVORITES FOR USER (for testing purposes)
  app.post("/api/test/add-favorites", async (req, res) => {
    try {
      const { email, stationIds } = req.body;
      // logger.log(' Adding favorites for user:', email, 'stations:', stationIds);
      
      const user = await User.findOneAndUpdate(
        { email: email },
        { 
          $addToSet: { favoriteStations: { $each: stationIds } },
          isPublicProfile: true,
          name: email.split('@')[0]
        },
        { new: true, upsert: true }
      );
      
      // logger.log(' Added favorites to user:', user.email, 'total favorites:', user.favoriteStations.length);
      res.json({ 
        message: 'Favorites added successfully', 
        user: { 
          email: user.email, 
          favoriteStations: user.favoriteStations,
          isPublicProfile: user.isPublicProfile 
        } 
      });
    } catch (error) {
      // console.error('Error adding favorites:', error);
      res.status(500).json({ error: 'Failed to add favorites' });
    }
  });

  // UPDATE USER NAME (for fixing user profiles)
  app.post("/api/test/update-user-name", async (req, res) => {
    try {
      const { email, name } = req.body;
      // logger.log(' Updating user name:', email, 'to:', name);
      
      const user = await User.findOneAndUpdate(
        { email: email },
        { name: name },
        { new: true }
      );
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // logger.log(' Updated user name:', user.email, 'name:', user.name);
      res.json({ 
        message: 'User name updated successfully', 
        user: { 
          email: user.email, 
          name: user.name,
          isPublicProfile: user.isPublicProfile 
        } 
      });
    } catch (error) {
      // console.error('Error updating user name:', error);
      res.status(500).json({ error: 'Failed to update user name' });
    }
  });

  // DEBUG USER STATUS (for testing purposes)
  app.get("/api/test/user-status/:email", async (req, res) => {
    try {
      const { email } = req.params;
      // logger.log(' Checking user status for:', email);
      
      const user = await User.findOne({ email: email });
      
      if (!user) {
        // logger.log(' User not found:', email);
        return res.json({ found: false, message: 'User not found' });
      }
      
      // logger.log(' User found:', { email: user.email, isPublicProfile: user.isPublicProfile, favoriteStationsCount: user.favoriteStations?.length || 0, name: user.name });
      
      res.json({ 
        found: true,
        user: {
          _id: user._id,
          email: user.email,
          name: user.name,
          isPublicProfile: user.isPublicProfile,
          favoriteStations: user.favoriteStations,
          favoriteStationsCount: user.favoriteStations?.length || 0
        }
      });
    } catch (error) {
      // console.error('Error checking user status:', error);
      res.status(500).json({ error: 'Failed to check user status' });
    }
  });

  // GET USER PROFILE BY ID OR SLUG
  app.get("/api/user-profile/:idOrSlug", async (req, res) => {
    try {
      const { idOrSlug } = req.params;
      // logger.log(' Fetching user profile for ID/Slug:', idOrSlug);
      
      let user;
      
      // Check if it's a MongoDB ObjectId (24 hex characters)
      if (/^[0-9a-fA-F]{24}$/.test(idOrSlug)) {
        user = await User.findById(idOrSlug);
      } else {
        // Treat as slug
        user = await User.findOne({ slug: idOrSlug });
      }
      
      if (!user) {
        // logger.log(' User not found:', idOrSlug);
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Calculate ACTUAL follower and following counts from UserFollow collection
      const actualFollowersCount = await UserFollow.countDocuments({ followingUserId: user._id });
      const actualFollowingCount = await UserFollow.countDocuments({ userId: user._id });
      
      // Get correct favorites count from UserFavorite collection
      const actualFavoritesCount = await UserFavorite.countDocuments({ userId: user._id });
      
      // Sync the user document if counts are incorrect
      const needsUpdate = user.followersCount !== actualFollowersCount || user.followingCount !== actualFollowingCount;
      if (needsUpdate) {
        // logger.log(` Syncing user ${user._id} counts: followers ${user.followersCount} -> ${actualFollowersCount}, following ${user.followingCount} -> ${actualFollowingCount}`);
        await User.findByIdAndUpdate(user._id, {
          followersCount: actualFollowersCount,
          followingCount: actualFollowingCount
        });
      }
      
      // Only return public profile data
      const profileData = {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        name: user.name, // Keep name for backward compatibility
        isPublicProfile: user.isPublicProfile,
        favoriteStations: user.favoriteStations || [],
        favoriteStationsCount: actualFavoritesCount, // Use correct count from UserFavorite collection
        recentlyPlayedStations: user.recentlyPlayedStations || [],
        createdAt: user.createdAt,
        playAtLogin: user.playAtLogin,
        theme: user.theme,
        language: user.language,
        autoplay: user.autoplay,
        volume: user.volume,
        followersCount: actualFollowersCount, // Always return the ACTUAL count
        followingCount: actualFollowingCount
      };
      
      // logger.log(' User profile found:', { id, isPublic: user.isPublicProfile, actualFavoritesCount, actualFollowersCount, fullName: user.fullName });
      res.json(profileData);
    } catch (error) {
      // console.error('Error fetching user profile:', error);
      res.status(500).json({ error: 'Failed to fetch user profile' });
    }
  });

  // REMOVED: Conflicting route for favorites that only handled MongoDB IDs
  // Using slug-capable route instead which is defined further below

  // GET COMMUNITY FAVORITES - Most-favorited stations across all users (Public)
  app.get("/api/community-favorites", async (req, res) => {
    try {
      const { country } = req.query;
      const cacheKey = `community_favorites:${country || 'all'}:all:20`;
      
      // Try cache first
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }
      
      // If not cached, refresh and return
      await refreshCommunityFavoritesCache(country as string | undefined);
      const data = await CacheManager.get(cacheKey);
      res.json(data || []);
    } catch (error) {
      logger.log('Error fetching community favorites:', error);
      res.status(500).json({ error: 'Failed to fetch community favorites' });
    }
  });

  // GET CURRENT USER'S FAVORITE STATIONS (Authenticated)
  app.get("/api/user/favorites", requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;
      const sortQuery = (req.query.sort as string) || 'newest';
      const page = parseInt(req.query.page as string) || 0;
      const limit = Math.min(parseInt(req.query.limit as string) || 0, 100);
      const fieldsParam = (req.query.fields as string) || '';
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      let sortStage: any = { favoritedAt: -1 };
      switch (sortQuery) {
        case 'oldest':
          sortStage = { favoritedAt: 1 };
          break;
        case 'name':
          sortStage = { name: 1 };
          break;
        case 'country':
          sortStage = { name: -1 };
          break;
        case 'newest':
        default:
          sortStage = { favoritedAt: -1 };
          break;
      }

      const allFields: Record<string, string> = {
        _id: '$station._id',
        name: '$station.name',
        url: '$station.url',
        country: '$station.country',
        genre: '$station.genre',
        tags: '$station.tags',
        votes: '$station.votes',
        clickCount: '$station.clickCount',
        codec: '$station.codec',
        bitrate: '$station.bitrate',
        favicon: '$station.favicon',
        homepage: '$station.homepage',
        iso_3166_1: '$station.iso_3166_1',
        language: '$station.language',
        languagecodes: '$station.languagecodes',
        lastcheckok: '$station.lastcheckok',
        lastchecktime: '$station.lastchecktime',
        lastcheckoktime: '$station.lastcheckoktime',
        clicktimestamp: '$station.clicktimestamp',
        urlResolved: '$station.urlResolved',
        ssl_error: '$station.ssl_error',
        geo_lat: '$station.geo_lat',
        geo_long: '$station.geo_long',
        has_extended_info: '$station.has_extended_info',
        slug: '$station.slug',
        createdAt: '$station.createdAt',
        updatedAt: '$station.updatedAt',
        favoritedAt: '$createdAt'
      };

      let projectStage: Record<string, any>;
      if (fieldsParam) {
        const requestedFields = fieldsParam.split(',').map(f => f.trim());
        projectStage = { _id: '$station._id', favoritedAt: '$createdAt' };
        for (const field of requestedFields) {
          if (allFields[field]) {
            projectStage[field] = allFields[field];
          }
        }
      } else {
        projectStage = allFields;
      }

      const pipeline: any[] = [
        { $match: { userId: currentUserId } },
        {
          $addFields: {
            stationObjectId: { 
              $cond: {
                if: { $type: '$stationId' },
                then: { 
                  $cond: {
                    if: { $eq: [{ $type: '$stationId' }, 'objectId'] },
                    then: '$stationId',
                    else: { $toObjectId: '$stationId' }
                  }
                },
                else: null
              }
            }
          }
        },
        {
          $lookup: {
            from: 'stations',
            localField: 'stationObjectId',
            foreignField: '_id',
            as: 'station'
          }
        },
        { $unwind: { path: '$station', preserveNullAndEmptyArrays: true } },
        { $match: { 'station': { $exists: true, $ne: null } } },
        { $project: projectStage },
        { $sort: sortStage }
      ];

      if (page > 0 && limit > 0) {
        const totalFavorites = await UserFavorite.countDocuments({ userId: currentUserId });
        const skip = (page - 1) * limit;
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: limit });

        const favorites = await UserFavorite.aggregate(pipeline);
        const stations = favorites.map(station => ({
          ...station,
          clickcount: station.clickCount || 0
        }));

        return res.json({
          stations: stripPlaceholders(stations),
          pagination: {
            page,
            limit,
            total: totalFavorites,
            totalPages: Math.ceil(totalFavorites / limit)
          }
        });
      }

      const favorites = await UserFavorite.aggregate(pipeline);
      const stations = favorites.map(station => ({
        ...station,
        clickcount: station.clickCount || 0
      }));
      
      res.json(stripPlaceholders(stations));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch favorites' });
    }
  });

  // GET RECENTLY PLAYED STATIONS (returns [] silently for anonymous — no console-noise 401)
  app.get("/api/recently-played", async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.user?.userId || (req.session as any)?.userId;
      if (!currentUserId) return res.json([]);

      const cacheKey = `recently-played:${currentUserId}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) return res.json(cached);

      const user = await User.findById(currentUserId).select('recentlyPlayedStations').lean();
      if (!user || !user.recentlyPlayedStations || user.recentlyPlayedStations.length === 0) {
        return res.json([]);
      }

      const recentEntries = user.recentlyPlayedStations;
      const stationIds = recentEntries.map((entry: any) => {
        const id = entry.stationId || entry;
        try { return new mongoose.Types.ObjectId(id.toString()); } catch { return id; }
      });
      const stations = await Station.find({
        _id: { $in: stationIds }
      }).select('name slug country votes url urlResolved codec bitrate favicon homepage tags lastCheckOk logoAssets').lean();

      const stationMap = new Map(stations.map(s => [s._id.toString(), s]));
      const orderedStations = recentEntries
        .map((entry: any) => {
          const id = (entry.stationId || entry).toString();
          const station = stationMap.get(id);
          if (!station) return null;
          return { ...station, playedAt: entry.playedAt || null };
        })
        .filter(Boolean);

      const result = stripPlaceholders(orderedStations);
      await CacheManager.set(cacheKey, result, { ttl: 300 });
      res.json(result);
    } catch (error) {
      console.error('Error fetching recently played:', error);
      res.status(500).json({ error: 'Failed to fetch recently played' });
    }
  });

  app.post("/api/recently-played", async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.user?.userId || (req.session as any)?.userId;
      if (!currentUserId) return res.status(204).end();
      const { stationId } = req.body;
      
      if (!stationId) {
        return res.status(400).json({ error: 'Station ID is required' });
      }

      if (isQuotaExceeded()) {
        return res.status(503).json({ error: 'Database temporarily unavailable' });
      }

      const station = await Station.findById(stationId);
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }

      const pullResult = await safeWrite('recently-played:pull', () =>
        User.findByIdAndUpdate(currentUserId, {
          $pull: { recentlyPlayedStations: { stationId: stationId } }
        })
      );
      if (pullResult === null && isQuotaExceeded()) {
        return res.status(503).json({ error: 'Database temporarily unavailable' });
      }

      await safeWrite('recently-played:push', () =>
        User.findByIdAndUpdate(currentUserId, {
          $push: {
            recentlyPlayedStations: {
              $each: [{ stationId: stationId, playedAt: new Date() }],
              $position: 0,
              $slice: 12
            }
          }
        })
      );

      await CacheManager.clearByPattern(`recently-played:${currentUserId}`);
      res.json({ success: true });
    } catch (error: any) {
      handleQuotaError('recently-played', error);
      if (isQuotaError(error)) {
        return res.status(503).json({ error: 'Database temporarily unavailable' });
      }
      res.status(500).json({ error: 'Failed to add to recently played' });
    }
  });

  // ADD STATION TO CURRENT USER'S FAVORITES (Authenticated)
  app.post("/api/user/favorites", requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;
      const { stationId } = req.body;
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      
      if (!stationId) {
        return res.status(400).json({ error: 'Station ID is required' });
      }

      if (isQuotaExceeded()) {
        return res.status(503).json({ error: 'Database temporarily unavailable' });
      }

      const station = await Station.findById(stationId);
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }

      const existingFavorite = await UserFavorite.findOne({
        userId: currentUserId,
        stationId: stationId
      });

      if (existingFavorite) {
        return res.status(400).json({ error: 'Station already in favorites' });
      }

      const favorite = await safeWrite('favorites:create', () =>
        UserFavorite.create({
          userId: currentUserId,
          stationId: stationId,
          createdAt: new Date()
        })
      );

      if (favorite === null && isQuotaExceeded()) {
        return res.status(503).json({ error: 'Database temporarily unavailable' });
      }

      await safeWrite('favorites:notification', () =>
        UserNotification.create({
          userId: currentUserId,
          type: 'favorite_station',
          title: '🌟 Station Added to Favorites',
          message: `You added "${station.name}" to your favorites`,
          data: { 
            stationId: station._id,
            stationName: station.name,
            stationCountry: station.country,
            stationGenre: station.genre
          },
          read: false,
          createdAt: new Date()
        }),
        true
      );

      await CacheManager.clearByPattern(`user-favorites:${currentUserId}`);
      res.json({ success: true, message: 'Station added to favorites', favorite });
    } catch (error: any) {
      handleQuotaError('favorites', error);
      if (isQuotaError(error)) {
        return res.status(503).json({ error: 'Database temporarily unavailable' });
      }
      res.status(500).json({ error: 'Failed to add station to favorites' });
    }
  });

  // REMOVE STATION FROM CURRENT USER'S FAVORITES (Authenticated)
  app.delete("/api/user/favorites/:stationId", requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;
      const { stationId } = req.params;
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // logger.log(`🗑️ Removing station ${stationId} from favorites for user ${currentUserId}`);
      
      // Remove from favorites
      const deleted = await UserFavorite.findOneAndDelete({
        userId: currentUserId,
        stationId: stationId
      });

      if (!deleted) {
        return res.status(404).json({ error: 'Station not in favorites' });
      }

      // Get station info for notification
      const station = await Station.findById(stationId).select('name country genre');
      
      // Create notification for the user about removing favorite
      if (station) {
        await UserNotification.create({
          userId: currentUserId,
          type: 'system',
          title: '💔 Station Removed from Favorites',
          message: `You removed "${station.name}" from your favorites`,
          data: { 
            stationId: stationId,
            stationName: station.name,
            stationCountry: station.country,
            stationGenre: station.genre
          },
          read: false,
          createdAt: new Date()
        });
      }

      await CacheManager.clearByPattern(`user-favorites:${currentUserId}`);
      res.json({ success: true, message: 'Station removed from favorites' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to remove station from favorites' });
    }
  });

  // CHECK IF STATION IS IN CURRENT USER'S FAVORITES (Authenticated)
  app.get("/api/user/favorites/check/:stationId", requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;
      const { stationId } = req.params;
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const isFavorited = await UserFavorite.exists({
        userId: currentUserId,
        stationId: stationId
      });

      res.json({ isFavorited: !!isFavorited });
    } catch (error) {
      // console.error('Error checking favorite status:', error);
      res.status(500).json({ error: 'Failed to check favorite status' });
    }
  });

  // GET CURRENT USER'S NOTIFICATIONS (Authenticated)
  app.get("/api/user/notifications", async (req, res) => {
    try {
      let currentUserId = (req.session as any)?.userId || (req.session as any)?.user?.userId;
      if (!currentUserId) {
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (bearerToken) {
          const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } }).lean();
          if (tokenDoc) currentUserId = tokenDoc.userId?.toString();
        }
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const cacheKey = `notifications:${currentUserId}:${page}:${limit}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) return res.json(cached);

      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const dateFilter = {
        userId: currentUserId,
        $or: [
          { type: { $in: ['new_station', 'follow'] }, createdAt: { $gte: tenDaysAgo } },
          { type: 'new_message', createdAt: { $gte: sevenDaysAgo } }
        ]
      };

      const [notifications, totalCount, unreadCount] = await Promise.all([
        UserNotification.find(dateFilter)
          .populate('fromUserId', 'fullName username avatar profileImageUrl')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        UserNotification.countDocuments(dateFilter),
        UserNotification.countDocuments({
          userId: currentUserId,
          $or: [
            { type: { $in: ['new_station', 'follow'] }, createdAt: { $gte: tenDaysAgo }, read: false },
            { type: 'new_message', createdAt: { $gte: sevenDaysAgo }, read: false }
          ]
        })
      ]);

      const mappedNotifications = notifications.map(n => ({
        ...n,
        isRead: n.read
      }));

      const result = {
        notifications: mappedNotifications,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        },
        unreadCount
      };
      await CacheManager.set(cacheKey, result, { ttl: 15 });
      res.json(result);
    } catch (error) {
      // console.error('Error fetching user notifications:', error);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  // MARK NOTIFICATION AS READ (Authenticated)
  app.patch("/api/user/notifications/:id/read", async (req, res) => {
    try {
      let currentUserId = (req.session as any)?.userId || (req.session as any)?.user?.userId;
      if (!currentUserId) {
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (bearerToken) {
          const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } }).lean();
          if (tokenDoc) currentUserId = tokenDoc.userId?.toString();
        }
      }
      const notificationId = req.params.id;
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const notification = await UserNotification.findOneAndUpdate(
        { _id: notificationId, userId: currentUserId },
        { read: true },
        { new: true }
      );

      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      // logger.log(`📖 Marked notification ${notificationId} as read for user ${currentUserId}`);
      res.json({ success: true, notification });
    } catch (error) {
      // console.error('Error marking notification as read:', error);
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  });

  // MARK ALL NOTIFICATIONS AS READ (Authenticated)
  app.patch("/api/user/notifications/read-all", async (req, res) => {
    try {
      let currentUserId = (req.session as any)?.userId || (req.session as any)?.user?.userId;
      if (!currentUserId) {
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (bearerToken) {
          const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } }).lean();
          if (tokenDoc) currentUserId = tokenDoc.userId?.toString();
        }
      }
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const result = await UserNotification.updateMany(
        { userId: currentUserId, read: false },
        { read: true }
      );

      // logger.log(`📖 Marked ${result.modifiedCount} notifications as read for user ${currentUserId}`);
      res.json({ success: true, markedCount: result.modifiedCount });
    } catch (error) {
      // console.error('Error marking all notifications as read:', error);
      res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
  });

  // GET USER PROFILE BY ID (for public profiles)
  app.get("/api/user-profile/:id", async (req, res) => {
    try {
      const { id } = req.params;
      
      const user = await User.findById(id);
      
      if (!user || !user.isPublicProfile) {
        return res.status(404).json({ error: 'User not found or profile is private' });
      }

      // Return user profile in expected format
      const profile = {
        _id: user._id,
        name: user.fullName || user.name || user.email?.split('@')[0] || 'User',
        fullName: user.fullName,
        email: user.email,
        profileImageUrl: user.profileImageUrl,
        isPublicProfile: user.isPublicProfile,
        createdAt: user.createdAt,
        followersCount: 0, // Default for now
        followingCount: 0  // Default for now
      };

      res.json(profile);
    } catch (error) {
      console.error('Error fetching user profile:', error);
      res.status(500).json({ error: 'Failed to fetch user profile' });
    }
  });

  // Admin endpoint to fix specific user with debug info
  app.post("/api/admin/fix-user/:userId", requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findById(userId);
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      logger.log('🔧 Fixing user:', user.fullName, 'Email:', user.email);
      logger.log('🔍 User object fields:', { 
        fullName: user.fullName, 
        username: user.username, 
        name: user.name, 
        email: user.email 
      });

      const updateData: any = {};
      
      // Set profile as public
      updateData.isPublicProfile = true;
      
      // Generate slug manually to fix the issue
      const generateSlug = (text: string): string => {
        return text
          .toLowerCase()
          .replace(/[^\w\s-]/g, '') 
          .replace(/\s+/g, '') // Remove spaces completely for "sahinyogurtcu" format
          .replace(/-+/g, '-') 
          .trim()
          .replace(/^-+|-+$/g, '');
      };

      let slugSource = user.fullName || user.username || user.name || user.email?.split('@')[0] || 'user';
      updateData.slug = generateSlug(slugSource);
      logger.log(`✅ Generated slug from "${slugSource}": ${updateData.slug}`);
      
      logger.log('🔧 About to update user with data:', updateData);
      const updatedUser = await User.findByIdAndUpdate(user._id, updateData, { new: true });
      logger.log('✅ User updated successfully. Full user object:');
      logger.log('  - _id:', updatedUser?._id);
      logger.log('  - fullName:', updatedUser?.fullName);
      logger.log('  - slug:', updatedUser?.slug);
      logger.log('  - isPublicProfile:', updatedUser?.isPublicProfile);
      
      // Sync favorites
      await syncUserFavorites();

      res.json({ 
        success: true, 
        message: `Fixed user ${user.fullName || user.email}`,
        newSlug: updateData.slug
      });
    } catch (error) {
      console.error('Error fixing user:', error);
      res.status(500).json({ error: 'Failed to fix user' });
    }
  });

  // Admin endpoint to fix user profiles (make public + generate slugs)
  app.post("/api/admin/fix-user-profiles", requireAdmin, async (req, res) => {
    try {
      // Get all users without public profiles or with ID-based slugs
      const users = await User.find({
        $or: [
          { isPublicProfile: { $ne: true } },
          { slug: { $exists: false } },
          { slug: { $regex: /^[0-9a-fA-F]{24}$/ } } // MongoDB ID pattern
        ]
      });

      let fixedCount = 0;
      for (const user of users) {
        const updateData: any = {};
        
        // Set profile as public
        if (!user.isPublicProfile) {
          updateData.isPublicProfile = true;
        }
        
        // Generate slug if missing or if it's a MongoDB ID
        if (!user.slug || /^[0-9a-fA-F]{24}$/.test(user.slug)) {
          updateData.slug = await generateUserSlug(user, user._id);
        }
        
        if (Object.keys(updateData).length > 0) {
          await User.findByIdAndUpdate(user._id, updateData);
          fixedCount++;
        }
      }

      // Also sync favorites to fix the favorites display issue
      await syncUserFavorites();

      res.json({ 
        success: true, 
        message: `Fixed ${fixedCount} user profiles and synced favorites`,
        totalUsers: users.length
      });
    } catch (error) {
      console.error('Error fixing user profiles:', error);
      res.status(500).json({ error: 'Failed to fix user profiles' });
    }
  });

  // GET USER'S FAVORITE STATIONS BY ID OR SLUG (for public profiles)
  app.get("/api/users/:idOrSlug/favorites", async (req, res) => {
    try {
      const { idOrSlug } = req.params;
      const page = parseInt(req.query.page as string) || 0;
      const limit = Math.min(parseInt(req.query.limit as string) || 0, 100);
      const fieldsParam = (req.query.fields as string) || '';
      
      let user;
      if (/^[0-9a-fA-F]{24}$/.test(idOrSlug)) {
        user = await User.findById(idOrSlug).select('_id').lean();
      } else {
        user = await User.findOne({ slug: idOrSlug }).select('_id').lean();
      }
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const userId = user._id.toString();
      const usePagination = page > 0 && limit > 0;
      const cacheKey = `user-favorites:${userId}:p${page}:l${limit}:f${fieldsParam}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const defaultMobileFields: Record<string, string> = {
        _id: '$station._id',
        name: '$station.name',
        favicon: '$station.favicon',
        country: '$station.country',
        slug: '$station.slug',
        url: '$station.url',
        genre: '$station.genre',
        tags: '$station.tags',
        votes: '$station.votes',
        codec: '$station.codec',
        bitrate: '$station.bitrate',
        language: '$station.language',
        iso_3166_1: '$station.iso_3166_1',
        urlResolved: '$station.urlResolved',
        lastcheckok: '$station.lastcheckok',
        clickCount: '$station.clickCount',
        favoritedAt: '$createdAt'
      };

      let projectStage: Record<string, any>;
      if (fieldsParam) {
        const requested = fieldsParam.split(',').map(f => f.trim());
        projectStage = { _id: '$station._id', favoritedAt: '$createdAt' };
        for (const field of requested) {
          if (defaultMobileFields[field]) {
            projectStage[field] = defaultMobileFields[field];
          }
        }
      } else {
        projectStage = defaultMobileFields;
      }

      const pipeline: any[] = [
        { $match: { userId } },
        { $sort: { createdAt: -1 as const } },
      ];

      if (usePagination) {
        pipeline.push({ $skip: (page - 1) * limit });
        pipeline.push({ $limit: limit });
      }

      pipeline.push(
        {
          $addFields: {
            stationObjectId: { $toObjectId: '$stationId' }
          }
        },
        {
          $lookup: {
            from: 'stations',
            localField: 'stationObjectId',
            foreignField: '_id',
            as: 'station'
          }
        },
        { $match: { 'station.0': { $exists: true } } },
        { $unwind: '$station' },
        { $project: projectStage }
      );

      const [stations, totalCount] = await Promise.all([
        UserFavorite.aggregate(pipeline),
        usePagination ? UserFavorite.countDocuments({ userId }) : Promise.resolve(0)
      ]);

      let result: any;
      if (usePagination) {
        result = {
          stations,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit)
          }
        };
      } else {
        result = stations;
      }

      CacheManager.set(cacheKey, result, { ttl: 120 });
      res.json(result);
    } catch (error) {
      console.error('Error fetching user favorites:', error);
      res.status(500).json({ error: 'Failed to fetch user favorites' });
    }
  });

  // GET USER'S RECENTLY PLAYED STATIONS
  app.get("/api/users/:id/recent", async (req, res) => {
    try {
      const { id } = req.params;
      // Fetching recent plays for user
      
      const user = await User.findById(id);
      
      if (!user || !user.isPublicProfile) {
        return res.status(404).json({ error: 'User not found or profile is private' });
      }
      
      if (!user.recentlyPlayedStations || user.recentlyPlayedStations.length === 0) {
        return res.json([]);
      }
      
      const recentEntries = user.recentlyPlayedStations;
      const stationIds = recentEntries.map((entry: any) => {
        const id = entry.stationId || entry;
        try { return new mongoose.Types.ObjectId(id.toString()); } catch { return id; }
      });
      const stations = await Station.find({
        _id: { $in: stationIds }
      }).select({
        name: 1,
        url: 1,
        country: 1,
        genre: 1,
        tags: 1,
        votes: 1,
        clickCount: 1,
        codec: 1,
        bitrate: 1,
        favicon: 1,
        homepage: 1,
        language: 1,
        slug: 1
      }).lean();
      
      const stationMap = new Map(stations.map(s => [s._id.toString(), s]));
      const orderedStations = recentEntries
        .map((entry: any) => {
          const id = (entry.stationId || entry).toString();
          const station = stationMap.get(id);
          if (!station) return null;
          return { ...station, playedAt: entry.playedAt || null };
        })
        .filter(Boolean);
      
      res.json(orderedStations);
    } catch (error) {
      // console.error('Error fetching user recent plays:', error);
      res.status(500).json({ error: 'Failed to fetch recent plays' });
    }
  });

  // PUBLIC PROFILES API - 24-HOUR CACHE for Community Favorites section
  app.get("/api/public-profiles", async (req, res) => {
    try {
      // Check cache first - 24 hours TTL (public profiles rarely change)
      const cacheKey = 'public_profiles:v4';
      const cachedData = await CacheManager.get(cacheKey);
      if (cachedData) {
        return res.json({ data: cachedData });
      }

      // Step 1: Get all public users (same as original)
      const users = await User.find({ 
        $or: [
          { isPublicProfile: true },
          { isPublic: true },
          { slug: 'sahinyogurtcu' }
        ]
      }).lean();

      if (users.length === 0) {
        // Cache empty result for shorter time
        await CacheManager.set(cacheKey, [], { ttl: 30 });
        return res.json({ data: [] });
      }

      // Step 2: Batch fetch ALL favorites at once (NOT in a loop!)
      const userIds = users.map(u => u._id.toString());
      const allFavorites = await UserFavorite.find({ 
        userId: { $in: userIds } 
      }).lean();

      // Early return if no favorites found
      if (allFavorites.length === 0) {
        await CacheManager.set(cacheKey, [], { ttl: 30 });
        return res.json({ data: [] });
      }

      // Step 3: Get all station IDs and fetch stations in one query
      const allStationIds = [...new Set(allFavorites.map(f => f.stationId))];
      const allStations = await Station.find({ 
        _id: { $in: allStationIds } 
      }).select('_id').lean();

      // Step 4: Create a map for quick lookups
      const stationExistsMap = new Set(allStations.map(s => s._id.toString()));
      const userFavoritesMap = {};

      // Step 5: Process favorites efficiently
      allFavorites.forEach(fav => {
        const userId = fav.userId;
        if (!userFavoritesMap[userId]) {
          userFavoritesMap[userId] = [];
        }
        if (stationExistsMap.has(fav.stationId)) {
          userFavoritesMap[userId].push(fav.stationId);
        }
      });

      // Step 6: Build profiles array with favorite counts
      const publicProfiles = users
        .map(user => {
          const userId = user._id.toString();
          const favoriteCount = userFavoritesMap[userId]?.length || 0;
          
          // Skip users with no valid favorites
          if (favoriteCount === 0) {
            return null;
          }

          // Determine display name (same logic as original)
          let displayName = user.fullName || user.name;
          if (!displayName && user.email) {
            displayName = user.email.split('@')[0];
          }

          return {
            _id: user._id,
            name: displayName,
            email: user.email,
            profileImageUrl: user.avatar || user.profileImageUrl,
            favorites_count: favoriteCount,
            isPublicProfile: user.isPublicProfile,
            slug: user.slug
          };
        })
        .filter(Boolean) // Remove null entries (users with no favorites)
        .sort((a, b) => b.favorites_count - a.favorites_count); // Sort by favorites descending
      
      // Prioritize users with profile photos (any photo, not just randomuser.me)
      // Real photos: Google OAuth avatars, uploaded photos, or randomuser.me
      const withPhotos = publicProfiles.filter(p => p.profileImageUrl && p.profileImageUrl.trim() !== '');
      const withoutPhotos = publicProfiles.filter(p => !p.profileImageUrl || p.profileImageUrl.trim() === '');
      
      // Sort photo users by favorites count descending
      withPhotos.sort((a, b) => b.favorites_count - a.favorites_count);
      withoutPhotos.sort((a, b) => b.favorites_count - a.favorites_count);
      
      // Final result: users with photos first, then others
      const finalProfiles = [...withPhotos, ...withoutPhotos].slice(0, 70);

      // Cache the results for 1 hour
      await CacheManager.set(cacheKey, finalProfiles, { ttl: 3600 });

      res.json({ data: finalProfiles });
    } catch (error) {
      console.error('Error fetching public profiles:', error);
      res.status(500).json({ error: 'Failed to fetch public profiles' });
    }
  });



  // LANGUAGES API - with station counts
  app.get("/api/languages", async (req, res) => {
    try {
      // Fetching languages with station counts
      
      // Get languages with station counts using aggregation
      const languageStats = await Station.aggregate([
        {
          $match: {
            $and: [
              { language: { $exists: true, $ne: "" } },
              { language: { $ne: null } }
            ]
          }
        },
        {
          $group: {
            _id: "$language",
            stationCount: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 1,
            name: "$_id",
            code: { $toLower: "$_id" },
            stationCount: 1
          }
        },
        {
          $sort: { stationCount: -1 }
        },
        {
          $limit: 100
        }
      ]);

      // Found languages with station data
      res.json(languageStats);
    } catch (error) {
      // console.error('Error fetching languages:', error);
      res.status(500).json({ error: 'Failed to fetch languages' });
    }
  });

  // CODECS API - with station counts
  app.get("/api/codecs", async (req, res) => {
    try {
      // Fetching codecs with station counts
      
      // Get codecs with station counts using aggregation
      const codecStats = await Station.aggregate([
        {
          $match: {
            $and: [
              { codec: { $exists: true, $ne: "" } },
              { codec: { $ne: null } }
            ]
          }
        },
        {
          $group: {
            _id: "$codec",
            stationCount: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 1,
            name: "$_id",
            stationCount: 1
          }
        },
        {
          $sort: { stationCount: -1 }
        },
        {
          $limit: 50
        }
      ]);

      // logger.log(` Found ${codecStats.length} codecs with stations`);
      res.json(codecStats);
    } catch (error) {
      // console.error('Error fetching codecs:', error);
      res.status(500).json({ error: 'Failed to fetch codecs' });
    }
  });

  // RADIO BROWSER API ENDPOINTS - Direct integration with Radio-Browser.info API
  
  // Import the Radio Browser service
  let radioBrowserService: any;
  import('../services/radio-browser').then(module => {
    radioBrowserService = module.radioBrowserService;
  });

  // Get Radio Browser API stats
  app.get("/api/radio-browser/stats", async (req, res) => {
    try {
      if (!radioBrowserService) {
        return res.status(503).json({ error: 'Radio Browser service not available yet' });
      }
      
      // logger.log(' Fetching Radio Browser API stats...');
      const stats = await radioBrowserService.getStats();
      res.json(stats);
    } catch (error) {
      // console.error('Error fetching Radio Browser stats:', error);
      res.status(500).json({ error: 'Failed to fetch Radio Browser stats' });
    }
  });

  // Get top clicked stations from Radio Browser API
  app.get("/api/radio-browser/top-clicked", async (req, res) => {
    try {
      if (!radioBrowserService) {
        return res.status(503).json({ error: 'Radio Browser service not available yet' });
      }
      
      const { limit = 100 } = req.query;
      // logger.log('🔥 Fetching top ${limit} clicked stations from Radio Browser API...');
      
      const stations = await radioBrowserService.getTopClickedStations(Number(limit));
      res.json({ stations });
    } catch (error) {
      // console.error('Error fetching top clicked stations:', error);
      res.status(500).json({ error: 'Failed to fetch top clicked stations' });
    }
  });

  // Get top voted stations from Radio Browser API
  app.get("/api/radio-browser/top-voted", async (req, res) => {
    try {
      if (!radioBrowserService) {
        return res.status(503).json({ error: 'Radio Browser service not available yet' });
      }
      
      const { limit = 100 } = req.query;
      // logger.log(`⭐ Fetching top ${limit} voted stations from Radio Browser API...`);
      
      const stations = await radioBrowserService.getTopVotedStations(Number(limit));
      res.json({ stations });
    } catch (error) {
      // console.error('Error fetching top voted stations:', error);
      res.status(500).json({ error: 'Failed to fetch top voted stations' });
    }
  });

  // Get recently changed stations from Radio Browser API
  app.get("/api/radio-browser/recent", async (req, res) => {
    try {
      if (!radioBrowserService) {
        return res.status(503).json({ error: 'Radio Browser service not available yet' });
      }
      
      const { limit = 100 } = req.query;
      // logger.log('🕒 Fetching ${limit} recently changed stations from Radio Browser API...');
      
      const stations = await radioBrowserService.getRecentlyChangedStations(Number(limit));
      res.json({ stations });
    } catch (error) {
      // console.error('Error fetching recently changed stations:', error);
      res.status(500).json({ error: 'Failed to fetch recently changed stations' });
    }
  });

  // Get broken stations from Radio Browser API
  app.get("/api/radio-browser/broken", async (req, res) => {
    try {
      if (!radioBrowserService) {
        return res.status(503).json({ error: 'Radio Browser service not available yet' });
      }
      
      const { limit = 50 } = req.query;
      // logger.log('💔 Fetching ${limit} broken stations from Radio Browser API...');
      
      const stations = await radioBrowserService.getBrokenStations(Number(limit));
      res.json({ stations });
    } catch (error) {
      // console.error('Error fetching broken stations:', error);
      res.status(500).json({ error: 'Failed to fetch broken stations' });
    }
  });

  // SYNC MANAGEMENT API ENDPOINTS
  
  // Get sync status
  app.get("/api/sync/status", async (req, res) => {
    try {
      const status = await syncService.getStatus();
      res.json(status);
    } catch (error) {
      console.error('Error fetching sync status:', error);
      res.status(500).json({ error: 'Failed to fetch sync status' });
    }
  });

  // Auto-flagged junk report — short summary of how many records the
  // ingest pipeline marked as junk during the most recent sync runs.
  // Backs the admin dashboard tile for task #20.
  app.get("/api/admin/sync/auto-flagged-report", requireAdmin, async (req, res) => {
    try {
      const { SyncLog } = await import('@shared/mongo-schemas');
      const recent = await SyncLog.find()
        .sort({ startedAt: -1 })
        .limit(10)
        .select('syncType status startedAt completedAt stationsAdded stationsUpdated stationsAutoFlagged')
        .lean();

      const lastCompleted = recent.find((l: any) => l.status === 'completed');
      const last = recent[0] || null;

      res.json({
        last: last
          ? {
              syncType: last.syncType,
              status: last.status,
              startedAt: last.startedAt,
              completedAt: last.completedAt,
              stationsAdded: last.stationsAdded || 0,
              stationsUpdated: last.stationsUpdated || 0,
              autoFlagged: last.stationsAutoFlagged || 0,
            }
          : null,
        lastCompleted: lastCompleted
          ? {
              startedAt: lastCompleted.startedAt,
              completedAt: lastCompleted.completedAt,
              stationsAdded: lastCompleted.stationsAdded || 0,
              stationsUpdated: lastCompleted.stationsUpdated || 0,
              autoFlagged: lastCompleted.stationsAutoFlagged || 0,
            }
          : null,
        recent: recent.map((l: any) => ({
          syncType: l.syncType,
          status: l.status,
          startedAt: l.startedAt,
          completedAt: l.completedAt,
          autoFlagged: l.stationsAutoFlagged || 0,
        })),
      });
    } catch (error) {
      console.error('Error fetching auto-flagged report:', error);
      res.status(500).json({ error: 'Failed to fetch auto-flagged report' });
    }
  });

  // Get sync logs
  app.get("/api/sync/logs", async (req, res) => {
    try {
      const { limit = 20 } = req.query;
      const logs = await syncService.getLogs(Number(limit));
      res.json(logs);
    } catch (error) {
      console.error('Error fetching sync logs:', error);
      res.status(500).json({ error: 'Failed to fetch sync logs' });
    }
  });

  // Force start sync — admin-only (was a public lever to spawn a heavy
  // long-running sync that pulls 40k+ stations into memory).
  app.post("/api/sync/force", requireAdmin, async (req, res) => {
    try {
      logger.log('🚀 Force starting sync...');
      
      // Start the sync asynchronously (don't wait for completion)
      syncService.startSync()
        .then(() => {
          logger.log('✅ Force sync completed successfully');
        })
        .catch((error) => {
          console.error('❌ Force sync failed:', error);
        });

      res.json({ 
        success: true, 
        message: 'Sync started successfully - check status for progress'
      });
    } catch (error) {
      console.error('Error starting sync:', error);
      res.status(500).json({ error: 'Failed to start sync' });
    }
  });

  // Stop sync — admin-only.
  app.post("/api/sync/stop", requireAdmin, async (req, res) => {
    try {
      logger.log('🛑 Stopping sync...');
      
      // Stop the sync service
      syncService.stopSync();
      
      // Find running sync and mark as failed (stopped by admin)
      const runningSyncs = await SyncLog.find({ status: 'running' });
      
      for (const sync of runningSyncs) {
        sync.status = 'failed';
        sync.completedAt = new Date();
        sync.errorMessage = 'Manually stopped by admin';
        await sync.save();
      }

      res.json({ 
        success: true, 
        message: 'Sync stopped successfully',
        stoppedSyncs: runningSyncs.length 
      });
    } catch (error) {
      console.error('Error stopping sync:', error);
      res.status(500).json({ error: 'Failed to stop sync' });
    }
  });

  // Flush all station data
  app.post("/api/admin/flush-stations", requireAdmin, async (req, res) => {
    try {
      logger.log('🗑️ Flushing all station data...');
      
      const { Station, SyncLog, BlacklistedStation } = await import('../shared/mongo-schemas');
      
      // Delete all stations
      const stationResult = await Station.deleteMany({});
      logger.log(`✅ Deleted ${stationResult.deletedCount} stations`);
      
      // Clear sync logs to start fresh
      const syncLogResult = await SyncLog.deleteMany({});
      logger.log(`✅ Deleted ${syncLogResult.deletedCount} sync logs`);
      
      // Clear blacklisted stations if any
      const blacklistResult = await BlacklistedStation.deleteMany({});
      logger.log(`✅ Deleted ${blacklistResult.deletedCount} blacklisted stations`);
      
      performanceCache.clearSeoHtml();
      performanceCache.clearPageData();
      logger.log('🎯 Station data flush complete! Database is now empty and ready for fresh sync.');
      
      res.json({ 
        success: true, 
        message: 'All station data flushed successfully',
        deletedStations: stationResult.deletedCount,
        deletedSyncLogs: syncLogResult.deletedCount,
        deletedBlacklisted: blacklistResult.deletedCount
      });
    } catch (error) {
      console.error('❌ Error flushing station data:', error);
      res.status(500).json({ error: 'Failed to flush station data' });
    }
  });

  // ANALYTICS API ENDPOINTS
  
  // Remove playlist files (M3U, PLS, ASX) endpoint
  app.post("/api/admin/remove-playlist-streams", requireAdmin, async (req, res) => {
    try {
      logger.log('🗑️ Starting removal of playlist files (M3U, PLS, ASX)...');
      
      // Count playlist streams to be removed
      const playlistCount = await Station.countDocuments({
        url: { $regex: /\.(m3u|pls|asx)(\?|$)/i }
      });
      
      logger.log(`Found ${playlistCount} playlist files to remove`);
      
      // Remove all playlist file streams
      const removalResult = await Station.deleteMany({
        url: { $regex: /\.(m3u|pls|asx)(\?|$)/i }
      });
      
      logger.log(`✅ Removed ${removalResult.deletedCount} playlist streams`);
      
      // Get updated counts
      const remainingTotal = await Station.countDocuments({});
      const directMP3 = await Station.countDocuments({
        url: { $regex: /\.mp3(\?|$)/i }
      });
      const directAAC = await Station.countDocuments({
        url: { $regex: /\.aac(\?|$)/i }
      });
      const icecastCount = await Station.countDocuments({
        url: { $regex: /(:8000|:8080|\/stream|\/radio|shoutcast|icecast)/i }
      });
      
      const results = {
        removed_count: removalResult.deletedCount,
        remaining_stations: remainingTotal,
        direct_playable: {
          mp3_streams: directMP3,
          aac_streams: directAAC,
          icecast_shoutcast: icecastCount,
          total_direct: directMP3 + directAAC + icecastCount
        },
        message: `Successfully removed ${removalResult.deletedCount} playlist streams. ${remainingTotal} direct-playable stations remain.`
      };
      
      res.json(results);
    } catch (error) {
      console.error('Playlist removal error:', error);
      res.status(500).json({ error: 'Failed to remove playlist streams' });
    }
  });

  // Remove HLS/M3U8 streams endpoint (completed)
  app.post("/api/admin/remove-hls-streams", requireAdmin, async (req, res) => {
    try {
      logger.log('🗑️ Starting removal of HLS/M3U8 streams...');
      
      // Count streams to be removed
      const m3u8Count = await Station.countDocuments({
        url: { $regex: /\.m3u8/i }
      });
      
      const hlsRelatedCount = await Station.countDocuments({
        url: { $regex: /hls|m3u8/i }
      });
      
      logger.log(`Found ${m3u8Count} .m3u8 streams and ${hlsRelatedCount} HLS-related streams to remove`);
      
      // Remove all streams with HLS/M3U8 in URL
      const removalResult = await Station.deleteMany({
        url: { $regex: /hls|m3u8/i }
      });
      
      logger.log(`✅ Removed ${removalResult.deletedCount} HLS/M3U8 streams`);
      
      // Get updated counts
      const remainingTotal = await Station.countDocuments({});
      const directMP3 = await Station.countDocuments({
        url: { $regex: /\.mp3(\?|$)/i }
      });
      const icecastCount = await Station.countDocuments({
        url: { $regex: /(:8000|:8080|\/stream|\/radio|shoutcast|icecast)/i }
      });
      
      const results = {
        removed_count: removalResult.deletedCount,
        remaining_stations: remainingTotal,
        direct_playable: {
          mp3_streams: directMP3,
          icecast_shoutcast: icecastCount,
          total_direct: directMP3 + icecastCount
        },
        message: `Successfully removed ${removalResult.deletedCount} HLS/M3U8 streams. ${remainingTotal} direct-playable stations remain.`
      };
      
      res.json(results);
    } catch (error) {
      console.error('HLS removal error:', error);
      res.status(500).json({ error: 'Failed to remove HLS streams' });
    }
  });

  // HTTPS/HTTP URL analysis endpoint
  app.get("/api/stream-https-analysis", async (req, res) => {
    try {
      logger.log('🔍 Analyzing HTTPS vs HTTP URLs across all stations...');
      
      const totalStations = await Station.countDocuments({});
      
      // Count HTTPS URLs
      const httpsCount = await Station.countDocuments({
        url: { $regex: /^https:\/\//i }
      });
      
      // Count HTTP URLs  
      const httpCount = await Station.countDocuments({
        url: { $regex: /^http:\/\//i }
      });
      
      // Count resolved HTTPS URLs (urlResolved field)
      const httpsResolvedCount = await Station.countDocuments({
        urlResolved: { $regex: /^https:\/\//i }
      });
      
      // Count resolved HTTP URLs
      const httpResolvedCount = await Station.countDocuments({
        urlResolved: { $regex: /^http:\/\//i }
      });
      
      // Count stations with urlResolved field populated
      const stationsWithResolvedUrl = await Station.countDocuments({
        urlResolved: { $exists: true, $nin: [null, ""] }
      });
      
      // Get some HTTPS URL samples
      const httpsSamples = await Station.find({
        url: { $regex: /^https:\/\//i }
      }).limit(5).select('name url country');
      
      // Get some HTTP URL samples  
      const httpSamples = await Station.find({
        url: { $regex: /^http:\/\//i }
      }).limit(5).select('name url country');
      
      // Get some resolved HTTPS URL samples
      const httpsResolvedSamples = await Station.find({
        urlResolved: { $regex: /^https:\/\//i }
      }).limit(5).select('name url urlResolved country');
      
      const results = {
        total_stations: totalStations,
        original_urls: {
          https_urls: httpsCount,
          http_urls: httpCount,
          https_percentage: ((httpsCount / totalStations) * 100).toFixed(2),
          http_percentage: ((httpCount / totalStations) * 100).toFixed(2)
        },
        resolved_urls: {
          stations_with_resolved: stationsWithResolvedUrl,
          https_resolved: httpsResolvedCount,
          http_resolved: httpResolvedCount,
          https_resolved_percentage: stationsWithResolvedUrl > 0 ? ((httpsResolvedCount / stationsWithResolvedUrl) * 100).toFixed(2) : "0",
          http_resolved_percentage: stationsWithResolvedUrl > 0 ? ((httpResolvedCount / stationsWithResolvedUrl) * 100).toFixed(2) : "0"
        },
        samples: {
          https_samples: httpsSamples,
          http_samples: httpSamples,
          https_resolved_samples: httpsResolvedSamples
        }
      };
      
      logger.log('🔒 HTTPS/HTTP Analysis Results:', {
        total: results.total_stations,
        https: results.original_urls.https_urls,
        http: results.original_urls.http_urls,
        resolved: results.resolved_urls.stations_with_resolved,
        https_resolved: results.resolved_urls.https_resolved
      });
      
      res.json(results);
    } catch (error) {
      console.error('HTTPS analysis error:', error);
      res.status(500).json({ error: 'Failed to analyze HTTPS URLs' });
    }
  });

  // Stream type analysis endpoint
  app.get("/api/stream-analysis", async (req, res) => {
    try {
      logger.log('🔍 Analyzing stream types across all stations...');
      
      const totalStations = await Station.countDocuments({});
      
      // Count .m3u8 URLs (HLS streams)
      const m3u8Count = await Station.countDocuments({
        url: { $regex: /\.m3u8/i }
      });
      
      // Count HLS-related URLs (contains 'hls' or 'm3u8')
      const hlsRelatedCount = await Station.countDocuments({
        url: { $regex: /hls|m3u8/i }
      });
      
      // Count playlist URLs (.m3u, .pls, .asx)
      const playlistCount = await Station.countDocuments({
        url: { $regex: /\.(m3u|pls|asx)$/i }
      });
      
      // Count direct MP3 streams
      const mp3Count = await Station.countDocuments({
        url: { $regex: /\.mp3(\?|$)/i }
      });
      
      // Count direct AAC streams
      const aacCount = await Station.countDocuments({
        url: { $regex: /\.aac(\?|$)/i }
      });
      
      // Count Icecast/Shoutcast streams (common radio streaming)
      const icecastCount = await Station.countDocuments({
        url: { $regex: /(:8000|:8080|\/stream|\/radio|shoutcast|icecast)/i }
      });
      
      // Get sample .m3u8 URLs
      const m3u8Samples = await Station.find({
        url: { $regex: /\.m3u8/i }
      }).limit(10).select('name url country');
      
      // Get sample HLS URLs
      const hlsSamples = await Station.find({
        url: { $regex: /hls/i }
      }).limit(10).select('name url country');
      
      const results = {
        total_stations: totalStations,
        stream_types: {
          m3u8_urls: m3u8Count,
          hls_related: hlsRelatedCount,
          playlist_files: playlistCount,
          direct_mp3: mp3Count,
          direct_aac: aacCount,
          icecast_shoutcast: icecastCount
        },
        percentages: {
          m3u8_percentage: ((m3u8Count / totalStations) * 100).toFixed(2),
          hls_percentage: ((hlsRelatedCount / totalStations) * 100).toFixed(2),
          mp3_percentage: ((mp3Count / totalStations) * 100).toFixed(2),
          icecast_percentage: ((icecastCount / totalStations) * 100).toFixed(2)
        },
        samples: {
          m3u8_stations: m3u8Samples,
          hls_stations: hlsSamples
        }
      };
      
      logger.log('📊 Stream Analysis Results:', {
        total: results.total_stations,
        m3u8: results.stream_types.m3u8_urls,
        hls: results.stream_types.hls_related,
        mp3: results.stream_types.direct_mp3,
        icecast: results.stream_types.icecast_shoutcast
      });
      
      res.json(results);
    } catch (error) {
      console.error('Stream analysis error:', error);
      res.status(500).json({ error: 'Failed to analyze streams' });
    }
  });

  // Get analytics events
  app.get("/api/analytics", async (req, res) => {
    try {
      // logger.log(' Fetching analytics events...');
      
      const { startDate, endDate, event, limit = 100 } = req.query;
      
      // Build filter based on query params
      const filter: any = {};
      
      if (startDate || endDate) {
        filter.timestamp = {};
        if (startDate) filter.timestamp.$gte = new Date(startDate as string);
        if (endDate) filter.timestamp.$lte = new Date(endDate as string);
      }
      
      if (event && event !== '') {
        filter.event = event;
      }

      // Check if AnalyticsEvent collection exists and has data
      const { AnalyticsEvent } = await import('../shared/mongo-schemas');
      const events = await AnalyticsEvent.find(filter)
        .sort({ timestamp: -1 })
        .limit(Number(limit))
        .lean();

      // logger.log(` Found ${events.length} analytics events`);
      res.json(events);
    } catch (error) {
      // console.error('Error fetching analytics:', error);
      // Return sample data if collection doesn't exist yet
      const sampleEvents = [
        {
          _id: '1',
          stationId: '60f7b3b4b8f4e4001c8f4567',
          event: 'play',
          metadata: { duration: 300, quality: 'high' },
          timestamp: new Date(Date.now() - 1000 * 60 * 10), // 10 minutes ago
          ip: '127.0.0.1'
        },
        {
          _id: '2',
          stationId: '60f7b3b4b8f4e4001c8f4568',
          event: 'favorite',
          metadata: { action: 'add' },
          timestamp: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
        },
        {
          _id: '3',
          stationId: '60f7b3b4b8f4e4001c8f4569',
          event: 'click',
          metadata: { source: 'homepage', position: 1 },
          timestamp: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
        }
      ];
      res.json(sampleEvents);
    }
  });

  // Get analytics summary/stats
  app.get("/api/analytics/summary", async (req, res) => {
    try {
      // logger.log(' Fetching analytics summary...');
      
      const { period = '7d' } = req.query;
      
      // Calculate date range based on period
      let startDate = new Date();
      switch (period) {
        case '24h':
          startDate.setHours(startDate.getHours() - 24);
          break;
        case '7d':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(startDate.getDate() - 30);
          break;
        default:
          startDate.setDate(startDate.getDate() - 7);
      }

      // Get basic station stats from existing data
      const totalStations = await Station.countDocuments();
      const activeStations = await Station.countDocuments({ lastCheckOk: true });
      const brokenStations = await Station.countDocuments({ lastCheckOk: false });
      
      // Get top countries by station count
      const topCountries = await Station.aggregate([
        { $match: { country: { $exists: true, $ne: "" } } },
        { $group: { _id: "$country", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      // Get top genres by station count
      const topGenres = await Genre.aggregate([
        { $sort: { stationCount: -1 } },
        { $limit: 10 }
      ]);

      // Get top codecs
      const topCodecs = await Station.aggregate([
        { $match: { codec: { $exists: true, $ne: "" } } },
        { $group: { _id: "$codec", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      const summary = {
        totalStations,
        activeStations,
        brokenStations,
        healthPercentage: totalStations > 0 ? Math.round((activeStations / totalStations) * 100) : 0,
        period,
        topCountries: topCountries.map(c => ({ name: c._id, count: c.count })),
        topGenres: topGenres.map(g => ({ name: g.name, count: g.stationCount })),
        topCodecs: topCodecs.map(c => ({ name: c._id, count: c.count })),
        lastUpdated: new Date()
      };

      // logger.log(` Analytics summary - ${totalStations} total stations, ${activeStations} active`);
      res.json(summary);
    } catch (error) {
      // console.error('Error fetching analytics summary:', error);
      res.status(500).json({ error: 'Failed to fetch analytics summary' });
    }
  });
}
