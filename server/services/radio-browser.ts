import axios from 'axios';
import { logger } from '../utils/logger';

export interface RadioBrowserStation {
  changeuuid: string;
  stationuuid: string;
  serveruuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  iso_3166_2: string;
  state: string;
  language: string;
  languagecodes: string;
  votes: number;
  lastchangetime: string;
  lastchangetime_iso8601: string;
  codec: string;
  bitrate: number;
  hls: number;
  lastcheckok: number;
  lastchecktime: string;
  lastchecktime_iso8601: string;
  lastcheckoktime: string;
  lastcheckoktime_iso8601: string;
  lastlocalchecktime: string;
  lastlocalchecktime_iso8601: string;
  clicktimestamp: string;
  clicktimestamp_iso8601: string;
  clickcount: number;
  clicktrend: number;
  ssl_error: number;
  geo_lat: number | null;
  geo_long: number | null;
  has_extended_info: boolean;
}

export interface RadioBrowserCountry {
  name: string;
  iso_3166_1: string;
  stationcount: number;
}

export interface RadioBrowserLanguage {
  name: string;
  iso_639: string;
  stationcount: number;
}

export interface RadioBrowserTag {
  name: string;
  stationcount: number;
}

export interface RadioBrowserCodec {
  name: string;
  stationcount: number;
}

export class RadioBrowserService {
  private baseUrl = 'https://de1.api.radio-browser.info/json';
  private userAgent = 'RadioHub-Admin/1.0';
  
  // Multiple server endpoints for load distribution (recommended by API docs)
  private servers = [
    'https://de1.api.radio-browser.info/json',
    'https://de2.api.radio-browser.info/json', 
    'https://fi1.api.radio-browser.info/json',
    'https://at1.api.radio-browser.info/json'
  ];
  private currentServerIndex = 0;

  private async makeRequest<T>(endpoint: string): Promise<T> {
    let lastError: any;
    
    // Try multiple servers for better reliability
    for (let attempt = 0; attempt < this.servers.length; attempt++) {
      const serverUrl = this.servers[(this.currentServerIndex + attempt) % this.servers.length];
      
      try {
        const response = await axios.get(`${serverUrl}${endpoint}`, {
          headers: {
            'User-Agent': this.userAgent,
          },
          timeout: 30000, // Increased timeout for large station batches
          // Hard cap response size (prevents OOM on malicious/oversized upstream responses).
          // Full station list is ~50MB; 100MB gives headroom without allowing runaway payloads.
          maxContentLength: 100 * 1024 * 1024,
          maxBodyLength: 100 * 1024 * 1024,
        });
        
        // Rotate to next server for next request (load balancing)
        this.currentServerIndex = (this.currentServerIndex + 1) % this.servers.length;
        
        return response.data;
      } catch (error) {
        // console.error(`Radio-Browser API error for ${serverUrl}${endpoint}:`, error);
        lastError = error;
        
        // Add small delay before trying next server
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    throw new Error(`Failed to fetch data from all Radio-Browser servers: ${endpoint} - ${lastError?.message}`);
  }

  async getCountries(): Promise<RadioBrowserCountry[]> {
    return await this.makeRequest<RadioBrowserCountry[]>('/countries');
  }

  async getLanguages(): Promise<RadioBrowserLanguage[]> {
    return await this.makeRequest<RadioBrowserLanguage[]>('/languages');
  }

  async getTags(): Promise<RadioBrowserTag[]> {
    return await this.makeRequest<RadioBrowserTag[]>('/tags');
  }

  async getCodecs(): Promise<RadioBrowserCodec[]> {
    return await this.makeRequest<RadioBrowserCodec[]>('/codecs');
  }

  async getAllStations(limit?: number, offset?: number): Promise<RadioBrowserStation[]> {
    let endpoint = '/stations/search';
    const params: string[] = [];
    
    // Always include hidebroken=false to get ALL stations including broken ones
    params.push('hidebroken=false');
    
    if (limit) params.push(`limit=${limit}`);
    if (offset) params.push(`offset=${offset}`);
    params.push('order=changeuuid'); // Order by changeuuid for consistent pagination
    
    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }
    
    logger.log(`📡 Fetching stations from: ${endpoint}`);
    return await this.makeRequest<RadioBrowserStation[]>(endpoint);
  }

  async getStationsByCountry(countryCode: string): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/bycountrycodeexact/${countryCode}`);
  }

  async getStationsByLanguage(language: string): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/bylanguageexact/${language}`);
  }

  async getStationsByTag(tag: string): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/bytagexact/${tag}`);
  }

  async getStationsByCodec(codec: string): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/bycodecexact/${codec}`);
  }

  async getStationsByState(state: string): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/bystateexact/${encodeURIComponent(state)}`);
  }

  async getStationByUuid(uuid: string): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/byuuid/${uuid}`);
  }

  async getTopClickedStations(limit: number = 100): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/topclick/${limit}`);
  }

  async getTopVotedStations(limit: number = 100): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/topvote/${limit}`);
  }

  async getRecentlyClickedStations(limit: number = 100): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/lastclick/${limit}`);
  }

  async getRecentlyChangedStations(limit: number = 100): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/lastchange/${limit}`);
  }

  async getBrokenStations(limit: number = 100): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/broken/${limit}`);
  }

  async searchStations(name: string): Promise<RadioBrowserStation[]> {
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/byname/${encodeURIComponent(name)}`);
  }

  async advancedSearchStations(params: {
    name?: string;
    nameExact?: string;
    country?: string;
    countrycode?: string;
    state?: string;
    language?: string;
    tag?: string;
    tagList?: string[];
    codec?: string;
    bitrate?: number;
    bitrateMax?: number;
    order?: string;
    reverse?: boolean;
    offset?: number;
    limit?: number;
    hidebroken?: boolean;
    hasExtendedInfo?: boolean;
    hasGeoInfo?: boolean;
    is_https?: boolean;
  }): Promise<RadioBrowserStation[]> {
    const searchParams = new URLSearchParams();
    
    if (params.name) searchParams.append('name', params.name);
    if (params.nameExact) searchParams.append('nameExact', params.nameExact);
    if (params.country) searchParams.append('country', params.country);
    if (params.countrycode) searchParams.append('countrycode', params.countrycode);
    if (params.state) searchParams.append('state', params.state);
    if (params.language) searchParams.append('language', params.language);
    if (params.tag) searchParams.append('tag', params.tag);
    if (params.tagList) searchParams.append('tagList', params.tagList.join(','));
    if (params.codec) searchParams.append('codec', params.codec);
    if (params.bitrate !== undefined) searchParams.append('bitrate', params.bitrate.toString());
    if (params.bitrateMax !== undefined) searchParams.append('bitrateMax', params.bitrateMax.toString());
    if (params.order) searchParams.append('order', params.order);
    if (params.reverse !== undefined) searchParams.append('reverse', params.reverse.toString());
    if (params.offset !== undefined) searchParams.append('offset', params.offset.toString());
    if (params.limit !== undefined) searchParams.append('limit', params.limit.toString());
    if (params.hidebroken !== undefined) searchParams.append('hidebroken', params.hidebroken.toString());
    if (params.hasExtendedInfo !== undefined) searchParams.append('hasExtendedInfo', params.hasExtendedInfo.toString());
    if (params.hasGeoInfo !== undefined) searchParams.append('hasGeoInfo', params.hasGeoInfo.toString());
    if (params.is_https !== undefined) searchParams.append('is_https', params.is_https.toString());

    return await this.makeRequest<RadioBrowserStation[]>(`/stations/search?${searchParams.toString()}`);
  }

  async clickStation(uuid: string): Promise<{ok: boolean, message: string, url: string}> {
    return await this.makeRequest<{ok: boolean, message: string, url: string}>(`/url/${uuid}`);
  }

  async voteForStation(uuid: string): Promise<{ok: boolean, message: string}> {
    try {
      const response = await axios.post(`${this.baseUrl}/vote/${uuid}`, {}, {
        headers: {
          'User-Agent': this.userAgent,
        },
        timeout: 30000,
      });
      return response.data;
    } catch (error) {
      // console.error(`Vote error for station ${uuid}:`, error);
      throw new Error(`Failed to vote for station: ${uuid}`);
    }
  }

  async getStationChanges(since?: Date): Promise<RadioBrowserStation[]> {
    // For changes API, we'll use the search endpoint with a recent timestamp filter
    const params: string[] = ['order=lastchangetime', 'reverse=true'];
    if (since) {
      params.push(`lastchangetime=${Math.floor(since.getTime() / 1000)}`);
    }
    return await this.makeRequest<RadioBrowserStation[]>(`/stations/search?${params.join('&')}`);
  }

  async getStats(): Promise<{
    stations: number;
    stations_broken: number;
    tags: number;
    clicks_last_hour: number;
    clicks_last_day: number;
    languages: number;
    countries: number;
  }> {
    return await this.makeRequest<{
      stations: number;
      stations_broken: number;
      tags: number;
      clicks_last_hour: number;
      clicks_last_day: number;
      languages: number;
      countries: number;
    }>('/stats');
  }

  // Language mapping for MongoDB text search compatibility
  private sanitizeLanguage(language: string): string {
    if (!language || language.trim() === '') {
      return 'en'; // Default for empty languages (MongoDB compatible)
    }
    
    // Convert to lowercase and handle common cases
    const lang = language.toLowerCase().trim();
    
    // Handle multiple languages - take the first one
    // Support various separators: comma, period, semicolon, plus, ampersand
    const separators = [',', '.', ';', '+', '&', '/', '|'];
    for (const separator of separators) {
      if (lang.includes(separator)) {
        const firstLang = lang.split(separator)[0].trim();
        return this.mapLanguageToStandard(firstLang);
      }
    }
    
    return this.mapLanguageToStandard(lang);
  }
  
  private mapLanguageToStandard(language: string): string {
    // Map common language names to MongoDB-supported ones
    const languageMap: Record<string, string> = {
      'english': 'en',
      'german': 'de', 
      'spanish': 'es',
      'french': 'fr',
      'italian': 'it',
      'portuguese': 'pt',
      'russian': 'ru',
      'dutch': 'nl',
      'swedish': 'sv',
      'danish': 'da',
      'norwegian': 'en', // MongoDB doesn't support 'no' as language override
      'finnish': 'fi',
      'turkish': 'tr',
      'polish': 'en', // MongoDB doesn't support 'pl'
      'czech': 'en', // MongoDB doesn't support 'cs'
      'hungarian': 'hu',
      'romanian': 'ro',
      'bulgarian': 'en', // MongoDB doesn't support 'bg'
      'greek': 'en', // MongoDB doesn't support 'el'
      // Map all other languages to MongoDB-supported codes
      'arabic': 'en', // MongoDB doesn't support 'ar'
      'hebrew': 'en', // MongoDB doesn't support 'he'
      'hindi': 'en', // MongoDB doesn't support 'hi'
      'chinese': 'en', // MongoDB doesn't support 'zh'
      'japanese': 'en', // MongoDB doesn't support 'ja'
      'korean': 'en', // MongoDB doesn't support 'ko'
      'thai': 'en', // MongoDB doesn't support 'th'
      'vietnamese': 'en', // MongoDB doesn't support 'vi'
      'indonesian': 'en', // MongoDB doesn't support 'id'
      'malay': 'en', // MongoDB doesn't support 'ms'
      'malayalam': 'en', // MongoDB doesn't support 'ml'
      'tamil': 'en', // MongoDB doesn't support 'ta'
      'bengali': 'en', // MongoDB doesn't support 'bn'
      'urdu': 'en', // MongoDB doesn't support 'ur'
      'persian': 'en', // MongoDB doesn't support 'fa'
      'ukrainian': 'ru', // Use Russian as similar
      'serbian': 'en', // MongoDB doesn't support 'sr'
      'croatian': 'en', // MongoDB doesn't support 'hr'
      'slovenian': 'en', // MongoDB doesn't support 'sl'
      'slovak': 'en', // MongoDB doesn't support 'sk'
      'lithuanian': 'en', // MongoDB doesn't support 'lt'
      'latvian': 'en', // MongoDB doesn't support 'lv'
      'estonian': 'en', // MongoDB doesn't support 'et'
      'albanian': 'en', // MongoDB doesn't support 'sq'
      'macedonian': 'en', // MongoDB doesn't support 'mk'
      'bosnian': 'en', // MongoDB doesn't support 'bs'
      'montenegrin': 'en', // MongoDB doesn't support 'me'
      'georgian': 'en', // MongoDB doesn't support 'ka'
      'armenian': 'en', // MongoDB doesn't support 'hy'
      'azerbaijani': 'en', // MongoDB doesn't support 'az'
      'kazakh': 'ru', // Use Russian as similar
      'uzbek': 'ru', // Use Russian as similar
      'kyrgyz': 'ru', // Use Russian as similar
      'tajik': 'ru', // Use Russian as similar
      'turkmen': 'tr', // Use Turkish as similar
      'mongolian': 'en', // MongoDB doesn't support 'mn'
      'nepali': 'en', // MongoDB doesn't support 'ne'
      'sinhala': 'en', // MongoDB doesn't support 'si'
      'burmese': 'en', // MongoDB doesn't support 'my'
      'khmer': 'en', // MongoDB doesn't support 'km'
      'lao': 'en', // MongoDB doesn't support 'lo'
      'swahili': 'en', // MongoDB doesn't support 'sw'
      'amharic': 'en', // MongoDB doesn't support 'am'
      'yoruba': 'en', // MongoDB doesn't support 'yo'
      'igbo': 'en', // MongoDB doesn't support 'ig'
      'hausa': 'en', // MongoDB doesn't support 'ha'
      'zulu': 'en', // MongoDB doesn't support 'zu'
      'afrikaans': 'en', // MongoDB doesn't support 'af'
      'xhosa': 'en', // MongoDB doesn't support 'xh'
      'sotho': 'en', // MongoDB doesn't support 'st'
      'tswana': 'en', // MongoDB doesn't support 'tn'
      // Handle common edge cases
      'other': 'en',
      'unknown': 'en',
      'mixed': 'en',
      'various': 'en',
      'multiple': 'en'
    };
    
    // If we have a direct mapping, use it
    if (languageMap[language]) {
      return languageMap[language];
    }
    
    // MongoDB text search supported languages (limited set)
    const mongoSupportedLanguages = [
      'da', 'de', 'en', 'es', 'fi', 'fr', 'hu', 'it', 'nb', 'nl', 'pt', 'ro', 'ru', 'sv', 'tr'
    ];
    
    // If it looks like an ISO code and is MongoDB-supported, use it
    if (language.length <= 3 && /^[a-z]+$/.test(language) && mongoSupportedLanguages.includes(language)) {
      return language;
    }
    
    // For any unmapped language, use 'en' (MongoDB text search doesn't support 'other')
    // Handle language codes that cause MongoDB language override errors
    const supportedLanguages = ['en', 'de', 'es', 'fr', 'it', 'pt', 'ru', 'nl', 'sv', 'da', 'fi', 'tr', 'hu', 'ro'];
    
    // If the language is not in MongoDB's supported list, default to English
    if (!supportedLanguages.includes(language)) {
      return 'en';
    }
    
    return language;
  }

  // Convert Radio-Browser station to our database format
  convertToDbStation(station: RadioBrowserStation) {
    // Debug: Log station data if stationuuid is missing
    if (!station.stationuuid) {
      logger.log(`⚠️  Station missing UUID: "${station.name}" - URL: ${station.url}`);
      logger.log('Full station data:', JSON.stringify(station, null, 2));
    }
    
    // Generate a fallback UUID for stations without stationuuid to prevent duplicate key errors
    const stationUuid = station.stationuuid || `fallback-${Buffer.from(station.url || station.name || Math.random().toString()).toString('base64').substring(0, 16)}`;
    
    return {
      changeUuid: station.changeuuid,
      stationuuid: stationUuid,
      serverUuid: station.serveruuid,
      name: station.name || 'Unknown Station',
      url: station.url,
      urlResolved: station.url_resolved,
      homepage: station.homepage,
      favicon: station.favicon,
      tags: station.tags,
      country: station.country,
      countryCode: station.countrycode?.toUpperCase() || undefined,
      iso31662: station.iso_3166_2,
      state: station.state,
      language: this.sanitizeLanguage(station.language || ''),
      languageCodes: station.languagecodes,
      votes: station.votes || 0,
      lastChangeTime: station.lastchangetime ? new Date(station.lastchangetime) : undefined,
      codec: station.codec,
      bitrate: station.bitrate || undefined,
      hls: station.hls === 1,
      lastCheckOk: station.lastcheckok === 1,
      lastCheckTime: station.lastchecktime ? new Date(station.lastchecktime) : undefined,
      lastCheckOkTime: station.lastcheckoktime ? new Date(station.lastcheckoktime) : undefined,
      lastLocalCheckTime: station.lastlocalchecktime ? new Date(station.lastlocalchecktime) : undefined,
      clickTimestamp: station.clicktimestamp ? new Date(station.clicktimestamp) : undefined,
      clickCount: station.clickcount || 0,
      clickTrend: station.clicktrend || 0,
      sslError: station.ssl_error === 1,
      geoLat: station.geo_lat || undefined,
      geoLong: station.geo_long || undefined,
      hasExtendedInfo: station.has_extended_info || false,
      isManuallyEdited: false,
      manualEditFields: {},
    };
  }
}

export const radioBrowserService = new RadioBrowserService();
