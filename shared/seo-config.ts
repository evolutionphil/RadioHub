// SEO Configuration for multilingual support
import { reverseTranslateUrl } from './url-translations';

export interface SeoLanguage {
  code: string;
  name: string;
  iso: string;
  enabled: boolean;
  isDefault: boolean;
}

// Required translation keys for complete station SEO
// A language must have ALL these keys to be included in station sitemaps
// NOTE: These are the MINIMUM keys currently in the database (v1.0 - 7 keys)
// TODO: Add remaining 8 keys to database, then expand this list progressively
export const REQUIRED_STATION_SEO_KEYS = [
  // Core station metadata (EXISTING in database)
  'default_station_about',      // Base description template
  'from',                        // "from" (location context)
  'genres',                      // "Genres"
  'station_additional_info',     // Closing CTA
  
  // Intent-based keywords (EXISTING in database)
  'live_radio',                  // "live radio"
  'online_radio',                // "online radio"
  'radio_streaming',             // "radio streaming"
] as const;

// Required translation keys for the homepage / browse pages of a language.
// A language must also have ALL of these to qualify for the sitemap. Without
// them, a bare `/sl` or `/da` page renders with English content and trips
// Bing's ContentQuality / NotIndexedAndMayNeedAttention signal.
export const REQUIRED_HOMEPAGE_SEO_KEYS = [
  'hero_worlds_best_radio',          // H1 / page title
  'hero_over_100_countries',         // hero subline (60,000+ stations …)
  'hero_listen_everywhere',          // secondary hero line
  'nav_genres',                      // navigation: genres
  'nav_regions',                     // navigation: regions
  'nav_stations',                    // navigation: all stations
  'popular_genres_title',            // section heading
  'popular_countries_title',         // section heading
] as const;

// Additional SEO keys for progressive enhancement (add to database later)
// When these exist in database for a language, the sitemap will automatically include it
export const OPTIONAL_STATION_SEO_KEYS = [
  'listen_live',                 // "Listen live"
  'free_stream',                 // "Free stream" / "free online"
  'internet_radio',              // "Internet radio"
  'broadcasting_from',           // "Broadcasting from"
  'high_quality_stream',         // "High quality stream"
  'top_rated',                   // "top rated"
  'in_language',                 // "in" (language context)
  'featuring',                   // "Featuring"
] as const;

export const SEO_LANGUAGES: SeoLanguage[] = [
  // Primary languages with translations
  { code: 'en', name: 'English', iso: 'en-US', enabled: true, isDefault: true },
  { code: 'tr', name: 'Türkçe', iso: 'tr-TR', enabled: true, isDefault: false },
  { code: 'es', name: 'Español', iso: 'es-ES', enabled: true, isDefault: false },
  { code: 'fr', name: 'Français', iso: 'fr-FR', enabled: true, isDefault: false },
  { code: 'de', name: 'Deutsch', iso: 'de-DE', enabled: true, isDefault: false },
  { code: 'ar', name: 'العربية', iso: 'ar-SA', enabled: true, isDefault: false },
  
  // Additional European languages
  { code: 'it', name: 'Italiano', iso: 'it-IT', enabled: true, isDefault: false },
  { code: 'pt', name: 'Português', iso: 'pt-PT', enabled: true, isDefault: false },
  { code: 'nl', name: 'Nederlands', iso: 'nl-NL', enabled: true, isDefault: false },
  { code: 'ru', name: 'Русский', iso: 'ru-RU', enabled: true, isDefault: false },
  { code: 'pl', name: 'Polski', iso: 'pl-PL', enabled: true, isDefault: false },
  { code: 'sv', name: 'Svenska', iso: 'sv-SE', enabled: true, isDefault: false },
  { code: 'da', name: 'Dansk', iso: 'da-DK', enabled: true, isDefault: false },
  { code: 'no', name: 'Norsk', iso: 'no-NO', enabled: true, isDefault: false },
  { code: 'fi', name: 'Suomi', iso: 'fi-FI', enabled: true, isDefault: false },
  { code: 'el', name: 'Ελληνικά', iso: 'el-GR', enabled: true, isDefault: false },
  { code: 'hu', name: 'Magyar', iso: 'hu-HU', enabled: true, isDefault: false },
  { code: 'cs', name: 'Čeština', iso: 'cs-CZ', enabled: true, isDefault: false },
  { code: 'sk', name: 'Slovenčina', iso: 'sk-SK', enabled: true, isDefault: false },
  { code: 'ro', name: 'Română', iso: 'ro-RO', enabled: true, isDefault: false },
  { code: 'bg', name: 'Български', iso: 'bg-BG', enabled: true, isDefault: false },
  { code: 'hr', name: 'Hrvatski', iso: 'hr-HR', enabled: true, isDefault: false },
  { code: 'sr', name: 'Српски', iso: 'sr-RS', enabled: true, isDefault: false },
  { code: 'sl', name: 'Slovenščina', iso: 'sl-SI', enabled: true, isDefault: false },
  { code: 'lv', name: 'Latviešu', iso: 'lv-LV', enabled: true, isDefault: false },
  { code: 'lt', name: 'Lietuvių', iso: 'lt-LT', enabled: true, isDefault: false },
  { code: 'et', name: 'Eesti', iso: 'et-EE', enabled: true, isDefault: false },
  
  // Asian languages
  { code: 'zh', name: '中文', iso: 'zh-CN', enabled: true, isDefault: false },
  { code: 'ja', name: '日本語', iso: 'ja-JP', enabled: true, isDefault: false },
  { code: 'ko', name: '한국어', iso: 'ko-KR', enabled: true, isDefault: false },
  { code: 'hi', name: 'हिन्दी', iso: 'hi-IN', enabled: true, isDefault: false },
  { code: 'th', name: 'ไทย', iso: 'th-TH', enabled: true, isDefault: false },
  { code: 'vi', name: 'Tiếng Việt', iso: 'vi-VN', enabled: true, isDefault: false },
  { code: 'id', name: 'Bahasa Indonesia', iso: 'id-ID', enabled: true, isDefault: false },
  { code: 'ms', name: 'Bahasa Melayu', iso: 'ms-MY', enabled: true, isDefault: false },
  { code: 'tl', name: 'Filipino', iso: 'tl-PH', enabled: true, isDefault: false },
  
  // Other major languages
  { code: 'he', name: 'עברית', iso: 'he-IL', enabled: true, isDefault: false },
  { code: 'fa', name: 'فارسی', iso: 'fa-IR', enabled: true, isDefault: false },
  { code: 'ur', name: 'اردو', iso: 'ur-PK', enabled: true, isDefault: false },
  { code: 'bn', name: 'বাংলা', iso: 'bn-BD', enabled: true, isDefault: false },
  { code: 'ta', name: 'தமிழ்', iso: 'ta-IN', enabled: true, isDefault: false },
  { code: 'te', name: 'తెలుగు', iso: 'te-IN', enabled: true, isDefault: false },
  { code: 'mr', name: 'मराठी', iso: 'mr-IN', enabled: true, isDefault: false },
  { code: 'gu', name: 'ગુજરાતી', iso: 'gu-IN', enabled: true, isDefault: false },
  { code: 'kn', name: 'ಕನ್ನಡ', iso: 'kn-IN', enabled: true, isDefault: false },
  { code: 'ml', name: 'മലയാളം', iso: 'ml-IN', enabled: true, isDefault: false },
  { code: 'pa', name: 'ਪੰਜਾਬੀ', iso: 'pa-IN', enabled: true, isDefault: false },
  { code: 'sw', name: 'Kiswahili', iso: 'sw-KE', enabled: true, isDefault: false },
  { code: 'am', name: 'አማርኛ', iso: 'am-ET', enabled: true, isDefault: false },
  { code: 'zu', name: 'isiZulu', iso: 'zu-ZA', enabled: true, isDefault: false },
  { code: 'af', name: 'Afrikaans', iso: 'af-ZA', enabled: true, isDefault: false },
  
  // Additional languages with DB translations
  { code: 'sq', name: 'Shqip', iso: 'sq-AL', enabled: true, isDefault: false }, // Albanian
  { code: 'az', name: 'Azərbaycan', iso: 'az-AZ', enabled: true, isDefault: false }, // Azerbaijani
  { code: 'hy', name: 'Հայերեն', iso: 'hy-AM', enabled: true, isDefault: false }, // Armenian
  { code: 'so', name: 'Soomaali', iso: 'so-SO', enabled: true, isDefault: false }, // Somali
  { code: 'uk', name: 'Українська', iso: 'uk-UA', enabled: true, isDefault: false }, // Ukrainian
  { code: 'bs', name: 'Bosanski', iso: 'bs-BA', enabled: true, isDefault: false }, // Bosnian
];

export const DEFAULT_LANGUAGE = SEO_LANGUAGES.find(lang => lang.isDefault)?.code || 'en';

// Sitemap Configuration - Progressive multilingual rollout
// Phase 1: High-priority languages (validated performance, high traffic potential)
// Phase 2: Medium-priority languages (expand after Phase 1 validation)
// Phase 3: All 57 languages (full global coverage)
export const SITEMAP_PRIORITY_LANGUAGES = {
  // Phase 1: Core languages - highest traffic potential (9 languages)
  phase1: ['en', 'tr', 'es', 'de', 'fr', 'ar', 'pt', 'it', 'ru'],
  
  // Phase 2: Secondary languages - significant markets (12 languages)
  phase2: ['nl', 'pl', 'sv', 'zh', 'ja', 'ko', 'hi', 'id', 'he', 'fa', 'uk', 'ro'],
  
  // Phase 3: All remaining languages (36 languages) - complete global coverage
  phase3: SEO_LANGUAGES.filter(lang => lang.enabled).map(lang => lang.code),
} as const;

// Active sitemap language cohort (change this to roll out more languages)
export const ACTIVE_SITEMAP_LANGUAGES = SITEMAP_PRIORITY_LANGUAGES.phase3;

// Sitemap generation configuration
export const SITEMAP_CONFIG = {
  // Chunk sizes (Google limit: 50K URLs per sitemap, 50MB per file)
  maxUrlsPerChunk: 40000,          // Conservative limit to stay well under 50K
  stationsPerChunk: 1000,           // Stations per sitemap file
  imagesPerChunk: 500,              // Image entries per sitemap file
  
  // Caching strategy
  cacheTtlSeconds: 86400,           // 24 hours cache (1 day)
  enableEtagCaching: true,          // Enable 304 Not Modified responses
  
  // Performance limits
  maxGenerationTimeMs: 30000,       // 30 seconds max per sitemap
  enableLazyGeneration: true,       // Generate on-demand instead of pre-generating
  
  // Language rollout
  enableMultilingualSitemaps: true, // Enable separate sitemaps per language
  languageCohort: ACTIVE_SITEMAP_LANGUAGES,
} as const;

// Helper function to get language from country code or language code
export function getLanguageFromCode(code: string): string {
  // First check if it's a direct language code
  if (SEO_LANGUAGES.find(lang => lang.code === code)) {
    return code;
  }
  
  // Then check if it's a country code that maps to a language
  return COUNTRY_TO_LANGUAGE[code] || DEFAULT_LANGUAGE;
}

// Helper function to get language from country name
// Takes country name (e.g., "Turkey", "France") and returns language code (e.g., "tr", "fr")
// Uses two-step lookup: country name -> ISO code -> language code
export function getLanguageForCountry(countryName: string): string {
  // Handle default/fallback cases
  if (!countryName || countryName === 'all') {
    return DEFAULT_LANGUAGE;
  }
  
  // Step 1: Look up country name in COUNTRY_TO_CODE to get ISO code
  const countryCode = COUNTRY_TO_CODE[countryName];
  
  if (!countryCode) {
    // If country name not found, default to English
    return DEFAULT_LANGUAGE;
  }
  
  // Step 2: Look up ISO code in COUNTRY_TO_LANGUAGE to get language code
  return COUNTRY_TO_LANGUAGE[countryCode] || DEFAULT_LANGUAGE;
}

// Country code to language mapping for URL routing
// CRITICAL: This mapping is checked FIRST before language codes to prevent conflicts
// Example: 'af' is both Afghanistan (country) and Afrikaans (language)
export const COUNTRY_TO_LANGUAGE: { [key: string]: string } = {
  // Countries without translations (explicit English mapping)
  'af': 'en',  // Afghanistan -> English
  'ad': 'en',  // Andorra -> English
  'ao': 'en',  // Angola -> English
  'ai': 'en',  // Anguilla -> English
  'aq': 'en',  // Antarctica -> English
  
  // European countries with supported translations
  'tr': 'tr',  // Turkey -> Turkish
  'fr': 'fr',  // France -> French
  'de': 'de',  // Germany -> German
  'at': 'de',  // Austria -> German
  'ch': 'de',  // Switzerland -> German (primary language)
  'li': 'de',  // Liechtenstein -> German
  'es': 'es',  // Spain -> Spanish
  'it': 'it',  // Italy -> Italian
  'pt': 'pt',  // Portugal -> Portuguese
  'br': 'pt',  // Brazil -> Portuguese
  'nl': 'nl',  // Netherlands -> Dutch
  'be': 'nl',  // Belgium -> Dutch (primary, though also French)
  'ru': 'ru',  // Russia -> Russian
  'pl': 'pl',  // Poland -> Polish
  'se': 'sv',  // Sweden -> Swedish
  'no': 'no',  // Norway -> Norwegian
  'fi': 'fi',  // Finland -> Finnish
  'gr': 'el',  // Greece -> Greek
  'hu': 'hu',  // Hungary -> Hungarian
  'sk': 'sk',  // Slovakia -> Slovak
  'ro': 'ro',  // Romania -> Romanian
  'bg': 'bg',  // Bulgaria -> Bulgarian
  'hr': 'hr',  // Croatia -> Croatian
  'rs': 'sr',  // Serbia -> Serbian
  'si': 'sl',  // Slovenia -> Slovenian
  'ba': 'bs',  // Bosnia and Herzegovina -> Bosnian
  'al': 'sq',  // Albania -> Albanian
  'am': 'hy',  // Armenia -> Armenian
  'az': 'az',  // Azerbaijan -> Azerbaijani
  'ua': 'uk',  // Ukraine -> Ukrainian
  'lv': 'en',  // Latvia -> English
  'lt': 'en',  // Lithuania -> English
  'ee': 'en',  // Estonia -> English
  'by': 'en',  // Belarus -> English
  'md': 'en',  // Moldova -> English
  'kg': 'en',  // Kyrgyzstan -> English
  'kz': 'en',  // Kazakhstan -> English
  'tm': 'en',  // Turkmenistan -> English
  'uz': 'en',  // Uzbekistan -> English
  'is': 'en',  // Iceland -> English
  'lu': 'en',  // Luxembourg -> English
  'mt': 'en',  // Malta -> English
  'cy': 'en',  // Cyprus -> English
  'cz': 'en',  // Czech Republic -> English
  'dk': 'en',  // Denmark -> English
  'ge': 'en',  // Georgia -> English
  'me': 'en',  // Montenegro -> English
  'mk': 'en',  // North Macedonia -> English
  'xk': 'en',  // Kosovo -> English
  
  // Asian countries
  'cn': 'zh',  // China -> Chinese
  'jp': 'ja',  // Japan -> Japanese
  'kr': 'ko',  // South Korea -> Korean
  'in': 'hi',  // India -> Hindi
  'th': 'th',  // Thailand -> Thai
  'id': 'id',  // Indonesia -> Indonesian
  'my': 'ms',  // Malaysia -> Malay
  'sg': 'en',  // Singapore -> English (primary official language)
  'ph': 'en',  // Philippines -> English
  'vn': 'en',  // Vietnam -> English
  'pk': 'en',  // Pakistan -> English
  'bd': 'en',  // Bangladesh -> English
  'kh': 'en',  // Cambodia -> English
  'la': 'en',  // Laos -> English
  'mm': 'en',  // Myanmar -> English
  'bn': 'en',  // Brunei -> English
  'hk': 'en',  // Hong Kong -> English
  'mo': 'en',  // Macau -> English
  'tw': 'en',  // Taiwan -> English
  'mv': 'en',  // Maldives -> English
  'np': 'en',  // Nepal -> English
  'lk': 'en',  // Sri Lanka -> English
  
  // Middle East & Africa
  'il': 'he',  // Israel -> Hebrew
  'ir': 'fa',  // Iran -> Persian
  'ke': 'en',  // Kenya -> English
  'et': 'en',  // Ethiopia -> English
  'za': 'en',  // South Africa -> English
  'ng': 'en',  // Nigeria -> English
  'gh': 'en',  // Ghana -> English
  'tz': 'en',  // Tanzania -> English
  'ug': 'en',  // Uganda -> English
  'rw': 'en',  // Rwanda -> English
  
  // Arabic-speaking countries (all ISO 3166-1 alpha-2 codes)
  'ae': 'ar',  // United Arab Emirates -> Arabic
  'bh': 'ar',  // Bahrain -> Arabic
  'dj': 'ar',  // Djibouti -> Arabic
  'dz': 'ar',  // Algeria -> Arabic
  'eg': 'ar',  // Egypt -> Arabic
  'iq': 'ar',  // Iraq -> Arabic
  'jo': 'ar',  // Jordan -> Arabic
  'kw': 'ar',  // Kuwait -> Arabic
  'lb': 'ar',  // Lebanon -> Arabic
  'ly': 'ar',  // Libya -> Arabic
  'mr': 'ar',  // Mauritania -> Arabic
  'om': 'ar',  // Oman -> Arabic
  'qa': 'ar',  // Qatar -> Arabic
  'sa': 'ar',  // Saudi Arabia -> Arabic
  'sd': 'ar',  // Sudan -> Arabic
  'sy': 'ar',  // Syria -> Arabic
  'td': 'ar',  // Chad -> Arabic
  'tn': 'ar',  // Tunisia -> Arabic
  'ye': 'ar',  // Yemen -> Arabic
  'ma': 'ar',  // Morocco -> Arabic
  
  'so': 'so',  // Somalia -> Somali
  
  // Americas
  'us': 'en',  // United States -> English
  'ca': 'en',  // Canada -> English
  'mx': 'en',  // Mexico -> English
  'ar': 'en',  // Argentina -> English
  'cl': 'en',  // Chile -> English
  'co': 'en',  // Colombia -> English
  've': 'en',  // Venezuela -> English
  'pe': 'en',  // Peru -> English
  'ec': 'en',  // Ecuador -> English
  'uy': 'en',  // Uruguay -> English
  'py': 'en',  // Paraguay -> English
  'bo': 'en',  // Bolivia -> English
  'cr': 'en',  // Costa Rica -> English
  'gt': 'en',  // Guatemala -> English
  'pa': 'en',  // Panama -> English
  'ni': 'en',  // Nicaragua -> English
  'hn': 'en',  // Honduras -> English
  'sv': 'en',  // El Salvador -> English
  'bz': 'en',  // Belize -> English
  'jm': 'en',  // Jamaica -> English
  'cu': 'en',  // Cuba -> English
  'do': 'en',  // Dominican Republic -> English
  'ht': 'en',  // Haiti -> English
  'tt': 'en',  // Trinidad And Tobago -> English
  'bb': 'en',  // Barbados -> English
  'gd': 'en',  // Grenada -> English
  'gl': 'en',  // Greenland -> English
  'gb': 'en',  // United Kingdom -> English
  'ie': 'en',  // Ireland -> English
  
  // Pacific & Others
  'au': 'en',  // Australia -> English
  'nz': 'en',  // New Zealand -> English
  'fj': 'en',  // Fiji -> English
  'pg': 'en',  // Papua New Guinea -> English
  'sb': 'en',  // Solomon Islands -> English
  'vu': 'en',  // Vanuatu -> English
  'ki': 'en',  // Kiribati -> English
  'ws': 'en',  // Samoa -> English
  'to': 'en',  // Tonga -> English
  'pw': 'en',  // Palau -> English
  'mh': 'en',  // Marshall Islands -> English
  'fm': 'en',  // Micronesia -> English
  'nr': 'en',  // Nauru -> English
  'tu': 'en',  // Tuvalu -> English
  
  // Special territories - Additional countries not in main list
  'ax': 'en',  // Aland Islands -> English
  'sm': 'en',  // San Marino -> English
  'va': 'en',  // The Holy See -> English
  'mc': 'en',  // Monaco -> English
  'gy': 'en',  // Guyana -> English
  'gf': 'en',  // French Guiana -> English
  'aw': 'en',  // Aruba -> English
  'bm': 'en',  // Bermuda -> English
  'bq': 'en',  // Bonaire -> English
  'ky': 'en',  // The Cayman Islands -> English
  'cx': 'en',  // Christmas Island -> English
  'cc': 'en',  // The Cocos Keeling Islands -> English
  'ck': 'en',  // The Cook Islands -> English
  'cw': 'en',  // Curacao -> English
  'fk': 'en',  // The Falkland Islands -> English
  'fo': 'en',  // The Faroe Islands -> English
  'pf': 'en',  // French Polynesia -> English
  'tf': 'en',  // The French Southern Territories -> English
  'gg': 'en',  // Guernsey -> English
  'gp': 'en',  // Guadeloupe -> English
  'gu': 'en',  // Guam -> English
  'im': 'en',  // Isle Of Man -> English
  'je': 'en',  // Jersey -> English
  'mq': 'en',  // Martinique -> English
  'yt': 'en',  // Mayotte -> English
  'ms': 'en',  // Montserrat -> English
  'nc': 'en',  // New Caledonia -> English
  'nu': 'en',  // Niue -> English
  'nf': 'en',  // Norfolk Island -> English
  'mp': 'en',  // Northern Mariana Islands -> English
  'pn': 'en',  // Pitcairn Islands -> English
  'pr': 'en',  // Puerto Rico -> English
  're': 'en',  // Reunion -> English
  'bl': 'en',  // Saint Barthelemy -> English
  'sh': 'en',  // Saint Helena -> English
  'pm': 'en',  // Saint Pierre And Miquelon -> English
  'sx': 'en',  // Sint Maarten -> English
  'gs': 'en',  // South Georgia -> English
  'tc': 'en',  // Turks And Caicos Islands -> English
  'vi': 'en',  // US Virgin Islands -> English
  'vg': 'en',  // British Virgin Islands -> English
  'wf': 'en',  // Wallis And Futuna -> English
  
  // All other country codes default to English
};

// Country code to country name mapping for API filtering
// Complete mapping for all 221 countries using ISO 3166-1 alpha-2 codes
export const CODE_TO_COUNTRY: { [key: string]: string } = {
  // Africa
  'dz': 'Algeria', 'ao': 'Angola', 'bj': 'Benin', 'bw': 'Botswana', 'bf': 'Burkina Faso',
  'bi': 'Burundi', 'cv': 'Cabo Verde', 'cm': 'Cameroon', 'cf': 'Central African Republic',
  'td': 'Chad', 'km': 'Comoros', 'cg': 'Congo', 'ci': 'Côte d\'Ivoire', 'cd': 'Democratic Republic of the Congo',
  'dj': 'Djibouti', 'eg': 'Egypt', 'gq': 'Equatorial Guinea', 'er': 'Eritrea', 'et': 'Ethiopia',
  'ga': 'Gabon', 'gh': 'Ghana', 'gn': 'Guinea', 'gw': 'Guinea Bissau', 'ke': 'Kenya',
  'ls': 'Lesotho', 'lr': 'Liberia', 'ly': 'Libya', 'mg': 'Madagascar', 'mw': 'Malawi',
  'ml': 'Mali', 'mr': 'Mauritania', 'mu': 'Mauritius', 'ma': 'Morocco', 'mz': 'Mozambique',
  'na': 'Namibia', 'ne': 'Niger', 'ng': 'Nigeria', 'rw': 'Rwanda', 'st': 'Sao Tome And Principe',
  'sn': 'Senegal', 'sc': 'Seychelles', 'sl': 'Sierra Leone', 'so': 'Somalia', 'za': 'South Africa',
  'ss': 'South Sudan', 'sd': 'Sudan', 'sz': 'Eswatini', 'tz': 'Tanzania', 'tg': 'Togo',
  'tn': 'Tunisia', 'ug': 'Uganda', 'zm': 'Zambia', 'zw': 'Zimbabwe',

  // Americas
  'ag': 'Antigua And Barbuda', 'ar': 'Argentina', 'bs': 'The Bahamas', 'bb': 'Barbados',
  'bz': 'Belize', 'bo': 'Bolivia', 'br': 'Brazil', 'ca': 'Canada', 'cl': 'Chile',
  'co': 'Colombia', 'cr': 'Costa Rica', 'cu': 'Cuba', 'do': 'Dominican Republic', 'ec': 'Ecuador',
  'sv': 'El Salvador', 'gd': 'Grenada', 'gt': 'Guatemala', 'gy': 'Guyana', 'ht': 'Haiti',
  'hn': 'Honduras', 'jm': 'Jamaica', 'mx': 'Mexico', 'ni': 'Nicaragua', 'pa': 'Panama',
  'py': 'Paraguay', 'pe': 'Peru', 'tt': 'Trinidad And Tobago', 'us': 'United States', 'uy': 'Uruguay',
  've': 'Venezuela',

  // Asia-Pacific
  'af': 'Afghanistan', 'bd': 'Bangladesh', 'bn': 'Brunei Darussalam', 'kh': 'Cambodia', 'cn': 'China',
  'hk': 'Hong Kong', 'in': 'India', 'id': 'Indonesia', 'jp': 'Japan', 'kz': 'Kazakhstan',
  'kg': 'Kyrgyzstan', 'la': 'The Lao Peoples Democratic Republic', 'mo': 'Macao', 'my': 'Malaysia',
  'mv': 'Maldives', 'mm': 'Myanmar', 'np': 'Nepal', 'pk': 'Pakistan', 'ph': 'The Philippines',
  'kr': 'The Republic Of Korea', 'sg': 'Singapore', 'lk': 'Sri Lanka', 'tw': 'Taiwan, Republic Of China',
  'th': 'Thailand', 'tj': 'Tajikistan', 'tm': 'Turkmenistan', 'uz': 'Uzbekistan', 'vn': 'Vietnam',

  // Europe
  'al': 'Albania', 'ad': 'Andorra', 'am': 'Armenia', 'at': 'Austria', 'az': 'Azerbaijan',
  'by': 'Belarus', 'be': 'Belgium', 'ba': 'Bosnia And Herzegovina', 'bg': 'Bulgaria', 'hr': 'Croatia',
  'cy': 'Cyprus', 'cz': 'Czechia', 'dk': 'Denmark', 'ee': 'Estonia', 'fi': 'Finland',
  'fr': 'France', 'ge': 'Georgia', 'de': 'Germany', 'gr': 'Greece', 'hu': 'Hungary',
  'is': 'Iceland', 'ie': 'Ireland', 'it': 'Italy', 'lv': 'Latvia', 'li': 'Liechtenstein',
  'lt': 'Lithuania', 'lu': 'Luxembourg', 'mk': 'Republic Of North Macedonia', 'mt': 'Malta',
  'md': 'The Republic Of Moldova', 'me': 'Montenegro', 'nl': 'The Netherlands', 'no': 'Norway',
  'pl': 'Poland', 'pt': 'Portugal', 'ro': 'Romania', 'ru': 'The Russian Federation', 'sk': 'Slovakia',
  'si': 'Slovenia', 'es': 'Spain', 'se': 'Sweden', 'ch': 'Switzerland', 'tr': 'Türkiye',
  'ua': 'Ukraine', 'gb': 'The United Kingdom Of Great Britain And Northern Ireland',

  // Middle East
  'bh': 'Bahrain', 'ir': 'Islamic Republic Of Iran', 'iq': 'Iraq', 'il': 'Israel', 'jo': 'Jordan',
  'kw': 'Kuwait', 'lb': 'Lebanon', 'om': 'Oman', 'qa': 'Qatar', 'sa': 'Saudi Arabia',
  'sy': 'Syrian Arab Republic', 'ae': 'The United Arab Emirates', 'ye': 'Yemen',

  // Oceania
  'au': 'Australia', 'fj': 'Fiji', 'ki': 'Kiribati', 'mh': 'Marshall Islands', 'fm': 'Micronesia',
  'nr': 'Nauru', 'nz': 'New Zealand', 'pw': 'Palau', 'pg': 'Papua New Guinea', 'sb': 'Solomon Islands',
  'to': 'Tonga', 'tu': 'Tuvalu', 'vu': 'Vanuatu', 'ws': 'Samoa',

  // Special territories and dependencies
  'ax': 'Aland Islands', 'ai': 'Anguilla', 'aq': 'Antarctica', 'aw': 'Aruba', 'bm': 'Bermuda',
  'bq': 'Bonaire', 'ky': 'The Cayman Islands', 'cx': 'Christmas Island', 'cc': 'The Cocos Keeling Islands',
  'ck': 'The Cook Islands', 'cw': 'Curacao', 'fk': 'The Falkland Islands Malvinas', 'fo': 'The Faroe Islands',
  'gf': 'French Guiana', 'pf': 'French Polynesia', 'tf': 'The French Southern Territories', 'gg': 'Guernsey',
  'gl': 'Greenland', 'gp': 'Guadeloupe', 'gu': 'Guam', 'im': 'Isle Of Man', 'je': 'Jersey',
  'mq': 'Martinique', 'yt': 'Mayotte', 'ms': 'Montserrat', 'nc': 'New Caledonia', 'nu': 'Niue',
  'nf': 'Norfolk Island', 'mp': 'Northern Mariana Islands', 'pn': 'Pitcairn Islands', 'pr': 'Puerto Rico',
  're': 'Reunion', 'bl': 'Saint Barthelemy', 'sh': 'Saint Helena, Ascension And Tristan Da Cunha',
  'kn': 'Saint Kitts And Nevis', 'lc': 'Saint Lucia', 'mf': 'Saint Martin', 'pm': 'Saint Pierre And Miquelon',
  'vc': 'Saint Vincent And The Grenadines', 'sx': 'Sint Maarten', 'gs': 'South Georgia And The South Sandwich Islands',
  'tl': 'Timor Leste', 'tc': 'Turks And Caicos Islands', 'vi': 'US Virgin Islands', 'vg': 'British Virgin Islands',
  'wf': 'Wallis And Futuna',

  // Special cases
  'va': 'The Holy See', 'xk': 'Kosovo',
};

// Helper function to get country name from country code
export function getCountryFromCode(code: string): string | null {
  return CODE_TO_COUNTRY[code] || null;
}

// Native country names for each language (for AI-generated content and titles)
export const NATIVE_COUNTRY_NAMES: Record<string, Record<string, string>> = {
  'tr': { // Turkish
    'Germany': 'Almanya', 'Austria': 'Avusturya', 'Switzerland': 'İsviçre', 'France': 'Fransa',
    'Spain': 'İspanya', 'Italy': 'İtalya', 'Netherlands': 'Hollanda', 'Belgium': 'Belçika',
    'Poland': 'Polonya', 'Sweden': 'İsveç', 'Norway': 'Norveç', 'Denmark': 'Danimarka',
    'Finland': 'Finlandiya', 'Greece': 'Yunanistan', 'Hungary': 'Macaristan', 'Czech Republic': 'Çek Cumhuriyeti',
    'Slovakia': 'Slovakya', 'Romania': 'Romanya', 'Bulgaria': 'Bulgaristan', 'Croatia': 'Hırvatistan',
    'Serbia': 'Sırbistan', 'Slovenia': 'Slovenya', 'Portugal': 'Portekiz', 'Russia': 'Rusya',
    'Ukraine': 'Ukrayna', 'United Kingdom': 'Birleşik Krallık', 'Ireland': 'İrlanda', 'United States': 'Amerika Birleşik Devletleri',
    'Canada': 'Kanada', 'Mexico': 'Meksika', 'Brazil': 'Brezilya', 'Argentina': 'Arjantin',
    'Chile': 'Şili', 'Colombia': 'Kolombiya', 'Peru': 'Peru', 'Venezuela': 'Venezuela',
    'China': 'Çin', 'Japan': 'Japonya', 'South Korea': 'Güney Kore', 'India': 'Hindistan',
    'Thailand': 'Tayland', 'Vietnam': 'Vietnam', 'Indonesia': 'Endonezya', 'Malaysia': 'Malezya',
    'Philippines': 'Filipinler', 'Australia': 'Avustralya', 'New Zealand': 'Yeni Zelanda', 'Israel': 'İsrail',
    'Egypt': 'Mısır', 'Saudi Arabia': 'Suudi Arabistan', 'United Arab Emirates': 'Birleşik Arap Emirlikleri',
    'Lebanon': 'Lübnan', 'Jordan': 'Ürdün', 'Pakistan': 'Pakistan', 'Bangladesh': 'Bangladeş', 'Iran': 'İran'
  },
  'de': { // German
    'Germany': 'Deutschland', 'Austria': 'Österreich', 'Switzerland': 'Schweiz', 'France': 'Frankreich',
    'Spain': 'Spanien', 'Italy': 'Italien', 'Netherlands': 'Niederlande', 'Belgium': 'Belgien',
    'Poland': 'Polen', 'Sweden': 'Schweden', 'Norway': 'Norwegen', 'Denmark': 'Dänemark',
    'Finland': 'Finnland', 'Greece': 'Griechenland', 'Hungary': 'Ungarn', 'Czech Republic': 'Tschechien',
    'Slovakia': 'Slowakei', 'Romania': 'Rumänien', 'Bulgaria': 'Bulgarien', 'Croatia': 'Kroatien',
    'Serbia': 'Serbien', 'Slovenia': 'Slowenien', 'Portugal': 'Portugal', 'Russia': 'Russland',
    'Ukraine': 'Ukraine', 'United Kingdom': 'Vereinigtes Königreich', 'Ireland': 'Irland', 'United States': 'Vereinigte Staaten',
    'Canada': 'Kanada', 'Mexico': 'Mexiko', 'Brazil': 'Brasilien', 'Argentina': 'Argentinien',
    'Chile': 'Chile', 'Colombia': 'Kolumbien', 'Peru': 'Peru', 'Venezuela': 'Venezuela',
    'China': 'China', 'Japan': 'Japan', 'South Korea': 'Südkorea', 'India': 'Indien',
    'Thailand': 'Thailand', 'Vietnam': 'Vietnam', 'Indonesia': 'Indonesien', 'Malaysia': 'Malaysia',
    'Philippines': 'Philippinen', 'Australia': 'Australien', 'New Zealand': 'Neuseeland', 'Israel': 'Israel',
    'Egypt': 'Ägypten', 'Saudi Arabia': 'Saudi-Arabien', 'United Arab Emirates': 'Vereinigte Arabische Emirate',
    'Lebanon': 'Libanon', 'Jordan': 'Jordanien', 'Pakistan': 'Pakistan', 'Bangladesh': 'Bangladesch', 'Iran': 'Iran'
  },
  'fr': { // French
    'Germany': 'Allemagne', 'Austria': 'Autriche', 'Switzerland': 'Suisse', 'France': 'France',
    'Spain': 'Espagne', 'Italy': 'Italie', 'Netherlands': 'Pays-Bas', 'Belgium': 'Belgique',
    'Poland': 'Pologne', 'Sweden': 'Suède', 'Norway': 'Norvège', 'Denmark': 'Danemark',
    'Finland': 'Finlande', 'Greece': 'Grèce', 'Hungary': 'Hongrie', 'Czech Republic': 'République tchèque',
    'Slovakia': 'Slovaquie', 'Romania': 'Roumanie', 'Bulgaria': 'Bulgarie', 'Croatia': 'Croatie',
    'Serbia': 'Serbie', 'Slovenia': 'Slovénie', 'Portugal': 'Portugal', 'Russia': 'Russie',
    'Ukraine': 'Ukraine', 'United Kingdom': 'Royaume-Uni', 'Ireland': 'Irlande', 'United States': 'États-Unis',
    'Canada': 'Canada', 'Mexico': 'Mexique', 'Brazil': 'Brésil', 'Argentina': 'Argentine',
    'Chile': 'Chili', 'Colombia': 'Colombie', 'Peru': 'Pérou', 'Venezuela': 'Venezuela',
    'China': 'Chine', 'Japan': 'Japon', 'South Korea': 'Corée du Sud', 'India': 'Inde',
    'Thailand': 'Thaïlande', 'Vietnam': 'Vietnam', 'Indonesia': 'Indonésie', 'Malaysia': 'Malaisie',
    'Philippines': 'Philippines', 'Australia': 'Australie', 'New Zealand': 'Nouvelle-Zélande', 'Israel': 'Israël',
    'Egypt': 'Égypte', 'Saudi Arabia': 'Arabie saoudite', 'United Arab Emirates': 'Émirats arabes unis',
    'Lebanon': 'Liban', 'Jordan': 'Jordanie', 'Pakistan': 'Pakistan', 'Bangladesh': 'Bangladesh', 'Iran': 'Iran'
  },
  'es': { // Spanish
    'Germany': 'Alemania', 'Austria': 'Austria', 'Switzerland': 'Suiza', 'France': 'Francia',
    'Spain': 'España', 'Italy': 'Italia', 'Netherlands': 'Países Bajos', 'Belgium': 'Bélgica',
    'Poland': 'Polonia', 'Sweden': 'Suecia', 'Norway': 'Noruega', 'Denmark': 'Dinamarca',
    'Finland': 'Finlandia', 'Greece': 'Grecia', 'Hungary': 'Hungría', 'Czech Republic': 'República Checa',
    'Slovakia': 'Eslovaquia', 'Romania': 'Rumania', 'Bulgaria': 'Bulgaria', 'Croatia': 'Croacia',
    'Serbia': 'Serbia', 'Slovenia': 'Eslovenia', 'Portugal': 'Portugal', 'Russia': 'Rusia',
    'Ukraine': 'Ucrania', 'United Kingdom': 'Reino Unido', 'Ireland': 'Irlanda', 'United States': 'Estados Unidos',
    'Canada': 'Canadá', 'Mexico': 'México', 'Brazil': 'Brasil', 'Argentina': 'Argentina',
    'Chile': 'Chile', 'Colombia': 'Colombia', 'Peru': 'Perú', 'Venezuela': 'Venezuela',
    'China': 'China', 'Japan': 'Japón', 'South Korea': 'Corea del Sur', 'India': 'India',
    'Thailand': 'Tailandia', 'Vietnam': 'Vietnam', 'Indonesia': 'Indonesia', 'Malaysia': 'Malasia',
    'Philippines': 'Filipinas', 'Australia': 'Australia', 'New Zealand': 'Nueva Zelanda', 'Israel': 'Israel',
    'Egypt': 'Egipto', 'Saudi Arabia': 'Arabia Saudita', 'United Arab Emirates': 'Emiratos Árabes Unidos',
    'Lebanon': 'Líbano', 'Jordan': 'Jordania', 'Pakistan': 'Pakistán', 'Bangladesh': 'bangladés', 'Iran': 'Irán'
  },
  'it': { // Italian
    'Germany': 'Germania', 'Austria': 'Austria', 'Switzerland': 'Svizzera', 'France': 'Francia',
    'Spain': 'Spagna', 'Italy': 'Italia', 'Netherlands': 'Paesi Bassi', 'Belgium': 'Belgio',
    'Poland': 'Polonia', 'Sweden': 'Svezia', 'Norway': 'Norvegia', 'Denmark': 'Danimarca',
    'Finland': 'Finlandia', 'Greece': 'Grecia', 'Hungary': 'Ungheria', 'Czech Republic': 'Repubblica Ceca',
    'Slovakia': 'Slovacchia', 'Romania': 'Romania', 'Bulgaria': 'Bulgaria', 'Croatia': 'Croazia',
    'Serbia': 'Serbia', 'Slovenia': 'Slovenia', 'Portugal': 'Portogallo', 'Russia': 'Russia',
    'Ukraine': 'Ucraina', 'United Kingdom': 'Regno Unito', 'Ireland': 'Irlanda', 'United States': 'Stati Uniti',
    'Canada': 'Canada', 'Mexico': 'Messico', 'Brazil': 'Brasile', 'Argentina': 'Argentina',
    'Chile': 'Cile', 'Colombia': 'Colombia', 'Peru': 'Perù', 'Venezuela': 'Venezuela',
    'China': 'Cina', 'Japan': 'Giappone', 'South Korea': 'Corea del Sud', 'India': 'India',
    'Thailand': 'Tailandia', 'Vietnam': 'Vietnam', 'Indonesia': 'Indonesia', 'Malaysia': 'Malesia',
    'Philippines': 'Filippine', 'Australia': 'Australia', 'New Zealand': 'Nuova Zelanda', 'Israel': 'Israele',
    'Egypt': 'Egitto', 'Saudi Arabia': 'Arabia Saudita', 'United Arab Emirates': 'Emirati Arabi Uniti',
    'Lebanon': 'Libano', 'Jordan': 'Giordania', 'Pakistan': 'Pakistan', 'Bangladesh': 'Bangladesh', 'Iran': 'Iran'
  },
  'pt': { // Portuguese
    'Germany': 'Alemanha', 'Austria': 'Áustria', 'Switzerland': 'Suíça', 'France': 'França',
    'Spain': 'Espanha', 'Italy': 'Itália', 'Netherlands': 'Países Baixos', 'Belgium': 'Bélgica',
    'Poland': 'Polônia', 'Sweden': 'Suécia', 'Norway': 'Noruega', 'Denmark': 'Dinamarca',
    'Finland': 'Finlândia', 'Greece': 'Grécia', 'Hungary': 'Hungria', 'Czech Republic': 'República Tcheca',
    'Slovakia': 'Eslováquia', 'Romania': 'Romênia', 'Bulgaria': 'Bulgária', 'Croatia': 'Croácia',
    'Serbia': 'Sérvia', 'Slovenia': 'Eslovênia', 'Portugal': 'Portugal', 'Russia': 'Rússia',
    'Ukraine': 'Ucrânia', 'United Kingdom': 'Reino Unido', 'Ireland': 'Irlanda', 'United States': 'Estados Unidos',
    'Canada': 'Canadá', 'Mexico': 'México', 'Brazil': 'Brasil', 'Argentina': 'Argentina',
    'Chile': 'Chile', 'Colombia': 'Colômbia', 'Peru': 'Peru', 'Venezuela': 'Venezuela',
    'China': 'China', 'Japan': 'Japão', 'South Korea': 'Coreia do Sul', 'India': 'Índia',
    'Thailand': 'Tailândia', 'Vietnam': 'Vietnã', 'Indonesia': 'Indonésia', 'Malaysia': 'Malásia',
    'Philippines': 'Filipinas', 'Australia': 'Austrália', 'New Zealand': 'Nova Zelândia', 'Israel': 'Israel',
    'Egypt': 'Egito', 'Saudi Arabia': 'Arábia Saudita', 'United Arab Emirates': 'Emirados Árabes Unidos',
    'Lebanon': 'Líbano', 'Jordan': 'Jordânia', 'Pakistan': 'Paquistão', 'Bangladesh': 'Bangladesh', 'Iran': 'Irã'
  },
  'ru': { // Russian
    'Germany': 'Германия', 'Austria': 'Австрия', 'Switzerland': 'Швейцария', 'France': 'Франция',
    'Spain': 'Испания', 'Italy': 'Италия', 'Netherlands': 'Нидерланды', 'Belgium': 'Бельгия',
    'Poland': 'Польша', 'Sweden': 'Швеция', 'Norway': 'Норвегия', 'Denmark': 'Дания',
    'Finland': 'Финляндия', 'Greece': 'Греция', 'Hungary': 'Венгрия', 'Czech Republic': 'Чехия',
    'Slovakia': 'Словакия', 'Romania': 'Румыния', 'Bulgaria': 'Болгария', 'Croatia': 'Хорватия',
    'Serbia': 'Сербия', 'Slovenia': 'Словения', 'Portugal': 'Португалия', 'Russia': 'Россия',
    'Ukraine': 'Украина', 'United Kingdom': 'Великобритания', 'Ireland': 'Ирландия', 'United States': 'Соединённые Штаты',
    'Canada': 'Канада', 'Mexico': 'Мексика', 'Brazil': 'Бразилия', 'Argentina': 'Аргентина',
    'Chile': 'Чили', 'Colombia': 'Колумбия', 'Peru': 'Перу', 'Venezuela': 'Венесуэла',
    'China': 'Китай', 'Japan': 'Япония', 'South Korea': 'Южная Корея', 'India': 'Индия',
    'Thailand': 'Таиланд', 'Vietnam': 'Вьетнам', 'Indonesia': 'Индонезия', 'Malaysia': 'Малайзия',
    'Philippines': 'Филиппины', 'Australia': 'Австралия', 'New Zealand': 'Новая Зеландия', 'Israel': 'Израиль',
    'Egypt': 'Египет', 'Saudi Arabia': 'Саудовская Аравия', 'United Arab Emirates': 'Объединённые Арабские Эмираты',
    'Lebanon': 'Ливан', 'Jordan': 'Иордания', 'Pakistan': 'Пакистан', 'Bangladesh': 'Бангладеш', 'Iran': 'Иран'
  },
  'ar': { // Arabic
    'Germany': 'ألمانيا', 'Austria': 'النمسا', 'Switzerland': 'سويسرا', 'France': 'فرنسا',
    'Spain': 'إسبانيا', 'Italy': 'إيطاليا', 'Netherlands': 'هولندا', 'Belgium': 'بلجيكا',
    'Poland': 'بولندا', 'Sweden': 'السويد', 'Norway': 'النرويج', 'Denmark': 'الدنمارك',
    'Finland': 'فنلندا', 'Greece': 'اليونان', 'Hungary': 'المجر', 'Czech Republic': 'التشيك',
    'Slovakia': 'سلوفاكيا', 'Romania': 'رومانيا', 'Bulgaria': 'بلغاريا', 'Croatia': 'كرواتيا',
    'Serbia': 'صربيا', 'Slovenia': 'سلوفينيا', 'Portugal': 'البرتغال', 'Russia': 'روسيا',
    'Ukraine': 'أوكرانيا', 'United Kingdom': 'المملكة المتحدة', 'Ireland': 'أيرلندا', 'United States': 'الولايات المتحدة',
    'Canada': 'كندا', 'Mexico': 'المكسيك', 'Brazil': 'البرازيل', 'Argentina': 'الأرجنتين',
    'Chile': 'تشيلي', 'Colombia': 'كولومبيا', 'Peru': 'بيرو', 'Venezuela': 'فنزويلا',
    'China': 'الصين', 'Japan': 'اليابان', 'South Korea': 'كوريا الجنوبية', 'India': 'الهند',
    'Thailand': 'تايلاند', 'Vietnam': 'فيتنام', 'Indonesia': 'إندونيسيا', 'Malaysia': 'ماليزيا',
    'Philippines': 'الفلبين', 'Australia': 'أستراليا', 'New Zealand': 'نيوزيلندا', 'Israel': 'إسرائيل',
    'Egypt': 'مصر', 'Saudi Arabia': 'المملكة العربية السعودية', 'United Arab Emirates': 'الإمارات العربية المتحدة',
    'Lebanon': 'لبنان', 'Jordan': 'الأردن', 'Pakistan': 'باكستان', 'Bangladesh': 'بنغلاديش', 'Iran': 'إيران'
  }
};

// Helper function to get native country name for a given language
export function getNativeCountryName(englishCountryName: string, language: string): string {
  if (!NATIVE_COUNTRY_NAMES[language]) {
    return englishCountryName; // Fallback to English if language not in mapping
  }
  return NATIVE_COUNTRY_NAMES[language][englishCountryName] || englishCountryName;
}

// Reverse mapping: Country name to country code for automatic redirection
// Includes common language variations and native names for major countries
export const COUNTRY_TO_CODE: { [key: string]: string } = {
  'United States': 'us',
  'The United States Of America': 'us',
  'United Kingdom': 'gb',
  'Turkey': 'tr',
  'Türkiye': 'tr',  // Native Turkish name
  'Germany': 'de',
  'Deutschland': 'de',  // Native German name
  'Austria': 'at',
  'Switzerland': 'ch',
  'Liechtenstein': 'li',
  'France': 'fr',
  'Spain': 'es',
  'España': 'es',  // Native Spanish name
  'Italy': 'it',
  'Italia': 'it',  // Native Italian name
  'Portugal': 'pt',
  'Brazil': 'br',
  'Brasil': 'br',  // Native Portuguese name
  'Netherlands': 'nl',
  'Belgium': 'be',
  'Russia': 'ru',
  'Poland': 'pl',
  'Sweden': 'se',
  'Denmark': 'dk',
  'Norway': 'no',
  'Finland': 'fi',
  'Greece': 'gr',
  'Hungary': 'hu',
  'Czech Republic': 'cz',
  'Czechia': 'cz',  // Modern alternative name
  'Slovakia': 'sk',
  'Romania': 'ro',
  'Bulgaria': 'bg',
  'Croatia': 'hr',
  'Serbia': 'rs',
  'Slovenia': 'si',
  'Latvia': 'lv',
  'Lithuania': 'lt',
  'Estonia': 'ee',
  'China': 'cn',
  'Japan': 'jp',
  'South Korea': 'kr',
  'India': 'in',
  'Thailand': 'th',
  'Vietnam': 'vn',
  'Indonesia': 'id',
  'Malaysia': 'my',
  'Philippines': 'ph',
  'Israel': 'il',
  'Iran': 'ir',
  'Pakistan': 'pk',
  'Bangladesh': 'bd',
  'Kenya': 'ke',
  'Ethiopia': 'et',
  'South Africa': 'za',
  'Australia': 'au',
  'Canada': 'ca',
  'Mexico': 'mx',
  'Argentina': 'ar',
  'Chile': 'cl',
  'Colombia': 'co',
  'Peru': 'pe',
  'Venezuela': 've',
  'Bolivarian Republic Of Venezuela': 've',
  'Ecuador': 'ec',
  'Bolivia': 'bo',
  'Uruguay': 'uy',
  'Paraguay': 'py',
  'Costa Rica': 'cr',
  'Panama': 'pa',
  'Guatemala': 'gt',
  'Cuba': 'cu',
  'Dominican Republic': 'do',
  'Puerto Rico': 'pr',
  'Honduras': 'hn',
  'El Salvador': 'sv',
  'Nicaragua': 'ni',
  'Nigeria': 'ng',
  'Ghana': 'gh',
  'Senegal': 'sn',
  'Mali': 'ml',
  'Burkina Faso': 'bf',
  'Burundi': 'bi',
  "Cote d'Ivoire": 'ci',
  'Coted Ivoire': 'ci',
  'Cameroon': 'cm',
  'Rwanda': 'rw',
  'Botswana': 'bw',
  'Namibia': 'na',
  'Zimbabwe': 'zw',
  'Zambia': 'zm',
  'Malawi': 'mw',
  'Mozambique': 'mz',
  'Madagascar': 'mg',
  'Mauritius': 'mu',
  'Tanzania': 'tz',
  'Uganda': 'ug',
  'Aland Islands': 'ax',
  'Grenada': 'gd',
  'Greenland': 'gl',
  'Saudi Arabia': 'sa',
  'Bhutan': 'bt',
  'Bosnia And Herzegovina': 'ba',
  'Montenegro': 'me',
  'North Macedonia': 'mk',
  
  // Arabic-speaking countries (ISO 3166-1 alpha-2 codes)
  'United Arab Emirates': 'ae',
  'Bahrain': 'bh',
  'Djibouti': 'dj',
  'Algeria': 'dz',
  'Egypt': 'eg',
  'Iraq': 'iq',
  'Jordan': 'jo',
  'Kuwait': 'kw',
  'Lebanon': 'lb',
  'Libya': 'ly',
  'Mauritania': 'mr',
  'Morocco': 'ma',
  'Oman': 'om',
  'Qatar': 'qa',
  'Sudan': 'sd',
  'Syria': 'sy',
  'Chad': 'td',
  'Tunisia': 'tn',
  'Yemen': 'ye',
  'Afghanistan': 'af',
  'Albania': 'al',
  'Ireland': 'ie',
  'Luxembourg': 'lu',
  'Iceland': 'is',
  'Malta': 'mt',
  'Cyprus': 'cy',
  'Ukraine': 'ua',
  'Belarus': 'by',
  'Moldova': 'md',
  'Georgia': 'ge',
  'Armenia': 'am',
  'Azerbaijan': 'az',
  'Kazakhstan': 'kz',
  'Uzbekistan': 'uz',
  'Turkmenistan': 'tm',
  'Kyrgyzstan': 'kg',
  'Tajikistan': 'tj',
  'Mongolia': 'mn',
  'Nepal': 'np',
  'Sri Lanka': 'lk',
  'Myanmar': 'mm',
  'Cambodia': 'kh',
  'Laos': 'la',
  'Singapore': 'sg',
  'Brunei': 'bn',
  'Taiwan': 'tw',
  'Hong Kong': 'hk',
  'Macao': 'mo',
  'North Korea': 'kp',
  'New Zealand': 'nz',
  'Papua New Guinea': 'pg',
  'Fiji': 'fj',
  'Vanuatu': 'vu',
  'Solomon Islands': 'sb',
  'Samoa': 'ws',
  'Tonga': 'to',
  'Kiribati': 'ki',
  'Tuvalu': 'tv',
  'Nauru': 'nr',
  'Palau': 'pw',
  'Marshall Islands': 'mh',
  'Micronesia': 'fm'
};

// Helper function to get country code from country name
export function getCountryCodeFromName(countryName: string): string | null {
  return COUNTRY_TO_CODE[countryName] || null;
}

// Complete reverse mapping: Handles all 232 API countries + aliases
export function getCountryCodeFromApiName(countryName: string): string {
  // First try the alias mapping (handles "Germany", "Türkiye", "Turkey", etc.)
  if (COUNTRY_TO_CODE[countryName]) {
    return COUNTRY_TO_CODE[countryName];
  }
  
  // Then search CODE_TO_COUNTRY for exact match (covers all 232 API country names)
  for (const [code, name] of Object.entries(CODE_TO_COUNTRY)) {
    if (name === countryName) {
      return code;
    }
  }
  
  // Fallback: use first two letters
  return countryName.substring(0, 2).toLowerCase();
}

// Module-level cache for database country-language mappings (server-side only)
let databaseMappingsCache: Map<string, string> | null = null;

// Function to set database mappings (called from server-side performance cache)
export function setDatabaseCountryLanguageMappings(mappings: Map<string, string>) {
  databaseMappingsCache = mappings;
}

// Function to get database mappings (for server-side loading)
export async function loadDatabaseCountryLanguageMappings(): Promise<void> {
  // Only run on server-side
  if (typeof window !== 'undefined') return;
  
  try {
    const { performanceCache } = await import('../server/performance-cache');
    const mappings = await performanceCache.getCountryLanguageMappings();
    setDatabaseCountryLanguageMappings(mappings);
  } catch (error) {
    console.error('❌ Failed to load database country-language mappings:', error);
  }
}

// Helper to get user's preferred language from localStorage (client-side only)
function getStoredPreferredLanguage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('preferredLanguage');
  } catch {
    return null;
  }
}

export function getLanguageFromPath(pathname: string): { language: string; cleanPath: string } {
  const pathSegments = pathname.split('/').filter(Boolean);
  const firstSegment = pathSegments[0];
  
  // Get user's stored language preference (client-side)
  const storedPreference = getStoredPreferredLanguage();
  
  // CRITICAL: Normalize to lowercase for consistent lookup
  const normalizedFirstSegment = firstSegment?.toLowerCase();
  
  // CRITICAL FIX: Check LANGUAGE codes FIRST (priority over country codes)
  // This ensures /ar → Arabic, /de → German, /tr → Turkish work correctly
  // Previously checked country codes first which caused /ar to map to Argentina → English
  if (normalizedFirstSegment && normalizedFirstSegment.length === 2) {
    // PRIORITY 1: Check if it's a valid LANGUAGE code in SEO_LANGUAGES
    const isValidLanguage = SEO_LANGUAGES.find(lang => lang.code === normalizedFirstSegment && lang.enabled);
    
    if (isValidLanguage) {
      // It's a language code! Handle it as language, not country
      const pathWithoutLang = '/' + pathSegments.slice(1).join('/');
      const englishPath = normalizedFirstSegment !== 'en' 
        ? reverseTranslateUrl(pathWithoutLang, normalizedFirstSegment)
        : pathWithoutLang;
      
      return {
        language: normalizedFirstSegment,
        cleanPath: englishPath || '/'
      };
    }
    
    // PRIORITY 2: Check database mappings (admin-configured country mappings)
    let mappedLanguage = databaseMappingsCache?.get(normalizedFirstSegment);
    
    // PRIORITY 3: Fall back to hardcoded COUNTRY_TO_LANGUAGE mapping
    if (!mappedLanguage) {
      mappedLanguage = COUNTRY_TO_LANGUAGE[normalizedFirstSegment];
    }
    
    // CRITICAL DEBUG: Log if country code lookup fails
    if (typeof window !== 'undefined' && !mappedLanguage) {
      console.error(`❌ getLanguageFromPath: Country code lookup FAILED for '${normalizedFirstSegment}'`, {
        pathname,
        firstSegment: normalizedFirstSegment,
        countryToLanguageKeys: Object.keys(COUNTRY_TO_LANGUAGE).slice(0, 20),
        hasAt: 'at' in COUNTRY_TO_LANGUAGE,
        atValue: COUNTRY_TO_LANGUAGE['at']
      });
    }
    
    if (mappedLanguage) {
      // Get the path without country code
      const pathWithoutCountry = '/' + pathSegments.slice(1).join('/');
      
      // CRITICAL FIX: Language/Country separation
      // Detect language from PATH TRANSLATION, not from country code
      // Example: /de/radyolar → path 'radyolar' is Turkish → language = 'tr'
      // Example: /de/sendestädte → path 'sendestädte' is German → language = 'de'
      let actualLanguage = mappedLanguage;
      let englishPath = pathWithoutCountry;
      
      // Try to detect language from path by checking which language's translation matches
      const enabledLanguages = SEO_LANGUAGES.filter(lang => lang.enabled);
      let detectedFromPath = false;
      
      for (const lang of enabledLanguages) {
        if (lang.code === 'en') continue; // Skip English, it's the base
        
        const testEnglishPath = reverseTranslateUrl(pathWithoutCountry, lang.code);
        // If reverse translation produces a DIFFERENT path, this language matches
        if (testEnglishPath !== pathWithoutCountry) {
          actualLanguage = lang.code;
          englishPath = testEnglishPath;
          detectedFromPath = true;
          
          break;
        }
      }
      
      // If no translation found, use stored preference or fallback
      if (!detectedFromPath) {
        if (pathWithoutCountry === '/') {
          // Root path (e.g., /de/) - use stored preference or country's language
          actualLanguage = storedPreference || mappedLanguage;
          englishPath = '/';
        } else {
          // Path is in English (no translation match) - use stored preference or English
          actualLanguage = storedPreference || 'en';
          englishPath = pathWithoutCountry;
        }
      }
      
      return {
        language: actualLanguage,
        cleanPath: englishPath
      };
    }
    
    // If it's a 2-letter code but not in country mapping, check if it's a language code
    const language = SEO_LANGUAGES.find(lang => lang.code === firstSegment);
    
    if (language) {
      // Get the path without language prefix
      const pathWithoutLang = '/' + pathSegments.slice(1).join('/');
      
      // CRITICAL FIX: Reverse-translate the URL back to English for routing
      // Example: /tr/sizin-icin → /recommendations
      const englishPath = language.code !== 'en' 
        ? reverseTranslateUrl(pathWithoutLang, language.code)
        : pathWithoutLang;
      
      return {
        language: language.code,
        cleanPath: englishPath
      };
    }
    
    // If it's a country code but no translation available, use English but preserve the country context
    return {
      language: DEFAULT_LANGUAGE,
      cleanPath: '/' + pathSegments.slice(1).join('/')
    };
  }
  
  return {
    language: DEFAULT_LANGUAGE,
    cleanPath: pathname
  };
}

/**
 * Generate language alternate URLs for hreflang tags (Google SEO requirement)
 * 
 * BIDIRECTIONAL LINKING IMPLEMENTATION:
 * This function ensures bidirectional hreflang linking, which is required by Google.
 * 
 * How bidirectional linking works:
 * 1. Every page in every language calls this function with the SAME cleanPath (English base path)
 * 2. Each call generates links to ALL other language versions
 * 3. This creates automatic bidirectional links:
 *    - English /genres page → links to /tr/turler, /de/genres, /es/generos, etc.
 *    - Turkish /tr/turler page → links to /genres (en), /de/genres, /es/generos, etc.
 *    - German /de/genres page → links to /genres (en), /tr/turler, /es/generos, etc.
 * 
 * Example for /genres page:
 * - EN page (https://example.com/genres) includes:
 *   <link rel="alternate" hreflang="en" href="https://example.com/en/genres">
 *   <link rel="alternate" hreflang="tr" href="https://example.com/tr/turler">
 *   <link rel="alternate" hreflang="de" href="https://example.com/de/genres">
 *   <link rel="alternate" hreflang="x-default" href="https://example.com/en/genres">
 * 
 * - TR page (https://example.com/tr/turler) includes THE SAME hreflang tags:
 *   <link rel="alternate" hreflang="en" href="https://example.com/en/genres">
 *   <link rel="alternate" hreflang="tr" href="https://example.com/tr/turler">
 *   <link rel="alternate" hreflang="de" href="https://example.com/de/genres">
 *   <link rel="alternate" hreflang="x-default" href="https://example.com/en/genres">
 * 
 * This bidirectional linking is verified by:
 * - All pages for the same content share the same cleanPath
 * - All pages generate the complete set of hreflang links
 * - x-default always points to the canonical English version
 * 
 * @param cleanPath - The English canonical path (e.g., "/genres", "/station/abc")
 * @param currentDomain - The domain for absolute URLs (e.g., "https://example.com")
 * @param currentLanguage - The language of the current page (used for context, not filtering)
 * @param translationMap - Optional URL translation map for localized paths (e.g., "tr:genres" -> "turler")
 * @returns Array of hreflang objects with lang code, URL, and hreflang attribute value
 */
// Fallback translations for common route segments across all languages
// CRITICAL: All values MUST use ONLY Latin characters for SEO-safe URLs
// Used when database translations are not available
const FALLBACK_SEGMENT_TRANSLATIONS: Record<string, Record<string, string>> = {
  'station': {
    'af': 'stasie',
    'am': 'ጣቢያ',
    'ar': 'mahta',
    'az': 'stansiya',
    'bg': 'stantsiya',
    'bn': 'স্টেশন',
    'cs': 'stanice',
    'da': 'station',
    'de': 'sender',
    'el': 'σταθμος',
    'es': 'estacion',
    'et': 'jaam',
    'fa': 'station',
    'fi': 'asema',
    'fr': 'station',
    'gu': 'સ્ટેશન',
    'he': 'tachana',
    'hi': 'station',
    'hr': 'stanica',
    'hu': 'radio',
    'hy': 'ստացիա',
    'id': 'stasiun',
    'it': 'stazione',
    'ja': 'ステーション',
    'kn': 'ನಿಲ್ದಾಣ',
    'ko': '스테이션',
    'lt': 'stotis',
    'lv': 'stacija',
    'ml': 'nilayam',
    'mr': 'steshan',
    'ms': 'stesen',
    'nl': 'station',
    'no': 'stasjon',
    'pa': 'steshan',
    'pl': 'stacja',
    'pt': 'estacao',
    'ro': 'statie',
    'ru': 'stantsiya',
    'sk': 'stanica',
    'sl': 'postaja',
    'so': 'station',
    'sq': 'stacion',
    'sr': 'stanica',
    'sv': 'station',
    'sw': 'stesheni',
    'ta': 'நிலையம்',
    'te': 'steshan',
    'th': 'สถานี',
    'tl': 'istasyon',
    'tr': 'istasyon',
    'uk': 'станція',
    'ur': 'اسٹیشن',
    'vi': 'dai',
    'zh': '电台',
    'zh-CN': '电台',
    'zu': 'isiteshi',
  },
  'stations': {
    'af': 'stasies',
    'am': 'ጣቢያዎች',
    'ar': 'mahtat',
    'az': 'stansiyalar',
    'bg': 'stantsii',
    'bn': 'স্টেশনসমূহ',
    'cs': 'stanice',
    'da': 'stationer',
    'de': 'sender',
    'el': 'σταθμοι',
    'es': 'estaciones',
    'et': 'jaamad',
    'fa': 'stations',
    'fi': 'asemat',
    'fr': 'stations',
    'gu': 'સ્ટેશનો',
    'he': 'tachanot',
    'hi': 'stations',
    'hr': 'stanice',
    'hu': 'radios',
    'hy': 'ստացիաներ',
    'id': 'stasiun',
    'it': 'stazioni',
    'ja': 'ステーション',
    'kn': 'ನಿಲ್ದಾಣಗಳು',
    'ko': '스테이션',
    'lt': 'stotys',
    'lv': 'stacijas',
    'ml': 'nilayangal',
    'mr': 'steshane',
    'ms': 'stesen',
    'nl': 'stations',
    'no': 'stasjoner',
    'pa': 'steshan',
    'pl': 'stacje',
    'pt': 'estacoes',
    'ro': 'staties',
    'ru': 'stantsii',
    'sk': 'stanice',
    'sl': 'postaje',
    'so': 'stations',
    'sq': 'stacione',
    'sr': 'stanice',
    'sv': 'stationer',
    'sw': 'stesheni',
    'ta': 'நிலைகள்',
    'te': 'steshanlu',
    'th': 'สถานี',
    'tl': 'mga-istasyon',
    'tr': 'istasyonlar',
    'uk': 'станції',
    'ur': 'اسٹیشنز',
    'vi': 'cac-dai',
    'zh': '电台',
    'zh-CN': '电台',
    'zu': 'iziteshi',
  },
};


export function generateLanguageUrls(
  cleanPath: string, 
  currentDomain: string = '', 
  currentLanguage: string = DEFAULT_LANGUAGE,
  translationMap?: Map<string, string>,
  currentUrl?: string,  // CRITICAL: Add current URL for self-referential hreflang
  // CRITICAL SEO P0: Explicit allow-list of language codes that may appear in
  // the hreflang output. Pass for station pages so we only advertise the
  // languages that are actually indexable for that station (eligible ∩
  // qualified). Pass `[]` for junk/noIndex pages to suppress ALL alternates
  // (Google: do not expose alternates for noindex pages).
  // `undefined` preserves legacy behaviour (emit every enabled language).
  allowedLanguages?: string[] | ReadonlyArray<string> | null,
): Array<{ lang: string; url: string; hreflang: string }> {
  // Normalise the allow-list. `null` and `undefined` both mean "no filter",
  // but an empty ARRAY is a meaningful signal of "emit zero alternates".
  const allowlistProvided =
    allowedLanguages !== undefined && allowedLanguages !== null;
  const allowSet = allowlistProvided
    ? new Set(allowedLanguages!.map((l) => l.toLowerCase()))
    : null;

  // If an explicit empty allow-list is passed, short-circuit — a noindex/junk
  // page must not surface ANY hreflang alternates (including x-default).
  if (allowlistProvided && allowSet!.size === 0) {
    return [];
  }

  const seenHreflangs = new Set<string>();
  const seenUrls = new Set<string>();
  const validUrls: Array<{ lang: string; url: string; hreflang: string }> = [];

  // CRITICAL SEO FIX: Build self-referential hreflang entry first
  // Every page must have a hreflang link pointing to itself
  // UPDATED: All languages (including English) use /{lang}/* pattern
  const currentLangConfig = SEO_LANGUAGES.find(l => l.code === currentLanguage);
  const selfReferentialUrl = currentUrl || `${currentDomain}/${currentLanguage}${cleanPath}`;
  
  const hreflangs = SEO_LANGUAGES
    .filter(lang => lang.enabled)
    .filter(lang => !allowSet || allowSet.has(lang.code.toLowerCase()))
    .map(lang => {
      let url: string;
      
      // CRITICAL: If this is the current language, use the exact current URL (self-referential)
      if (lang.code === currentLanguage && currentUrl) {
        url = currentUrl;
      } else if (lang.isDefault) {
        // UPDATED: English also uses /en prefix for consistency
        // All languages follow /{lang}/* pattern
        url = `${currentDomain}/en${cleanPath}`;
      } else {
        // Build translation map key: "languageCode:segment"
        // For a path like "/station/abc", we look for "tr:station" for Turkish
        // CRITICAL FIX: Don't translate station slugs - only translate route segments
        const pathSegments = cleanPath.split('/').filter(Boolean);
        const translatedSegments = pathSegments.map((segment, index) => {
          // Check if this is a station/station ID segment
          const isStationPath = cleanPath.includes('/station/') || cleanPath.includes('/stations/');
          const isStationSlug = isStationPath && index === 1; // Second segment is the slug
          
          // Never translate station slugs - they're unique identifiers
          if (isStationSlug) {
            return segment;
          }
          
          // Try database translation first, then fallback to built-in translations
          let translated: string | undefined;
          
          // Try database translation map
          if (translationMap && translationMap.size > 0) {
            const key = `${lang.code}:${segment}`;
            translated = translationMap.get(key);
          }
          
          // Fall back to built-in translations if not found in database
          if (!translated && FALLBACK_SEGMENT_TRANSLATIONS[segment]) {
            translated = FALLBACK_SEGMENT_TRANSLATIONS[segment][lang.code];
          }
          
          return translated || segment;
        });
        
        const translatedPath = translatedSegments.length > 0 
          ? '/' + translatedSegments.join('/') 
          : '';
        
        url = `${currentDomain}/${lang.code}${translatedPath}`;
      }
      
      const hreflang = lang.code;
      
      return {
        lang: lang.code,
        url,
        hreflang
      };
    })
    .filter(item => {
      // Remove duplicates by URL and hreflang
      if (seenUrls.has(item.url) || seenHreflangs.has(item.hreflang)) {
        return false;
      }
      
      seenUrls.add(item.url);
      seenHreflangs.add(item.hreflang);
      return true;
    });
  
  // x-default: only emit if English is in the allow-list (or no allow-list is
  // set). For a station whose indexable set is [de, tr] we should NOT point
  // x-default at /en/... because that URL is noindex for this station —
  // fall back to the first allowed language instead.
  if (!allowSet || allowSet.has('en')) {
    return hreflangs.concat([
      {
        lang: 'x-default',
        url: `${currentDomain}/en${cleanPath}`,
        hreflang: 'x-default'
      }
    ]);
  }

  // No English in allow-list: point x-default at the first allowed language's
  // URL (already built above). Falls back to current-language URL if the
  // allow-list somehow yielded nothing above the duplicate filter.
  const fallback = hreflangs[0];
  if (fallback) {
    return hreflangs.concat([
      { lang: 'x-default', url: fallback.url, hreflang: 'x-default' },
    ]);
  }
  return hreflangs;
}

export interface SeoMetaTags {
  title: string;
  description: string;
  keywords?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogUrl?: string;
  ogType?: string;
  ogSiteName?: string;
  ogLocale?: string;
  ogLocaleAlternates?: string[];
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  canonical?: string;
  robots?: string;
  language?: string;
  domain?: string;
  hreflangs?: Array<{ lang: string; url: string; hreflang: string }>;
}

// Helper function to generate localized station title with unique formatting per language
export function generateLocalizedStationTitle(station: any, language: string, translations: Record<string, string>): string {
  const stationName = station.name;
  
  // Use native country name based on language
  const nativeCountry = station.country ? getNativeCountryName(station.country, language) : null;
  
  // Use DB translation key 'seo_from' first, then hardcoded fallbacks per language
  const fromFallbacks: Record<string, string> = {
    'tr': 'den',
    'de': 'aus',
    'fr': 'de',
    'es': 'de',
    'it': 'da',
    'pt': 'de',
    'nl': 'uit',
    'ru': 'из',
    'pl': 'z',
    'ar': 'من',
    'ja': 'から',
    'zh': '来自',
    'ko': '에서',
    'hi': 'से',
  };
  
  let countryPart = '';
  if (nativeCountry) {
    const fromWord = translations['seo_from'] || fromFallbacks[language] || 'from';
    if (language === 'tr') {
      countryPart = ` ${nativeCountry}'${fromWord}`;
    } else {
      countryPart = ` ${fromWord} ${nativeCountry}`;
    }
  }
  
  // Use DB key 'seo_listen_live_online' for "Listen Live" text, with fallback
  const listenLiveText = translations['seo_listen_live_online'] || translations['listen_live'] || 'Listen Live';
  
  // Use database translation for the page title format, fallback to default
  const pageTitle = translations['radio_playing_page.title'] || '{station_name}{country_part} — {listen_live}';
  
  // Replace placeholders with actual values (handle both lowercase and uppercase)
  let title = pageTitle
    .replace(/{STATION_NAME}|{station_name}/g, stationName)
    .replace(/{COUNTRY_PART}|{country_part}/g, countryPart)
    .replace(/{LISTEN_LIVE}|{listen_live}/g, listenLiveText);
  
  return title;
}

// ENHANCED Helper function to generate language-specific station description (FULL version for frontend)
// Priority: (1) AI-generated custom description, (2) Fallback to template
// 2-sentence structure for fallback: (1) Hook with station + location + format, (2) Amplify with details
export function getLocalizedStationDescription(station: any, language: string, translations: Record<string, string>): string {
  // PRIORITY 1: Use AI-generated custom description if available
  if (station.descriptions && station.descriptions[language]) {
    const desc = station.descriptions[language];
    // Handle new object format {full, meta}
    if (typeof desc === 'object' && desc.full) {
      // Strip placeholder text if present
      let fullDesc = desc.full.replace(/^\[FULL DESCRIPTION - 200-300 words\]\s*/i, '').trim();
      return fullDesc;
    }
    // Handle old string format
    if (typeof desc === 'string') {
      // Strip placeholder text if present
      let strDesc = desc.replace(/^\[FULL DESCRIPTION - 200-300 words\]\s*/i, '').replace(/^\[SEO META - 155-160 characters\]\s*/i, '').trim();
      return strDesc;
    }
  }
  
  // FALLBACK: Generate template-based description
  const parts: string[] = [];
  
  // Sentence 1: Hook - Station + Location + Primary Action
  const listenLive = translations['listen_live'] || 'Listen live';
  const broadcastingFrom = translations['broadcasting_from'] || 'broadcasting from';
  const freeStream = translations['free_stream'] || 'free online';
  
  let sentence1 = `${listenLive} ${station.name}`;
  
  if (station.country) {
    // Use native country name based on language instead of English country name
    const nativeCountry = getNativeCountryName(station.country, language);
    sentence1 += ` ${broadcastingFrom} ${nativeCountry}`;
  }
  
  // Add language if available
  if (station.language && station.language !== 'unknown') {
    const inLanguage = translations['in_language'] || 'in';
    sentence1 += ` ${inLanguage} ${station.language}`;
  }
  
  sentence1 += ` ${freeStream}.`;
  parts.push(sentence1);
  
  // Sentence 2: Amplification - Genres + Quality + Engagement
  const sentence2Parts: string[] = [];
  
  // Add genres
  if (station.tags) {
    const genres = station.tags.split(',').slice(0, 3).join(', ');
    sentence2Parts.push(genres);
  }
  
  // Add quality indicator
  if (station.bitrate && station.bitrate >= 128) {
    const highQuality = translations['high_quality_stream'] || 'high quality audio';
    sentence2Parts.push(highQuality);
  }
  
  // Add popularity if votes exist
  if (station.votes && station.votes > 1000) {
    const topRated = translations['top_rated'] || 'top rated';
    sentence2Parts.push(topRated);
  }
  
  if (sentence2Parts.length > 0) {
    const featuring = translations['featuring'] || 'Featuring';
    const internetRadio = translations['internet_radio'] || 'internet radio station';
    parts.push(`${featuring} ${sentence2Parts.join(', ')} ${internetRadio}.`);
  }
  
  return parts.join(' ');
}

// NEW: Helper function to extract META description specifically for SEO meta tags
// Returns 155-160 character meta description from AI-generated content
// PRIORITY: AI description > database translation (trending_no_stations_message) > generic fallback
export function getStationMetaDescription(station: any, language: string, translations: Record<string, string>): string {
  // PRIORITY 1: Use AI-generated meta description if available
  if (station.descriptions && station.descriptions[language]) {
    const desc = station.descriptions[language];
    // Handle new object format {full, meta}
    if (typeof desc === 'object' && desc.meta) {
      // Strip placeholder text if present - handle both [TRANSLATED META...] and [SEO META...]
      let metaDesc = desc.meta
        .replace(/^\s*\[TRANSLATED\s+META[^\]]*\]\s*/i, '')  // Remove [TRANSLATED META...]
        .replace(/^\s*\[SEO\s+META[^\]]*\]\s*/i, '')  // Remove [SEO META...]
        .replace(/^\s*\[[^\]]*META[^\]]*\]\s*/i, '')  // Remove any bracketed META placeholder
        .trim();
      return metaDesc;
    }
    // If only full is available, use it as fallback
    if (typeof desc === 'object' && desc.full) {
      let fullDesc = desc.full
        .replace(/^\s*\[TRANSLATED\s+FULL\s+DESCRIPTION\]\s*/i, '')  // Remove [TRANSLATED FULL DESCRIPTION]
        .replace(/^\s*\[FULL\s+DESCRIPTION[^\]]*\]\s*/i, '')  // Remove [FULL DESCRIPTION...]
        .trim();
      return fullDesc.substring(0, 160);
    }
    // Handle old string format - truncate to meta description length
    if (typeof desc === 'string') {
      let strDesc = desc
        .replace(/^\s*\[TRANSLATED\s+META[^\]]*\]\s*/i, '')  // Remove [TRANSLATED META...]
        .replace(/^\s*\[SEO\s+META[^\]]*\]\s*/i, '')  // Remove [SEO META...]
        .replace(/^\s*\[FULL\s+DESCRIPTION[^\]]*\]\s*/i, '')  // Remove [FULL DESCRIPTION...]
        .trim();
      return strDesc.substring(0, 160);
    }
  }
  
  // PRIORITY 2: Use database translation (default_station_about) with station name
  // This key contains the localized "currently listening to" template for each language
  // Falls back to trending_no_stations_message if default_station_about not found
  let dbFallbackTemplate = translations['default_station_about'] || translations['trending_no_stations_message'];
  if (dbFallbackTemplate) {
    // Replace placeholder patterns with actual station name
    let metaDesc = dbFallbackTemplate
      .replace('{station_name}', station.name)
      .replace('${station.name}', station.name)
      .replace('{STATION_NAME}', station.name)
      .replace('{station}', station.name);
    return metaDesc.substring(0, 160);
  }
  
  // FALLBACK 3: Generic template-based description (Bing SEO: target 150-160 chars).
  // Adds genre tags + free streaming + multi-device language so even AI-less stations
  // produce a Bing-acceptable description length.
  const stationName = station.name;
  const nativeCountry = station.country ? getNativeCountryName(station.country, language) : null;
  const listenLive = translations['listen_live'] || 'Listen live';
  const fromWord = translations['from'] || 'from';
  const onlineWord = translations['online'] || 'online';
  const freeStreaming = translations['free_streaming'] || 'Free live streaming';
  const onMegaRadio = translations['on_mega_radio'] || 'on Mega Radio';
  const desktopMobile = translations['desktop_and_mobile'] || 'desktop and mobile';

  // Genre fragment from station tags
  let genreFragment = '';
  if (station.tags && typeof station.tags === 'string') {
    const topTags = station.tags.split(',').map((t: string) => t.trim()).filter(Boolean).slice(0, 3);
    if (topTags.length > 0) {
      genreFragment = ` — ${topTags.join(', ')}`;
    }
  }

  let metaDesc = `${listenLive} ${stationName}${genreFragment}`;
  if (nativeCountry) {
    metaDesc += ` ${fromWord} ${nativeCountry}`;
  }
  metaDesc += ` ${onlineWord}. ${freeStreaming} ${onMegaRadio} — ${desktopMobile}.`;

  // Bing SEO: enforce 150–160 char window. Pad with brand-safe clauses
  // (60,000+ stations, 120+ countries, 24/7) when short station name
  // and missing country/tags leave us under the floor.
  const MIN_LEN = 150;
  const MAX_LEN = 160;
  if (metaDesc.length < MIN_LEN) {
    const padClauses = [
      ` 60,000+ ${translations['stations'] || 'stations'} ${translations['from'] || 'from'} 120+ ${translations['countries'] || 'countries'}.`,
      ` ${translations['twenty_four_seven'] || '24/7 live streaming'}.`,
      ' Mega Radio: free online radio worldwide.',
    ];
    for (const clause of padClauses) {
      if (metaDesc.length >= MIN_LEN) break;
      metaDesc += clause;
    }
  }
  return metaDesc.substring(0, MAX_LEN);
}

// Helper function to check if a language has complete SEO translations for stations
// Used by sitemap generators to determine which languages to include
export function hasCompleteSeoTranslations(translations: Record<string, string>): boolean {
  // Strict v3: a language only qualifies for the sitemap when EVERY required
  // station-SEO translation key is present and non-empty. This prevents Bing /
  // Google from receiving bare /sl, /da, etc. with no localized content,
  // which previously triggered NotIndexedAndMayNeedAttention/ContentQuality.
  if (!translations) return false;
  const allKeys = [...REQUIRED_STATION_SEO_KEYS, ...REQUIRED_HOMEPAGE_SEO_KEYS];
  return allKeys.every(
    (key) => typeof translations[key] === 'string' && translations[key].trim().length > 0,
  );
}

// Helper function to generate ENHANCED localized keywords with SEO best practices
export function generateLocalizedKeywords(station: any, language: string, translations: Record<string, string>): string {
  const keywords: string[] = [];
  
  // Core identifier: Station name
  keywords.push(station.name);
  
  // Location-based keywords (city, country)
  if (station.country) {
    keywords.push(station.country);
    keywords.push(`${station.country} radio`);
    
    // Add "Country + genre radio" for long-tail searches
    if (station.tags) {
      const primaryGenre = station.tags.split(',')[0]?.trim();
      if (primaryGenre) {
        keywords.push(`${station.country} ${primaryGenre} radio`);
      }
    }
  }
  
  // Genre keywords
  if (station.tags) {
    const genres = station.tags.split(',').slice(0, 5).map((g: string) => g.trim());
    keywords.push(...genres);
  }
  
  // Intent-based keywords (translated)
  const listenLive = translations['listen_live'] || 'listen live';
  const freeStream = translations['free_stream'] || 'free stream';
  const liveRadio = translations['live_radio'] || 'live radio';
  const onlineRadio = translations['online_radio'] || 'online radio';
  const internetRadio = translations['internet_radio'] || 'internet radio';
  
  keywords.push(
    `${station.name} ${listenLive}`,
    `${station.name} ${freeStream}`,
    liveRadio,
    onlineRadio,
    internetRadio
  );
  
  // Format/Technical keywords
  if (station.codec) {
    keywords.push(`${station.name} ${station.codec}`);
  }
  
  if (station.bitrate && station.bitrate > 0) {
    const qualityText = translations['high_quality_stream'] || 'high quality';
    keywords.push(`${station.bitrate}kbps`, qualityText);
  }
  
  // Language-specific keywords
  if (station.language && station.language !== 'unknown') {
    keywords.push(`${station.language} radio`);
  }
  
  // Deduplicate and limit to 18 keywords (SEO best practice)
  const uniqueKeywords = Array.from(new Set(keywords)).slice(0, 18);
  
  return uniqueKeywords.join(', ');
}

export function generateSeoTags(
  page: string,
  language: string,
  translations: Record<string, string>,
  cleanPath: string,
  currentDomain: string = '',
  stationData?: any,
  originalPath?: string,  // Add original path to preserve country codes in canonical
  translatedPath?: string,  // Translated path from database for canonical URL
  translationMap?: Map<string, string>  // Translation map for hreflang URLs
): SeoMetaTags {
  // Hardcoded translations for immediate multilingual SEO support
  const hardcodedTranslations: Record<string, Record<string, string>> = {
    tr: {
      'home_page.title': 'Mega Radio: 120 Ülkeden Ücretsiz Canlı Radyo ve Müzik Dinleyin',
      'home_page.description': 'Mega Radio ile canlı radyo dinleyin! 120+ ülkeden 60.000+ AM/FM radyo istasyonu, müzik, haber, spor ve talk show ücretsiz.',
      'genres_page.title': 'Radyo Türleri - Müzik Tarzına Göre Keşfedin | Mega Radio',
      'genres_page.description': 'Türe göre radyo istasyonlarını keşfedin: Pop, Rock, Jazz, Klasik, Haber, Konuşma ve daha fazlası. Mega Radio\'da favori müzik tarzınızı bulun.',
      'regions_page.title': 'Bölgeye Göre Radyo İstasyonları - Küresel Yayıncılık | Mega Radio',
      'regions_page.description': 'Dünyanın farklı bölgelerinden radyo istasyonlarını keşfedin. Her kıtadan yerel yayıncılığı dinleyin.',
      'stations_page.title': 'Tüm Radyo İstasyonları - 60.000+ Canlı Radyoyu Gözden Geçirin | Mega Radio',
      'stations_page.description': 'Dünya çapından 60.000+ radyo istasyonunun tam dizinini gözden geçirin. Yerel ve uluslararası radyo istasyonlarını bulun.',
      // About section content
      'about_mega_radio': 'Mega Radio Hakkında',
      'about_mega_radio_description_1': 'Mega Radio, dünya çapından 60.000+ radyo istasyonunu 120+ ülkeden sizin için bir araya getiren ücretsiz çevrimiçi radyo platformudur. Canlı müzik yayınından haber bültenlerine, spor yorumlarından talk show\'lara kadar her türlü içeriği yüksek kalitede dinleyebilirsiniz.',
      'about_mega_radio_description_2': 'Platformumuz çok dilli desteği ile Türkçe, İngilizce, Almanca, Fransızca, İspanyolca ve daha birçok dilde hizmet vermektedir. Mobil uyumlu tasarımı sayesinde her cihazdan kolayca erişebilir, favori istasyonlarınızı işaretleyebilir ve kişiselleştirilmiş öneriler alabilirsiniz.',
      'features_title': 'Özellikler',
      'feature_live_streaming': 'Canlı radyo yayını kesintisiz dinleme',
      'feature_multilingual': 'Çok dilli platform desteği',
      'feature_global_coverage': 'Dünya çapında geniş istasyon ağı',
      'feature_high_quality': 'Yüksek kalite ses streaming',
      'coverage_title': 'Kapsam',
      'coverage_stations': '60.000+ radyo istasyonu',
      'coverage_countries': '120+ ülke kapsamı',
      'coverage_languages': '45+ dil desteği',
      'coverage_genres': 'Tüm müzik türleri mevcut',
      // Social sharing translations
      'share_mega_radio': 'Mega Radio\'yu Paylaş',
      'share_on': 'Şurada paylaş:',
      'copy_link': 'Bağlantıyı Kopyala',
      'copied': 'Kopyalandı!',
      'share': 'Paylaş',
      'share_description': 'Dünyanın dört bir yanından harika radyo istasyonlarını keşfetmelerine yardımcı ol!',
      // H1 heading translations for SEO
      'hero_worlds_best_radio': 'Mega Radio: 120 Ülkeden Ücretsiz Canlı Radyo Yayını',
      'hero_over_100_countries': '120+ ülkeden 60.000+ radyo istasyonu',
      'hero_listen_everywhere': 'Her yerde, her zaman ücretsiz dinle',
      // Navigation translations for SEO
      'nav_genres': 'Radyo Türleri',
      'nav_regions': 'Ülkelere Göre Radyo',
      'nav_stations': 'Tüm İstasyonlar',
      'nav_for_you': 'Sizin İçin',
      'nav_users': 'Topluluk',
      'nav_about': 'Hakkımızda',
      'nav_contact': 'İletişim',
      'nav_privacy': 'Gizlilik Politikası',
      'nav_terms': 'Kullanım Şartları',
      'nav_apps': 'Mobil Uygulamalar',
      // Additional heading translations
      'explore_mega_radio': 'Mega Radio\'yu Keşfedin',
      'popular_genres_title': 'Popüler Radyo Türleri',
      'popular_countries_title': 'Ülkelere Göre Radyo İstasyonları',
      'more_information': 'Daha Fazla Bilgi',
      // External links translations
      'external_resources': 'Dış Kaynaklar',
      'flixapp_tv': 'FlixApp TV - Eğlence Platformu',
      'radio_browser': 'Radio Browser - Açık Radyo Veritabanı',
      'musicbrainz': 'MusicBrainz - Müzik Metadata'
    },
    de: {
      'home_page.title': 'Mega Radio: Kostenlos Live-Radio & Musik aus 120 Ländern hören',
      'home_page.description': 'Hören Sie Live-Radio online mit Mega Radio! 60.000+ AM/FM-Sender aus 120+ Ländern, Musik, Nachrichten, Sport und Talk-Shows kostenlos.',
      'genres_page.title': 'Radio-Genres - Musik nach Stil entdecken | Mega Radio',
      'genres_page.description': 'Entdecken Sie Radiosender nach Genre: Pop, Rock, Jazz, Klassik, Nachrichten, Talk und mehr. Finden Sie Ihren Lieblings-Musikstil auf Mega Radio.',
      'regions_page.title': 'Radiosender nach Region - Globale Ausstrahlung | Mega Radio',
      'regions_page.description': 'Entdecken Sie Radiosender aus verschiedenen Regionen der Welt. Hören Sie lokale Übertragungen von jedem Kontinent.',
      'stations_page.title': 'Alle Radiosender - Durchsuchen Sie 60.000+ Live-Radio | Mega Radio',
      'stations_page.description': 'Durchsuchen Sie unser komplettes Verzeichnis von 60.000+ Radiosendern aus der ganzen Welt. Finden Sie lokale und internationale Radiosender.',
      // About section content
      'about_mega_radio': 'Über Mega Radio',
      'about_mega_radio_description_1': 'Mega Radio ist Ihre kostenlose Online-Radio-Plattform mit über 60.000 Radiosendern aus 120+ Ländern weltweit. Von Live-Musik über Nachrichten bis hin zu Sportsendungen und Talk-Shows können Sie alles in hoher Qualität genießen.',
      'about_mega_radio_description_2': 'Unsere Plattform bietet mehrsprachige Unterstützung in Deutsch, Englisch, Türkisch, Französisch, Spanisch und vielen weiteren Sprachen. Dank des mobilen responsive Designs können Sie von jedem Gerät aus zugreifen, Lieblingssender markieren und personalisierte Empfehlungen erhalten.',
      'features_title': 'Funktionen',
      'feature_live_streaming': 'Unterbrechungsfreies Live-Radio-Streaming',
      'feature_multilingual': 'Mehrsprachige Plattform-Unterstützung',
      'feature_global_coverage': 'Weltweites Sendernetzwerk',
      'feature_high_quality': 'High-Quality Audio-Streaming',
      'coverage_title': 'Abdeckung',
      'coverage_stations': '60.000+ Radiosender',
      'coverage_countries': '120+ Länder abgedeckt',
      'coverage_languages': '45+ Sprachen unterstützt',
      'coverage_genres': 'Alle Musikgenres verfügbar',
      // Social sharing translations
      'share_mega_radio': 'Mega Radio Teilen',
      'share_on': 'Teilen auf:',
      'copy_link': 'Link Kopieren',
      'copied': 'Kopiert!',
      'share': 'Teilen',
      'share_description': 'Hilf anderen dabei, großartige Radiosender aus der ganzen Welt zu entdecken!',
      // H1 heading translations for SEO
      'hero_worlds_best_radio': 'Mega Radio: Kostenlos Live-Radio aus 120 Ländern',
      'hero_over_100_countries': '60.000+ Radiosender aus 120+ Ländern',
      'hero_listen_everywhere': 'Überall und jederzeit kostenlos hören',
      // Navigation translations for SEO
      'nav_genres': 'Radio-Genres',
      'nav_regions': 'Radio nach Ländern',
      'nav_stations': 'Alle Sender',
      'nav_for_you': 'Für Sie',
      'nav_users': 'Community',
      'nav_about': 'Über uns',
      'nav_contact': 'Kontakt',
      'nav_privacy': 'Datenschutz',
      'nav_terms': 'Nutzungsbedingungen',
      'nav_apps': 'Mobile Apps',
      // Additional heading translations
      'explore_mega_radio': 'Mega Radio Entdecken',
      'popular_genres_title': 'Beliebte Radio-Genres',
      'popular_countries_title': 'Radiosender nach Ländern',
      'more_information': 'Weitere Informationen',
      // External links translations
      'external_resources': 'Externe Ressourcen',
      'flixapp_tv': 'FlixApp TV - Entertainment-Plattform',
      'radio_browser': 'Radio Browser - Offene Radio-Datenbank',
      'musicbrainz': 'MusicBrainz - Musik-Metadaten'
    },
    fr: {
      'home_page.title': 'Mega Radio: Écoutez la Radio en Direct et la Musique Gratuite de 120 Pays',
      'home_page.description': 'Écoutez la radio en direct en ligne avec Mega Radio! 60 000+ stations AM/FM de 120+ pays, musique, actualités, sport et talk-shows gratuits.',
      'genres_page.title': 'Genres Radio - Découvrez la Musique par Style | Mega Radio',
      'genres_page.description': 'Explorez les stations de radio par genre: Pop, Rock, Jazz, Classique, Actualités, Talk et plus. Trouvez votre style musical préféré sur Mega Radio.',
      'regions_page.title': 'Stations Radio par Région - Diffusion Mondiale | Mega Radio',
      'regions_page.description': 'Explorez les stations de radio de différentes régions du monde. Écoutez la diffusion locale de chaque continent.',
      'stations_page.title': 'Toutes les Stations Radio - Parcourez 60 000+ Radio en Direct | Mega Radio',
      'stations_page.description': 'Parcourez notre répertoire complet de 60 000+ stations de radio du monde entier. Trouvez des stations de radio locales et internationales.',
      // About section content
      'about_mega_radio': 'À Propos de Mega Radio',
      'about_mega_radio_description_1': 'Mega Radio est votre plateforme radio en ligne gratuite avec plus de 60 000 stations de radio de 120+ pays dans le monde. De la musique live aux actualités, en passant par les émissions sportives et les talk-shows, vous pouvez tout écouter en haute qualité.',
      'about_mega_radio_description_2': 'Notre plateforme offre un support multilingue en français, anglais, turc, allemand, espagnol et de nombreuses autres langues. Grâce à la conception responsive mobile, vous pouvez accéder depuis n\'importe quel appareil, marquer vos stations favorites et recevoir des recommandations personnalisées.',
      'features_title': 'Fonctionnalités',
      'feature_live_streaming': 'Streaming radio en direct sans interruption',
      'feature_multilingual': 'Support de plateforme multilingue',
      'feature_global_coverage': 'Réseau mondial de stations',
      'feature_high_quality': 'Streaming audio haute qualité',
      'coverage_title': 'Couverture',
      'coverage_stations': '60 000+ stations de radio',
      'coverage_countries': '120+ pays couverts',
      'coverage_languages': '45+ langues supportées',
      'coverage_genres': 'Tous les genres musicaux disponibles',
      // Social sharing translations
      'share_mega_radio': 'Partager Mega Radio',
      'share_on': 'Partager sur :',
      'copy_link': 'Copier le Lien',
      'copied': 'Copié !',
      'share': 'Partager',
      'share_description': 'Aidez les autres à découvrir d\'incroyables stations de radio du monde entier !',
      // H1 heading translations for SEO
      'hero_worlds_best_radio': 'Mega Radio : Radio en Direct Gratuite de 120 Pays',
      'hero_over_100_countries': '60 000+ stations de radio de 120+ pays',
      'hero_listen_everywhere': 'Écoutez partout, à tout moment, gratuitement',
      // Navigation translations for SEO
      'nav_genres': 'Genres Radio',
      'nav_regions': 'Radio par Pays',
      'nav_stations': 'Toutes les Stations',
      'nav_for_you': 'Pour Vous',
      'nav_users': 'Communauté',
      'nav_about': 'À Propos',
      'nav_contact': 'Contact',
      'nav_privacy': 'Politique de Confidentialité',
      'nav_terms': 'Conditions d\'Utilisation',
      'nav_apps': 'Applications Mobiles',
      // Additional heading translations
      'explore_mega_radio': 'Explorez Mega Radio',
      'popular_genres_title': 'Genres Radio Populaires',
      'popular_countries_title': 'Stations Radio par Pays',
      'more_information': 'Plus d\'Informations',
      // External links translations
      'external_resources': 'Ressources Externes',
      'flixapp_tv': 'FlixApp TV - Plateforme de Divertissement',
      'radio_browser': 'Radio Browser - Base de Données Radio Ouverte',
      'musicbrainz': 'MusicBrainz - Métadonnées Musicales'
    },
    es: {
      'home_page.title': 'Mega Radio: Escucha Radio en Vivo y Música Gratis de 120 Países',
      'home_page.description': 'Escucha radio en vivo en línea con Mega Radio! 60,000+ estaciones AM/FM de 120+ países, música, noticias, deportes y programas de charla gratis.',
      'genres_page.title': 'Géneros de Radio - Descubre Música por Estilo | Mega Radio',
      'genres_page.description': 'Explora estaciones de radio por género: Pop, Rock, Jazz, Clásica, Noticias, Talk y más. Encuentra tu estilo musical favorito en Mega Radio.',
      'regions_page.title': 'Estaciones de Radio por Región - Transmisión Global | Mega Radio',
      'regions_page.description': 'Explora estaciones de radio de diferentes regiones del mundo. Escucha transmisiones locales de cada continente.',
      'stations_page.title': 'Todas las Estaciones de Radio - Navega 60,000+ Radio en Vivo | Mega Radio',
      'stations_page.description': 'Navega nuestro directorio completo de 60,000+ estaciones de radio de todo el mundo. Encuentra estaciones de radio locales e internacionales.',
      // About section content
      'about_mega_radio': 'Acerca de Mega Radio',
      'about_mega_radio_description_1': 'Mega Radio es tu plataforma de radio en línea gratuita con más de 60,000 estaciones de radio de 120+ países en todo el mundo. Desde música en vivo hasta noticias, programas deportivos y talk shows, puedes escuchar todo en alta calidad.',
      'about_mega_radio_description_2': 'Nuestra plataforma ofrece soporte multiidioma en español, inglés, turco, alemán, francés y muchos otros idiomas. Gracias al diseño responsive móvil, puedes acceder desde cualquier dispositivo, marcar tus estaciones favoritas y recibir recomendaciones personalizadas.',
      'features_title': 'Características',
      'feature_live_streaming': 'Streaming de radio en vivo sin interrupciones',
      'feature_multilingual': 'Soporte de plataforma multiidioma',
      'feature_global_coverage': 'Red mundial de estaciones',
      'feature_high_quality': 'Streaming de audio de alta calidad',
      'coverage_title': 'Cobertura',
      'coverage_stations': '60,000+ estaciones de radio',
      'coverage_countries': '120+ países cubiertos',
      'coverage_languages': '45+ idiomas soportados',
      'coverage_genres': 'Todos los géneros musicales disponibles',
      // Social sharing translations
      'share_mega_radio': 'Compartir Mega Radio',
      'share_on': 'Compartir en:',
      'copy_link': 'Copiar Enlace',
      'copied': '¡Copiado!',
      'share': 'Compartir',
      'share_description': '¡Ayuda a otros a descubrir increíbles estaciones de radio de todo el mundo!',
      // H1 heading translations for SEO
      'hero_worlds_best_radio': 'Mega Radio: Radio en Vivo Gratis de 120 Países',
      'hero_over_100_countries': '60,000+ estaciones de radio de 120+ países',
      'hero_listen_everywhere': 'Escucha en todas partes, en cualquier momento, gratis',
      // Navigation translations for SEO
      'nav_genres': 'Géneros de Radio',
      'nav_regions': 'Radio por País',
      'nav_stations': 'Todas las Estaciones',
      'nav_for_you': 'Para Ti',
      'nav_users': 'Comunidad',
      'nav_about': 'Acerca de',
      'nav_contact': 'Contacto',
      'nav_privacy': 'Política de Privacidad',
      'nav_terms': 'Términos de Servicio',
      'nav_apps': 'Aplicaciones Móviles',
      // Additional heading translations
      'explore_mega_radio': 'Explora Mega Radio',
      'popular_genres_title': 'Géneros de Radio Populares',
      'popular_countries_title': 'Estaciones de Radio por País',
      'more_information': 'Más Información',
      // External links translations
      'external_resources': 'Recursos Externos',
      'flixapp_tv': 'FlixApp TV - Plataforma de Entretenimiento',
      'radio_browser': 'Radio Browser - Base de Datos Radio Abierta',
      'musicbrainz': 'MusicBrainz - Metadatos Musicales'
    },
    en: {
      // About section content for English
      'about_mega_radio': 'About Mega Radio',
      'about_mega_radio_description_1': 'Mega Radio is your free online radio platform featuring over 60,000 radio stations from 120+ countries worldwide. From live music to news, sports broadcasts to talk shows, you can enjoy everything in high quality.',
      'about_mega_radio_description_2': 'Our platform offers multilingual support in English, Turkish, German, French, Spanish, and many other languages. Thanks to mobile responsive design, you can access from any device, bookmark favorite stations, and receive personalized recommendations.',
      'features_title': 'Features',
      'feature_live_streaming': 'Uninterrupted live radio streaming',
      'feature_multilingual': 'Multilingual platform support',
      'feature_global_coverage': 'Global network of stations',
      'feature_high_quality': 'High-quality audio streaming',
      'coverage_title': 'Coverage',
      'coverage_stations': '60,000+ radio stations',
      'coverage_countries': '120+ countries covered',
      'coverage_languages': '45+ languages supported',
      'coverage_genres': 'All music genres available',
      // Social sharing translations
      'share_mega_radio': 'Share Mega Radio',
      'share_on': 'Share on:',
      'copy_link': 'Copy Link',
      'copied': 'Copied!',
      'share': 'Share',
      'share_description': 'Help others discover amazing radio stations from around the world!',
      // H1 heading translations for SEO
      'hero_worlds_best_radio': 'Mega Radio: Free Live Radio from 120 Countries',
      'hero_over_100_countries': '60,000+ radio stations from 120+ countries',
      'hero_listen_everywhere': 'Listen everywhere, anytime, for free',
      // Navigation translations for SEO
      'nav_genres': 'Radio Genres',
      'nav_regions': 'Radio by Country',
      'nav_stations': 'All Stations',
      'nav_for_you': 'For You',
      'nav_users': 'Community',
      'nav_about': 'About Us',
      'nav_contact': 'Contact',
      'nav_privacy': 'Privacy Policy',
      'nav_terms': 'Terms of Service',
      'nav_apps': 'Mobile Apps',
      // Additional heading translations
      'explore_mega_radio': 'Explore Mega Radio',
      'popular_genres_title': 'Popular Radio Genres',
      'popular_countries_title': 'Radio Stations by Country',
      'more_information': 'More Information',
      // External links translations
      'external_resources': 'External Resources',
      'flixapp_tv': 'FlixApp TV - Entertainment Platform',
      'radio_browser': 'Radio Browser - Open Radio Database',
      'musicbrainz': 'MusicBrainz - Music Metadata'
    }
  };

  const SEO_FALLBACKS: Record<string, string> = {
    // Bing SEO: every fallback description is 150–160 chars to satisfy
    // "description too short" / "description missing" audits across all 57 langs.
    genres_page_title: 'Radio Genres — Browse All Music Genres | Mega Radio',
    genres_page_description: 'Explore every radio genre on Mega Radio: pop, rock, jazz, classical, hip hop, electronic, country, news, sports and talk. Listen to free live radio stations by genre.',
    stations_page_title: 'Radio Stations — Browse All Stations | Mega Radio',
    stations_page_description: 'Browse 60,000+ free online radio stations from 120+ countries on Mega Radio. Listen live to music, news, sports and talk radio anywhere on desktop and mobile.',
    regions_page_title: 'Radio by Region — Browse Stations by Region | Mega Radio',
    regions_page_description: 'Discover radio stations from every region and country. Listen to local and international radio from Europe, Asia, Africa, Americas, and Oceania for free on Mega Radio.',
    home_page_description: 'Listen to 60,000+ free live radio stations from 120+ countries on Mega Radio. Stream music, news, sports and talk radio online from any device, anywhere, anytime.',
    about_page_description: 'Learn about Mega Radio, the free online radio platform with 60,000+ stations from 120+ countries. Discover our mission, multilingual support, and global station network.',
    contact_page_description: 'Contact the Mega Radio team for support, feedback, partnership inquiries, or station submissions. We are here to help with your free radio streaming experience.',
    privacy_page_description: 'Read the Mega Radio privacy policy to learn how we collect, use, and protect your personal data while you stream 60,000+ free radio stations from 120+ countries.',
    terms_page_description: 'Read the Mega Radio Terms and Conditions covering service usage, account rules, intellectual property, and listener responsibilities for free online radio streaming.',
    search_page_title: 'Search Radio Stations — Find Live Radio by Name, Genre or Country | Mega Radio',
    search_page_description: 'Search 60,000+ live radio stations from 120+ countries on Mega Radio. Find your favourite station by name, genre, language, or country and listen free online.',
    faq_page_title: 'Radio Streaming FAQ — Common Questions about Online Radio | Mega Radio',
    faq_page_description: 'Frequently asked questions about Mega Radio: how to listen to online radio, supported devices, free streaming, mobile apps, station coverage, and account help.',
  };
  const getTranslation = (key: string): string => {
    const val = translations[key]?.trim();
    return val ? val : (SEO_FALLBACKS[key] || '');
  };

  const seoData: Record<string, SeoMetaTags> = {
    home: {
      // Bing SEO: hero_over_100_countries is only ~45 chars (too short for Bing's 150-char floor).
      // Fall through to home_page_description (155 chars) when meta_description is empty.
      title: getTranslation('meta_title') || getTranslation('hero_worlds_best_radio'),
      description: getTranslation('meta_description') || getTranslation('home_page_description'),
      keywords: getTranslation('meta_keywords') || 'online radio, live radio, free music, radio stations, streaming, AM FM radio, international radio',
      ogTitle: getTranslation('meta_title') || getTranslation('hero_worlds_best_radio'),
      ogDescription: getTranslation('meta_description') || getTranslation('home_page_description'),
      ogType: 'website',
      twitterTitle: getTranslation('meta_title') || getTranslation('hero_worlds_best_radio'),
      twitterDescription: getTranslation('meta_description') || getTranslation('home_page_description')
    },
    genres: {
      title: getTranslation('genres_page_title'),
      description: getTranslation('genres_page_description'),
      keywords: 'radio genres, music genres, pop radio, rock radio, jazz radio, classical radio, news radio, talk radio',
      ogType: 'website',
      twitterTitle: getTranslation('genres_page_title'),
      twitterDescription: getTranslation('genres_page_description')
    },
    stations: {
      title: getTranslation('stations_page_title'),
      description: getTranslation('stations_page_description'),
      keywords: 'radio stations, online radio directory, live radio, international radio, local radio stations',
      ogType: 'website',
      twitterTitle: getTranslation('stations_page_title'),
      twitterDescription: getTranslation('stations_page_description')
    },
    regions: {
      title: getTranslation('regions_page_title'),
      description: getTranslation('regions_page_description'),
      keywords: 'regional radio, world radio stations, international broadcasting, regional stations',
      ogType: 'website',
      twitterTitle: getTranslation('regions_page_title'),
      twitterDescription: getTranslation('regions_page_description')
    },
    search: {
      title: getTranslation('search_page_title'),
      description: getTranslation('search_page_description'),
      keywords: 'radio search, find radio stations, search live radio, online radio search',
      ogType: 'website',
      twitterTitle: getTranslation('search_page_title'),
      twitterDescription: getTranslation('search_page_description'),
      // Search result pages should not be indexed (Google guidance) but should be crawlable
      robots: 'noindex, follow'
    },
    faq: {
      title: getTranslation('faq_page_title'),
      description: getTranslation('faq_page_description'),
      keywords: 'mega radio faq, online radio help, internet radio questions, free radio streaming faq',
      ogType: 'website',
      twitterTitle: getTranslation('faq_page_title'),
      twitterDescription: getTranslation('faq_page_description')
    },
    station: {
      // Dynamic station page SEO with language-specific content for uniqueness
      title: stationData ? 
        generateLocalizedStationTitle(stationData, language, translations) :
        'Listen Live Radio Station - Mega Radio',
      description: stationData ? 
        getStationMetaDescription(stationData, language, translations) :
        'Listen to live radio stations online with Mega Radio.',
      keywords: stationData ? 
        generateLocalizedKeywords(stationData, language, translations) :
        'live radio station, online radio, radio streaming',
      ogTitle: stationData ? 
        generateLocalizedStationTitle(stationData, language, translations) :
        'Listen Live Radio Station - Mega Radio',
      ogDescription: stationData ? 
        getLocalizedStationDescription(stationData, language, translations) :
        'Listen to live radio stations online with Mega Radio.',
      ogImage: stationData?.favicon || undefined,
      ogType: 'music.radio_station',
      twitterTitle: stationData ? 
        generateLocalizedStationTitle(stationData, language, translations) :
        'Listen Live Radio Station',
      twitterDescription: stationData ? 
        getStationMetaDescription(stationData, language, translations) :
        'Listen to live radio stations online with Mega Radio.'
    }
  };

  const pageSeo = seoData[page] || {
    title: translations['general_page_title'] || 'Mega Radio - Free Online Radio',
    // Bing SEO: ~155-char fallback so the default page bucket never triggers
    // "description too short" / "description missing" audits.
    description: translations['general_page_description'] || 'Listen to 60,000+ free online radio stations from 120+ countries on Mega Radio. Stream live music, news, sports and talk radio anywhere on desktop or mobile.',
    keywords: 'online radio, free music, radio streaming',
    ogType: 'website'
  };

  // Prioritize translated path from database for canonical URL
  // This ensures canonical URLs use localized paths like /sq/zhanret instead of /sq/genres
  // CRITICAL: ALL languages (including default English) use /{lang} prefix — matches sitemap & hreflang.
  // Previously the default-English homepage was rewritten to "/" which caused Google Search Console
  // "Alternate page with proper canonical tag" because:
  //   - sitemap-main-en.xml lists https://themegaradio.com/en
  //   - hreflang en = https://themegaradio.com/en
  //   - canonical pointed to https://themegaradio.com/  (mismatch → duplicate signal)
  //   - https://themegaradio.com/ 302-redirects back to /en (circular)
  // Fix: prefix-all strategy is enforced — /en is self-canonical.
  let canonicalPath = translatedPath || originalPath || `/${language}${cleanPath}`;

  // Defensive: if canonicalPath ended up as bare "/" (e.g. caller passed cleanPath="/"
  // and translatedPath/originalPath were empty), force the language prefix.
  if (canonicalPath === '/' || canonicalPath === '') {
    canonicalPath = `/${language}`;
  }
  
  // CRITICAL SEO FIX: Always strip query parameters and hash fragments from canonical URLs
  // This prevents duplicate content issues (e.g., /page and /page?tab=popular should have same canonical)
  canonicalPath = canonicalPath.split('?')[0].split('#')[0];

  // Strip trailing slash (except root "/") to match the server's trailing-slash redirect
  // and avoid canonical→redirect chains that confuse Google.
  if (canonicalPath.length > 1 && canonicalPath.endsWith('/')) {
    canonicalPath = canonicalPath.replace(/\/+$/, '');
  }
  
  // Generate canonical URL
  const canonicalUrl = `${currentDomain}${canonicalPath}`;
  
  // Generate og:locale dynamically from SEO_LANGUAGES using the iso field
  // Convert from hreflang format (tr-TR) to OG locale format (tr_TR)
  const currentLangConfig = SEO_LANGUAGES.find(l => l.code === language);
  const ogLocale = currentLangConfig?.iso.replace('-', '_') || 'en_US';
  
  // Generate og:locale:alternate tags for all other enabled languages (Facebook/social media)
  // This tells social media platforms about all language versions of the same content
  // Using dynamic locale generation ensures all 56 languages are covered
  const ogLocaleAlternates = SEO_LANGUAGES
    .filter(lang => lang.enabled && lang.code !== language)
    .map(lang => lang.iso.replace('-', '_')); // Convert tr-TR → tr_TR format
  
  // Ensure images have absolute URLs for social sharing
  const makeAbsoluteUrl = (url?: string): string | undefined => {
    if (!url) return undefined;
    if (url.startsWith('http')) return url;
    return `${currentDomain}${url.startsWith('/') ? '' : '/'}${url}`;
  };
  
  const ogImageAbsolute = makeAbsoluteUrl(pageSeo.ogImage) || `${currentDomain}/images/logo-icon.webp`;
  const twitterImageAbsolute = makeAbsoluteUrl(pageSeo.twitterImage) || ogImageAbsolute;
  
  return {
    ...pageSeo,
    language,
    domain: currentDomain.replace('https://', '').replace('http://', ''),
    canonical: canonicalUrl,
    // Open Graph required properties
    ogUrl: canonicalUrl,
    ogImage: ogImageAbsolute,
    ogSiteName: 'Mega Radio',
    ogLocale,
    ogLocaleAlternates,
    // Twitter Card properties (ensure absolute URLs)
    twitterImage: twitterImageAbsolute,
    // Standard properties
    hreflangs: generateLanguageUrls(cleanPath, currentDomain, language, translationMap, canonicalUrl),
    robots: 'index, follow'
  };
}