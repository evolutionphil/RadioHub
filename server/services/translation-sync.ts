import * as fs from 'fs';
import * as path from 'path';
import { TranslationKey, Translation, TranslationLanguage } from '../../shared/mongo-schemas';
import { bumpTranslationVersion } from './translation-version';
import { logger } from '../utils/logger';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface ExtractedKey {
  key: string;
  defaultValue: string;
  filePath: string;
  lineNumber: number;
}

export class TranslationSyncService {
  private static isRunning = false;
  private static lastSyncTime: Date | null = null;

  static async scanFrontendForKeys(): Promise<ExtractedKey[]> {
    const clientDir = path.join(process.cwd(), 'client', 'src');
    const extractedKeys: ExtractedKey[] = [];
    
    const scanDirectory = (dir: string) => {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          
          if (stat.isDirectory()) {
            scanDirectory(filePath);
          } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            
            lines.forEach((line, index) => {
              const matches = line.matchAll(/\bt\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*['"`]([^'"`]*)['"`])?/g);
              for (const match of matches) {
                const key = match[1];
                const defaultValue = match[2] || key;
                
                if (key && !key.includes('${') && key.length > 2) {
                  extractedKeys.push({
                    key,
                    defaultValue,
                    filePath: filePath.replace(process.cwd(), ''),
                    lineNumber: index + 1
                  });
                }
              }
            });
          }
        }
      } catch (error) {
        logger.log(`⚠️ Error scanning directory ${dir}:`, error);
      }
    };

    scanDirectory(clientDir);
    
    const uniqueKeys = new Map<string, ExtractedKey>();
    for (const extracted of extractedKeys) {
      if (!uniqueKeys.has(extracted.key)) {
        uniqueKeys.set(extracted.key, extracted);
      }
    }
    
    return Array.from(uniqueKeys.values());
  }

  static async syncNewKeys(): Promise<{ added: number; existing: number }> {
    const extractedKeys = await this.scanFrontendForKeys();
    let added = 0;
    let existing = 0;

    for (const extracted of extractedKeys) {
      try {
        const existingKey = await TranslationKey.findOne({ key: extracted.key });
        if (!existingKey) {
          await TranslationKey.create({
            key: extracted.key,
            defaultValue: extracted.defaultValue,
            description: `Auto-discovered from ${extracted.filePath}:${extracted.lineNumber}`,
            category: this.categorizeKey(extracted.key),
            isPlural: false
          });
          added++;
          logger.log(`+ Added key: ${extracted.key}`);
        } else {
          existing++;
        }
      } catch (error) {
        logger.log(`⚠️ Error adding key ${extracted.key}:`, error);
      }
    }

    if (added > 0) {
      await bumpTranslationVersion(`Auto-sync added ${added} new keys`);
    }

    return { added, existing };
  }

  private static categorizeKey(key: string): string {
    if (key.startsWith('nav_')) return 'navigation';
    if (key.startsWith('button_')) return 'buttons';
    if (key.startsWith('station_')) return 'station';
    if (key.startsWith('error_')) return 'errors';
    if (key.startsWith('general_')) return 'general';
    if (key.startsWith('footer_')) return 'footer';
    if (key.startsWith('faq_')) return 'faq';
    if (key.startsWith('seo_')) return 'seo';
    return 'general';
  }

  static async translateMissingForLanguage(langCode: string): Promise<{ translated: number; failed: number }> {
    if (langCode === 'en') return { translated: 0, failed: 0 };

    const language = await TranslationLanguage.findOne({ code: langCode, isEnabled: true });
    if (!language) return { translated: 0, failed: 0 };

    const allKeys = await TranslationKey.find({}).lean();
    const existingTranslations = await Translation.find({ language: langCode }).lean();
    const existingKeyIds = new Set(existingTranslations.map(t => t.keyId?.toString()));

    const missingKeys = allKeys.filter(key => !existingKeyIds.has(key._id?.toString()));
    if (missingKeys.length === 0) return { translated: 0, failed: 0 };

    let translated = 0;
    let failed = 0;

    const languageMapping: Record<string, string> = {
      af: 'Afrikaans', am: 'Amharic', ar: 'Arabic', az: 'Azerbaijani', bg: 'Bulgarian',
      bn: 'Bengali', bs: 'Bosnian', cs: 'Czech', da: 'Danish', de: 'German',
      el: 'Greek', es: 'Spanish', et: 'Estonian', fa: 'Persian', fi: 'Finnish',
      fr: 'French', gu: 'Gujarati', he: 'Hebrew', hi: 'Hindi', hr: 'Croatian',
      hu: 'Hungarian', hy: 'Armenian', id: 'Indonesian', it: 'Italian', ja: 'Japanese',
      kn: 'Kannada', ko: 'Korean', lt: 'Lithuanian', lv: 'Latvian', ml: 'Malayalam',
      mr: 'Marathi', ms: 'Malay', nl: 'Dutch', no: 'Norwegian', pa: 'Punjabi',
      pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sk: 'Slovak',
      sl: 'Slovenian', so: 'Somali', sq: 'Albanian', sr: 'Serbian', sv: 'Swedish',
      sw: 'Swahili', ta: 'Tamil', te: 'Telugu', th: 'Thai', tl: 'Tagalog',
      tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', vi: 'Vietnamese', zh: 'Chinese',
      zu: 'Zulu', ba: 'Bosnian'
    };

    const targetLanguage = languageMapping[langCode] || language.name;

    const batchSize = 10;
    for (let i = 0; i < missingKeys.length; i += batchSize) {
      const batch = missingKeys.slice(i, i + batchSize);
      
      try {
        const keysToTranslate = batch.map(k => ({
          key: k.key,
          english: k.defaultValue
        }));

        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a professional translator. Translate the following UI strings from English to ${targetLanguage}. 
CRITICAL RULES:
1. NEVER translate "Mega Radio" - keep it exactly as "Mega Radio"
2. Preserve all placeholders like {COUNTRY}, {STATION_NAME}, {count} exactly as they are
3. Keep translations concise and natural for UI elements
4. Return ONLY a valid JSON object with keys matching the input keys`
            },
            {
              role: 'user',
              content: JSON.stringify(keysToTranslate)
            }
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' }
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
          const translations = JSON.parse(content);
          
          for (const key of batch) {
            const translatedValue = translations[key.key];
            if (translatedValue) {
              await Translation.findOneAndUpdate(
                { keyId: key._id, language: langCode },
                {
                  keyId: key._id,
                  language: langCode,
                  value: translatedValue,
                  isCompleted: true,
                  lastModified: new Date()
                },
                { upsert: true }
              );
              translated++;
            } else {
              failed++;
            }
          }
        }
      } catch (error) {
        logger.log(`⚠️ Translation batch failed for ${langCode}:`, error);
        failed += batch.length;
      }
    }

    return { translated, failed };
  }

  static async translateAllMissing(): Promise<{ totalTranslated: number; totalFailed: number; languages: number }> {
    const enabledLanguages = await TranslationLanguage.find({ isEnabled: true, code: { $ne: 'en' } }).lean();
    
    let totalTranslated = 0;
    let totalFailed = 0;

    for (const lang of enabledLanguages) {
      const { translated, failed } = await this.translateMissingForLanguage(lang.code);
      totalTranslated += translated;
      totalFailed += failed;
      
      if (translated > 0) {
        logger.log(`✅ ${lang.name}: ${translated} translated`);
      }
    }

    if (totalTranslated > 0) {
      await bumpTranslationVersion(`Auto-translated ${totalTranslated} strings`);
    }

    return { totalTranslated, totalFailed, languages: enabledLanguages.length };
  }

  static async runFullSync(): Promise<{
    keysAdded: number;
    keysExisting: number;
    translated: number;
    failed: number;
    languages: number;
  }> {
    if (this.isRunning) {
      logger.log('⚠️ Translation sync already running, skipping...');
      return { keysAdded: 0, keysExisting: 0, translated: 0, failed: 0, languages: 0 };
    }

    this.isRunning = true;
    logger.log('🔄 TRANSLATION SYNC: Starting full sync...');

    try {
      const { added: keysAdded, existing: keysExisting } = await this.syncNewKeys();
      logger.log(`📝 Keys: ${keysAdded} new, ${keysExisting} existing`);

      if (keysAdded > 0) {
        const { totalTranslated: translated, totalFailed: failed, languages } = await this.translateAllMissing();
        logger.log(`🌍 Translations: ${translated} new across ${languages} languages`);
        
        this.lastSyncTime = new Date();
        this.isRunning = false;
        
        return { keysAdded, keysExisting, translated, failed, languages };
      }

      this.lastSyncTime = new Date();
      this.isRunning = false;
      
      return { keysAdded, keysExisting, translated: 0, failed: 0, languages: 0 };
    } catch (error) {
      logger.log('❌ Translation sync failed:', error);
      this.isRunning = false;
      throw error;
    }
  }

  static getLastSyncTime(): Date | null {
    return this.lastSyncTime;
  }

  static isCurrentlyRunning(): boolean {
    return this.isRunning;
  }

  static async scanForNewKeys(): Promise<{ keysAdded: number; keysExisting: number }> {
    if (this.isRunning) {
      logger.log('⚠️ Translation scan already running, skipping...');
      return { keysAdded: 0, keysExisting: 0 };
    }

    this.isRunning = true;
    logger.log('🔍 TRANSLATION SCAN: Scanning for new keys...');

    try {
      const { added: keysAdded, existing: keysExisting } = await this.syncNewKeys();
      logger.log(`📝 Scan complete: ${keysAdded} new keys, ${keysExisting} existing`);
      
      this.lastSyncTime = new Date();
      this.isRunning = false;
      
      return { keysAdded, keysExisting };
    } catch (error) {
      logger.log('❌ Translation scan failed:', error);
      this.isRunning = false;
      throw error;
    }
  }
}

export async function runTranslationSync() {
  return TranslationSyncService.runFullSync();
}

export async function scanAndAddNewKeys() {
  return TranslationSyncService.scanForNewKeys();
}
