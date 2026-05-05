import OpenAI from "openai";
import { COUNTRY_TO_LANGUAGE, getNativeCountryName } from "../../shared/seo-config";
import { logger } from "../utils/logger";

// Using existing OpenAI API key (same as translation system)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface StationInfo {
  _id: string;
  name: string;
  country?: string;
  countryCode?: string;
  state?: string;
  tags?: string;
  language?: string;
}

interface GenerationResult {
  success: boolean;
  fullDescription?: string;
  metaDescription?: string;
  language: string;
  error?: string;
  usedFallback: boolean;
}

// Detect station language based on country code or station language field
export function detectStationLanguage(station: StationInfo): string {
  // Priority 1: Use station's language field if set
  if (station.language) {
    const langCode = station.language.split(',')[0].trim().toLowerCase();
    if (langCode.length === 2) {
      return langCode;
    }
  }
  
  // Priority 2: Map country code to language
  if (station.countryCode) {
    const countryCode = station.countryCode.toLowerCase();
    const mappedLanguage = COUNTRY_TO_LANGUAGE[countryCode];
    if (mappedLanguage) {
      return mappedLanguage;
    }
  }
  
  // Priority 3: Fallback to English
  return 'en';
}

// Language name mapping for prompt clarity
const LANGUAGE_NAMES: Record<string, string> = {
  'en': 'English',
  'tr': 'Turkish',
  'de': 'German',
  'es': 'Spanish',
  'fr': 'French',
  'it': 'Italian',
  'pt': 'Portuguese',
  'ar': 'Arabic',
  'nl': 'Dutch',
  'ru': 'Russian',
  'pl': 'Polish',
  'zh': 'Chinese',
  'ja': 'Japanese',
  'ko': 'Korean',
  'hi': 'Hindi',
  'th': 'Thai',
  'vi': 'Vietnamese',
  'id': 'Indonesian',
  'he': 'Hebrew',
  'fa': 'Persian',
  'sv': 'Swedish',
  'da': 'Danish',
  'no': 'Norwegian',
  'fi': 'Finnish',
  'el': 'Greek',
  'hu': 'Hungarian',
  'cs': 'Czech',
  'sk': 'Slovak',
  'ro': 'Romanian',
  'bg': 'Bulgarian',
  'hr': 'Croatian',
  'sr': 'Serbian',
  'sl': 'Slovenian',
  'uk': 'Ukrainian',
};

// Generate AI description for a single station
export async function generateStationDescription(
  station: StationInfo,
  targetLanguage?: string
): Promise<GenerationResult> {
  const language = targetLanguage || detectStationLanguage(station);
  const languageName = LANGUAGE_NAMES[language] || 'English';
  
  try {
    // Build context for OpenAI
    const tags = station.tags?.split(',').map(t => t.trim()).filter(Boolean).join(', ') || 'General';
    const nativeCountry = station.country ? getNativeCountryName(station.country, language) : 'Unknown';
    const location = station.state 
      ? `${station.state}, ${nativeCountry}` 
      : nativeCountry || 'Unknown';
    
    // Construct prompt - Generate BOTH full description AND meta description
    const prompt = `You MUST respond ONLY in ${languageName}. Do NOT use English. Generate BOTH a full description AND an SEO meta description for this radio station:

Station Name: ${station.name}
Country: ${nativeCountry} (${station.countryCode || 'N/A'})
City/Region: ${station.state || 'Not specified'}
Music Genres/Tags: ${tags}
Target Language: ${languageName} (respond ONLY in this language, NEVER in English)

CRITICAL BRAND & NAME PRESERVATION:
- ALWAYS keep "Mega Radio" as-is - DO NOT translate this brand name to any language
- ALWAYS keep station name "${station.name}" as-is - DO NOT translate it to any language
- DO NOT translate the platform name "Mega Radio" under any circumstances
- DO NOT translate the station name "${station.name}" under any circumstances
- Other brand names and proper nouns should also remain unchanged

CRITICAL INSTRUCTIONS:
1. You MUST write EVERYTHING in ${languageName} language ONLY
2. If you have specific information about this exact station (${station.name} from ${nativeCountry}):
   PART 1 - Write a 200-300 word full description including:
   - Brief introduction to the station
   - Music genres and programming style (based on tags: ${tags})
   - Typical shows or schedule (if known, otherwise keep generic)
   - History or local cultural context (if known)
   - End with call-to-action to listen on "Mega Radio" (KEEP THIS NAME UNCHANGED)
   
   PART 2 - Write a 155-160 character SEO meta description that summarizes the station (preserving "Mega Radio")

3. If you DO NOT have specific information about this station, respond with EXACTLY this text: "NO_INFO_AVAILABLE"

4. Be specific to ${nativeCountry} culture and radio scene.
5. Make content SEO-friendly and engaging for listeners.
6. DO NOT make up false facts - if unsure, return "NO_INFO_AVAILABLE"
7. REMEMBER: All text must be in ${languageName}, not English

Response format (separate with "==="):
[FULL DESCRIPTION HERE - 200-300 words in ${languageName}]
===
[SEO META DESCRIPTION - 155-160 characters in ${languageName}]`;

    logger.log(`🤖 AI: Generating description for "${station.name}" (${station.countryCode}) in ${languageName}`);
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.7,
    });
    
    const aiResponse = (completion.choices[0]?.message?.content || "").trim();
    
    let fullDescription = '';
    let metaDescription = '';
    
    // Parse full description and meta from response
    if (aiResponse.includes('===')) {
      const parts = aiResponse.split('===');
      fullDescription = parts[0].trim();
      metaDescription = parts[1].trim();
      
      // CLEANUP: Remove brackets from parsed text (template artifacts in ALL languages)
      // Remove leading/trailing brackets
      fullDescription = fullDescription
        .replace(/^\[+/, '').replace(/\]+$/, '');
      
      // Remove bracket patterns with template keywords (English and other languages)
      fullDescription = fullDescription
        // AGGRESSIVE: Remove ANY line containing dash + template keywords
        .replace(/^.*?-.*?(character|preserve|meta|description|word|full).*?$/gim, '')
        .replace(/\[FULL DESCRIPTION[^\]]*\]/gi, '')  // English
        .replace(/\[Volle Beschreibung[^\]]*\]/gi, '') // German
        .replace(/\[DESCRIPTION COMPLÈTE[^\]]*\]/gi, '') // French
        .replace(/\[Description Complète[^\]]*\]/gi, '') // French (mixed case)
        .replace(/\[DESCRIPCIÓN COMPLETA[^\]]*\]/gi, '') // Spanish
        .replace(/\[Descripción Completa[^\]]*\]/gi, '') // Spanish (mixed case)
        .replace(/\[DESCRIZIONE COMPLETA[^\]]*\]/gi, '') // Italian
        .replace(/\[Descrizione Completa[^\]]*\]/gi, '') // Italian (mixed case)
        .replace(/\[DESCRIÇÃO COMPLETA[^\]]*\]/gi, '') // Portuguese
        .replace(/\[Descrição Completa[^\]]*\]/gi, '') // Portuguese (mixed case)
        .replace(/\[ПОЛНОЕ ОПИСАНИЕ[^\]]*\]/gi, '') // Russian
        .replace(/\[الوصف الكامل[^\]]*\]/gi, '') // Arabic
        .trim();
      
      metaDescription = metaDescription
        .replace(/^\[+/, '').replace(/\]+$/, '');
      
      // Remove bracket patterns with meta keywords (aggressive cleanup)
      metaDescription = metaDescription
        // AGGRESSIVE: Remove ANY line containing dash + template keywords
        .replace(/^.*?-.*?(character|preserve|meta|description|word|full).*?$/gim, '')
        .replace(/\[SEO META[^\]]*\]/gi, '')  // English - template text
        .replace(/\[SEO-Meta[^\]]*\]/gi, '') // German/English mixed
        .replace(/\[Beschreibung[^\]]*\]/gi, '') // German
        .replace(/\[Description[^\]]*\]/gi, '') // English/French/Spanish
        .replace(/\[META[^\]]*\]/gi, '') // Any language
        .replace(/\[[^\]]*Wort[^\]]*\]/gi, '') // German with "Wort"
        .replace(/\[[^\]]*character[^\]]*\]/gi, '') // English
        .replace(/\[.*?characters?.*?\]/gi, '') // Any bracket with "character/characters"
        .replace(/\[.*?preserve.*?\]/gi, '') // Any bracket with "preserve"
        .replace(/&quot;/g, '"') // Convert HTML entities to quotes
        .replace(/[\[\]]/g, '') // Remove ALL remaining brackets (final cleanup)
        .trim();
    }
    
    // Check if AI has no specific information - generate engaging fallback
    if (aiResponse.includes("NO_INFO_AVAILABLE") || fullDescription.length < 100) {
      // Log the raw OpenAI response for debugging
      logger.log(`ℹ️ AI: No specific info for "${station.name}" - generating fallback description`);
      logger.log(`📝 Raw OpenAI response for "${station.name}": "${aiResponse.substring(0, 100)}${aiResponse.length > 100 ? '...' : ''}"`);
      logger.log(`   Parsed FULL (${fullDescription.length} chars): ${fullDescription.substring(0, 100)}${fullDescription.length > 100 ? '...' : ''}`);
      logger.log(`   Parsed META (${metaDescription.length} chars): ${metaDescription}`);
      
      // Generate engaging generic description based on available info
      // Translate CTA to target language (only "Mega Radio" brand stays English)
      const ctaTranslations: Record<string, string> = {
        'de': 'Hören Sie es jetzt auf Mega Radio',
        'fr': 'Écoutez maintenant sur Mega Radio',
        'es': 'Escucha ahora en Mega Radio',
        'it': 'Ascolta ora su Mega Radio',
        'pt': 'Ouça agora na Mega Radio',
        'tr': 'Şimdi Mega Radio\'da dinleyin',
        'nl': 'Luister nu op Mega Radio',
        'ru': 'Слушайте сейчас на Mega Radio',
        'pl': 'Słuchaj teraz na Mega Radio',
        'ar': 'استمع الآن على Mega Radio',
        'he': 'האזינו כעת ל-Mega Radio',
        'ja': 'Mega Radioで今すぐ聴く',
        'zh': '立即在Mega Radio上收听',
        'ko': 'Mega Radio에서 지금 들어보세요',
      };
      const cta = ctaTranslations[language] || `Listen now on Mega Radio`;
      
      const fallbackPrompt = `You MUST respond ONLY in ${languageName}. Write BOTH a full description AND an SEO meta description for a radio station in ${languageName} based only on this info:
Station: ${station.name}
Country: ${station.country}
Tags: ${tags}
Response Language: ${languageName} (ONLY in this language, NEVER in English)

CRITICAL PRESERVATION RULE:
- DO NOT translate the station name "${station.name}" - keep it exactly as is
- DO NOT translate "Mega Radio" - keep it exactly as is
- Only translate the description text itself, NOT the station name

Instructions for FULL DESCRIPTION (200-300 words in ${languageName}):
- Include the station name "${station.name}" naturally (DO NOT translate it)
- Mention the country/region
- Reference the music genres/tags provided
- Make it SEO-friendly and inviting
- End with "${cta}"
- Be engaging for listeners
- MUST be entirely in ${languageName} except for the station name

Instructions for META DESCRIPTION (155-160 characters in ${languageName}):
- Summarize the station
- Include key genres/tags
- Make it SEO-optimized
- Exactly 155-160 characters
- MUST be entirely in ${languageName} except for the station name

Response format (separate with "==="):
[FULL DESCRIPTION - 200-300 words in ${languageName}]
===
[SEO META - 155-160 characters in ${languageName}]`;
      
      try {
        const fallbackCompletion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: "user", content: fallbackPrompt }],
          max_tokens: 600,
          temperature: 0.7,
        });
        
        const fallbackResponse = (fallbackCompletion.choices[0]?.message?.content || "").trim();
        
        let fallbackFull = '';
        let fallbackMeta = '';
        
        if (fallbackResponse.includes('===')) {
          const parts = fallbackResponse.split('===');
          fallbackFull = parts[0].trim();
          fallbackMeta = parts[1].trim();
        }
        
        if (fallbackFull && fallbackFull.length > 100 && fallbackMeta && fallbackMeta.length >= 50) {
          logger.log(`✅ AI: Fallback generated ${fallbackFull.length} chars full + ${fallbackMeta.length} chars meta for "${station.name}"`);
          logger.log(`   Fallback FULL: ${fallbackFull.substring(0, 100)}...`);
          logger.log(`   Fallback META: ${fallbackMeta}`);
          return {
            success: true,
            fullDescription: fallbackFull,
            metaDescription: fallbackMeta,
            language,
            usedFallback: true
          };
        }
      } catch (fallbackError) {
        logger.log(`⚠️ AI: Fallback generation failed for "${station.name}"`);
      }
      
      // Both AI attempts failed — do NOT store thin template content in DB.
      // The SSR renderer already shows station metadata (country, genres, website) for stations
      // without descriptions, which is better than 2-3 generic template sentences.
      logger.log(`⚠️ AI: Both attempts failed for "${station.name}" — skipping storage to avoid thin content`);
      return {
        success: false,
        language,
        usedFallback: true,
        error: 'Both primary and fallback AI generation failed'
      };
    }
    
    logger.log(`✅ AI: Generated ${fullDescription.length} chars full + ${metaDescription.length} chars meta for "${station.name}"`);
    
    return {
      success: true,
      fullDescription: fullDescription,
      metaDescription: metaDescription,
      language,
      usedFallback: false
    };
    
  } catch (error: any) {
    logger.error(`❌ AI: Error generating description for "${station.name}":`, error.message);
    return {
      success: false,
      language,
      usedFallback: true,
      error: error.message || 'Unknown error'
    };
  }
}

// Translate BOTH full description AND meta description to multiple target languages
export async function translateDescription(
  fullDescription: string,
  metaDescription: string,
  sourceLanguage: string,
  targetLanguages: string[],
  stationName?: string
): Promise<Map<string, {full: string, meta: string}>> {
  const translations = new Map<string, {full: string, meta: string}>();
  
  const sourceLangName = LANGUAGE_NAMES[sourceLanguage] || sourceLanguage;
  
  logger.log(`🌍 AI: Translating descriptions for "${stationName || 'Unknown Station'}" from ${sourceLangName} to ${targetLanguages.length} languages`);
  
  // Filter out same-language and create parallel translation promises
  const languagesToTranslate = targetLanguages.filter(lang => lang !== sourceLanguage);
  
  // Create all translation requests in parallel
  const translationPromises = languagesToTranslate.map(async (targetLang) => {
    try {
      const targetLangName = LANGUAGE_NAMES[targetLang] || targetLang;
      
      // CRITICAL: Use system message to enforce name preservation
      const systemMessage = `You are a professional translator. Your MOST IMPORTANT rule is:

NEVER TRANSLATE THESE - KEEP EXACTLY AS WRITTEN:
1. "${stationName || 'station names'}" - This is a proper noun/brand name. Write it EXACTLY as "${stationName}" in your translation.
2. "Mega Radio" - This is a brand name. Write it EXACTLY as "Mega Radio" in your translation.

These names must appear LETTER-FOR-LETTER identical in your translation. Do not transliterate, do not convert to local alphabet, do not modify in any way.

Example: If translating to Chinese, write "${stationName}" NOT "罗克安特纳" or any Chinese characters.
Example: If translating to Arabic, write "${stationName}" NOT "روك أنتيني" or any Arabic characters.`;

      const translationPrompt = `Translate this radio station description from ${sourceLangName} to ${targetLangName}.

MANDATORY: Keep "${stationName}" and "Mega Radio" in Latin alphabet exactly as written. Do NOT transliterate to ${targetLangName} script.

Full Description to translate:
${fullDescription}

Meta Description to translate:
${metaDescription}

Format your response EXACTLY like this (use === as separator):
${stationName} is... [rest of translated full description]
===
${stationName}: [translated meta, 155-160 chars]`;
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: translationPrompt }
        ],
        max_tokens: 1000,
        temperature: 0.2, // Even lower for more consistent output
      });
      
      const translationResponse = (completion.choices[0]?.message?.content || "").trim();
      
      // DEBUG: Log raw OpenAI response
      logger.log(`🔍 AI RAW Response for ${targetLangName}: ${translationResponse.substring(0, 200)}...`);
      
      let translatedFull = '';
      let translatedMeta = '';
      
      if (translationResponse.includes('===')) {
        const parts = translationResponse.split('===');
        translatedFull = parts[0].trim();
        translatedMeta = parts[1]?.trim() || '';
        
        logger.log(`🔍 BEFORE cleanup - Full: ${translatedFull.length} chars, Meta: ${translatedMeta.length} chars`);
        
        // SIMPLIFIED CLEANUP: Only remove template brackets at the VERY start
        // Remove only leading bracket with template text pattern
        translatedFull = translatedFull
          .replace(/^\[TRANSLATED FULL DESCRIPTION[^\]]*\]\s*/i, '')
          .replace(/^\[FULL DESCRIPTION[^\]]*\]\s*/i, '')
          .replace(/^\[[^\]]*preserve[^\]]*\]\s*/gi, '')
          .trim();
        
        translatedMeta = translatedMeta
          .replace(/^\[TRANSLATED META[^\]]*\]\s*/i, '')
          .replace(/^\[SEO META[^\]]*\]\s*/i, '')
          .replace(/^\[META[^\]]*\]\s*/i, '')
          .replace(/^\[[^\]]*preserve[^\]]*\]\s*/gi, '')
          .replace(/^\[[^\]]*character[^\]]*\]\s*/gi, '')
          .trim();
        
        logger.log(`🔍 AFTER cleanup - Full: ${translatedFull.length} chars, Meta: ${translatedMeta.length} chars`);
      } else {
        // No === separator - try to use entire response as full and generate meta
        logger.log(`⚠️ No === separator found in ${targetLangName} response, using full response`);
        translatedFull = translationResponse
          .replace(/^\[TRANSLATED FULL DESCRIPTION[^\]]*\]\s*/i, '')
          .replace(/^\[FULL DESCRIPTION[^\]]*\]\s*/i, '')
          .trim();
        // Meta will be generated from full later
      }
      
      // RELAXED validation: Accept translations that have meaningful content
      // Some languages (Arabic, Chinese, etc.) need shorter content to express same idea
      const minFullLength = 50; // Reduced from 100
      const minMetaLength = 20; // Reduced from 50
      
      // FIX: If full is valid but meta is empty/short, generate meta from full description
      if (translatedFull && translatedFull.length >= minFullLength && (!translatedMeta || translatedMeta.length < minMetaLength)) {
        // Generate meta from full description - take first 155 chars and add ellipsis
        const generatedMeta = translatedFull.substring(0, 155).trim();
        // Find last complete word/sentence
        const lastSpace = generatedMeta.lastIndexOf(' ');
        const lastPeriod = generatedMeta.lastIndexOf('.');
        const cutPoint = lastPeriod > 100 ? lastPeriod + 1 : (lastSpace > 100 ? lastSpace : 155);
        translatedMeta = generatedMeta.substring(0, cutPoint).trim();
        if (!translatedMeta.endsWith('.') && !translatedMeta.endsWith('!') && !translatedMeta.endsWith('?')) {
          translatedMeta += '...';
        }
        logger.log(`🔧 AI: Generated meta from full for ${targetLangName} (${translatedMeta.length} chars)`);
      }
      
      const isValidLength = translatedFull && translatedFull.length >= minFullLength && 
                           translatedMeta && translatedMeta.length >= minMetaLength;
      
      if (!isValidLength) {
        logger.log(`⚠️ AI: Translation to ${targetLangName} too short (full: ${translatedFull?.length || 0}/${minFullLength}, meta: ${translatedMeta?.length || 0}/${minMetaLength})`);
      } else {
        // SAFETY: Ensure "Mega Radio" and station name are NEVER translated (preserve brand & station names)
        // Check if original has "Mega Radio" and verify it's preserved in translation
        const hasOriginalBrand = fullDescription.includes('Mega Radio') || metaDescription.includes('Mega Radio');
        
        if (hasOriginalBrand && !translatedFull.includes('Mega Radio')) {
          // If original had "Mega Radio" but translation doesn't, restore it
          // This is a safety net in case AI accidentally translated it
          logger.log(`⚠️ AI: Detected translated brand name in ${targetLangName}, restoring "Mega Radio"`);
          translatedFull = translatedFull.replace(/mega\s*radio|мега\s*радио|мегарадио|మెగారేడియო|메가라디오|ラジオメガ|mega\s*？radio/gi, 'Mega Radio');
        }
        
        if (hasOriginalBrand && !translatedMeta.includes('Mega Radio')) {
          logger.log(`⚠️ AI: Detected translated brand name in meta ${targetLangName}, restoring "Mega Radio"`);
          translatedMeta = translatedMeta.replace(/mega\s*radio|мега\s*радио|мегарадио|మెగారేడియო|메가라디오|ラジオメガ/gi, 'Mega Radio');
        }
        
        // SAFETY: Ensure station name is preserved in translation (not translated)
        if (stationName && (fullDescription.includes(stationName) || metaDescription.includes(stationName))) {
          if (!translatedFull.includes(stationName)) {
            // Station name might have been translated, restore it
            logger.log(`⚠️ AI: Station name "${stationName}" not found in ${targetLangName} translation, attempting to restore`);
            // Try to restore station name by finding the first sentence and prepending it
            // Get first sentence (up to first period)
            const firstSentenceMatch = translatedFull.match(/^[^.!?]+[.!?]/);
            if (firstSentenceMatch) {
              // Replace first sentence to include station name at the beginning
              translatedFull = translatedFull.replace(firstSentenceMatch[0], `${stationName} ` + firstSentenceMatch[0]);
              logger.log(`   ✅ Restored station name to beginning of translation`);
            } else {
              // If no sentence found, prepend station name
              translatedFull = `${stationName} - ${translatedFull}`;
              logger.log(`   ✅ Prepended station name to translation`);
            }
          }
          if (!translatedMeta.includes(stationName) && metaDescription.includes(stationName)) {
            logger.log(`⚠️ AI: Station name "${stationName}" not found in meta description for ${targetLangName}, attempting to restore`);
            // Restore station name to meta description
            translatedMeta = `${stationName} - ${translatedMeta}`;
            logger.log(`   ✅ Restored station name to meta description`);
          }
        }
        
        return { lang: targetLang, langName: targetLangName, full: translatedFull, meta: translatedMeta, success: true };
      }
      
      return { lang: targetLang, langName: targetLangName, success: false };
    } catch (error: any) {
      logger.error(`❌ AI: Translation error for ${targetLang}:`, error.message);
      return { lang: targetLang, success: false };
    }
  });
  
  // Execute all translations in parallel
  const results = await Promise.all(translationPromises);
  
  // Collect successful translations into the map
  results.forEach(result => {
    if (result.success && result.full && result.meta) {
      translations.set(result.lang, { full: result.full, meta: result.meta });
      logger.log(`✅ AI: Translated to ${result.langName} (${result.full.length} chars full + ${result.meta.length} chars meta)`);
    }
  });
  
  return translations;
}

// Batch process multiple stations sequentially with delay
export async function batchGenerateStationDescriptions(
  stations: StationInfo[],
  onProgress?: (current: number, total: number, stationName: string) => void
): Promise<Map<string, GenerationResult>> {
  const results = new Map<string, GenerationResult>();
  
  logger.log(`🚀 AI Batch: Starting generation for ${stations.length} stations`);
  
  for (let index = 0; index < stations.length; index++) {
    const station = stations[index];
    
    try {
      const result = await generateStationDescription(station);
      results.set(station._id.toString(), result);
      
      if (onProgress) {
        onProgress(index + 1, stations.length, station.name);
      }
      
      // Delay to avoid rate limits (OpenAI has 3 requests/min on some tiers)
      if (index < stations.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    } catch (error: any) {
      logger.error(`❌ AI Batch: Error processing "${station.name}":`, error.message);
      results.set(station._id.toString(), {
        success: false,
        language: detectStationLanguage(station),
        usedFallback: true,
        error: error.message
      });
    }
  }
  
  const successful = Array.from(results.values()).filter(r => r.success && !r.usedFallback).length;
  const fallback = Array.from(results.values()).filter(r => r.usedFallback).length;
  const failed = Array.from(results.values()).filter(r => !r.success).length;
  
  logger.log(`✅ AI Batch: Complete - ${successful} generated, ${fallback} fallback, ${failed} failed`);
  
  return results;
}

// Common languages for bulk translation (top 14 most spoken/important)
const COMMON_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'tr', 'ru', 'ar', 'zh', 'ja', 'ko', 'he'];
