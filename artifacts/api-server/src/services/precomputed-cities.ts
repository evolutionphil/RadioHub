import { CacheManager } from '../cache';
import { pgTaxonomyRuntime } from '../data/postgres-taxonomy-runtime-store';
import { logger } from '../utils/logger';

interface CityData {
  name: string;
  slug: string;
  stationCount: number;
}

interface PrecomputedCitiesData {
  cities: CityData[];
  totalCountryStations: number;
  computedAt: number;
  countryName: string;
}

const CACHE_TTL = 604800; // 7 days in seconds
const CACHE_KEY_PREFIX = 'precomputed_cities:';

const COUNTRY_CITIES: { [key: string]: string[] } = {
  'Turkey': ['Istanbul', 'Ankara', 'Izmir', 'Bursa', 'Antalya', 'Adana', 'Gaziantep', 'Konya', 'Kayseri', 'Diyarbakir', 'Eskisehir', 'Mersin'],
  'Germany': ['Berlin', 'Munich', 'Hamburg', 'Cologne', 'Frankfurt', 'Stuttgart', 'Düsseldorf', 'Dortmund', 'Essen', 'Leipzig', 'Bremen', 'Dresden'],
  'United States': ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville'],
  'United Kingdom': ['London', 'Birmingham', 'Manchester', 'Glasgow', 'Liverpool', 'Leeds', 'Sheffield', 'Edinburgh', 'Bristol', 'Cardiff', 'Belfast', 'Newcastle'],
  'France': ['Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Montpellier', 'Bordeaux', 'Lille', 'Rennes', 'Reims'],
  'Italy': ['Rome', 'Milan', 'Naples', 'Turin', 'Palermo', 'Genoa', 'Bologna', 'Florence', 'Bari', 'Catania', 'Venice', 'Verona'],
  'Spain': ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Zaragoza', 'Málaga', 'Murcia', 'Palma', 'Las Palmas', 'Bilbao', 'Alicante', 'Córdoba'],
  'Austria': ['Wien', 'Vienna', 'Salzburg', 'Graz', 'Steiermark', 'Linz', 'Oberösterreich', 'Innsbruck', 'Tirol', 'Klagenfurt', 'Kärnten', 'Villach', 'Wels', 'Sankt Pölten', 'Niederösterreich', 'Dornbirn', 'Vorarlberg', 'Bregenz', 'Feldkirch', 'Wiener Neustadt', 'Steyr', 'Leonding', 'Klosterneuburg', 'Baden', 'Wolfsberg', 'Leoben', 'Krems'],
  'Canada': ['Toronto', 'Montreal', 'Vancouver', 'Calgary', 'Edmonton', 'Ottawa', 'Winnipeg', 'Quebec City', 'Hamilton', 'Kitchener', 'London', 'Victoria'],
  'Australia': ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast', 'Newcastle', 'Canberra', 'Central Coast', 'Geelong', 'Hobart', 'Townsville'],
  'Brazil': ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador', 'Fortaleza', 'Belo Horizonte', 'Manaus', 'Curitiba', 'Recife', 'Porto Alegre', 'Belém', 'Goiânia'],
  'Russia': ['Moscow', 'Saint Petersburg', 'Novosibirsk', 'Yekaterinburg', 'Nizhny Novgorod', 'Kazan', 'Chelyabinsk', 'Omsk', 'Samara', 'Rostov-on-Don', 'Ufa', 'Krasnoyarsk'],
  'India': ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur', 'Surat', 'Lucknow', 'Kanpur'],
  'Japan': ['Tokyo', 'Yokohama', 'Osaka', 'Nagoya', 'Sapporo', 'Fukuoka', 'Kobe', 'Kawasaki', 'Kyoto', 'Saitama', 'Hiroshima', 'Sendai'],
  'China': ['Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Tianjin', 'Wuhan', 'Dongguan', 'Chengdu', 'Nanjing', 'Foshan', 'Shenyang', 'Hangzhou'],
  'Ukraine': ['Kyiv', 'Kharkiv', 'Odessa', 'Dnipro', 'Donetsk', 'Zaporizhzhia', 'Lviv', 'Kryvyi Rih', 'Mykolaiv', 'Mariupol', 'Luhansk', 'Vinnytsya'],
  'Czech Republic': ['Prague', 'Brno', 'Ostrava', 'Plzen', 'Liberec', 'Olomouc', 'Usti nad Labem', 'Hradec Kralove', 'Ceske Budejovice', 'Pardubice'],
  'Netherlands': ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven', 'Tilburg', 'Groningen', 'Almere', 'Breda', 'Nijmegen'],
  'Switzerland': ['Zurich', 'Geneva', 'Basel', 'Lausanne', 'Bern', 'Winterthur', 'Lucerne', 'St. Gallen', 'Lugano', 'Biel']
};

const COUNTRY_NAME_MAPPING: { [key: string]: string[] } = {
  'Czech Republic': ['Czechia', 'Czech Republic'],
  'Russia': ['The Russian Federation', 'Russia'],
  'United States': ['The United States Of America', 'United States'],
  'Turkey': ['Turkey', 'Türkiye'],
  'China': ['China', "People's Republic of China"],
  'United Kingdom': ['United Kingdom', 'Great Britain', 'The United Kingdom Of Great Britain And Northern Ireland']
};

function getCountrySearchPatterns(countryName: string): string[] {
  return COUNTRY_NAME_MAPPING[countryName] || [countryName];
}

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '');
}



export class PrecomputedCitiesService {
  private static getCacheKey(countryName: string): string {
    const normalized = countryName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `${CACHE_KEY_PREFIX}${normalized}`;
  }

  static async computeCitiesForCountry(countryName: string): Promise<PrecomputedCitiesData> {
    const cities = COUNTRY_CITIES[countryName];
    if (!cities || cities.length === 0) {
      return { cities: [], totalCountryStations: 0, computedAt: Date.now(), countryName };
    }

    // One statement counts every matching station and assigns it to the first matching city.
    // Country totals and city buckets share a snapshot; no document cap or partial count fallback.
    try {
      const result = await pgTaxonomyRuntime().cityCounts(getCountrySearchPatterns(countryName),cities);
      const totalCountryStations=result.total;
      const cityCountMap=result.counts;

      const citiesWithCounts: CityData[] = cities
        .map(city => ({
          name: city,
          slug: generateSlug(city),
          stationCount: cityCountMap.get(city) || 0
        }))
        .filter(city => city.stationCount > 0)
        .sort((a, b) => b.stationCount - a.stationCount);

      const data: PrecomputedCitiesData = {
        cities: citiesWithCounts,
        totalCountryStations,
        computedAt: Date.now(),
        countryName
      };

      // INCIDENT 2026-05-15 v10.2 round 8 — SWR envelope parity with
      // other hot paths. Reads via getOrSetSWR (below) consume
      // `<key>:swr`; refreshAllCaches() also writes via setSWR.
      await CacheManager.setSWR(this.getCacheKey(countryName), data, { freshTtl: 86400, staleTtl: CACHE_TTL });
      logger.log(`🏙️ Cached cities for ${countryName}: ${citiesWithCounts.length} cities (${totalCountryStations} docs scanned)`);

      return data;
    } catch (error: any) {
      logger.error(
        `❌ precomputed-cities ${countryName} failed: ` +
        `code=${error?.code || error?.codeName || 'unknown'} msg=${error?.message || error}`
      );
      throw error;
    }
  }

  static async getCitiesForCountry(countryName: string): Promise<PrecomputedCitiesData> {
    const cacheKey = this.getCacheKey(countryName);
    try {
      return await CacheManager.getOrSetSWR<PrecomputedCitiesData>(
        cacheKey,
        () => this.computeCitiesForCountry(countryName),
        { freshTtl: 86400, staleTtl: CACHE_TTL }
      );
    } catch (error) {
      // Serve only an existing valid snapshot; an outage is not an empty country.
      const stale = await CacheManager.getSWR<PrecomputedCitiesData>(cacheKey);
      if (stale) return stale;
      throw error;
    }
  }

  static async warmupCache(): Promise<void> {
    // INCIDENT 2026-05-15: boot warmup of cities is INTENTIONALLY a no-op
    // per user directive ("ilk gelenler olmaya baslayinca yapsin").
    // The 7-day TTL means each country is computed at most once per week
    // by the first organic visitor — which now uses the cheap path.
    logger.log('⏭️ PrecomputedCities.warmupCache() is a no-op — caches fill lazily on first organic request (7-day TTL)');
  }

  static async refreshAllCaches(): Promise<void> {
    // Admin-only manual refresh path (called from /api/admin/sitemap/rebuild
    // and similar). Sequential, gentle, bounded.
    const countries = Object.keys(COUNTRY_CITIES);
    const failures: unknown[] = [];
    logger.log(`🔄 Refreshing cities caches for ${countries.length} countries (admin-triggered)...`);
    for (const country of countries) {
      try {
        await this.computeCitiesForCountry(country);
        await new Promise(r => setTimeout(r, 250));
      } catch (err: any) {
        failures.push(err);
        logger.warn(`refreshAllCaches: ${country} failed (${err?.message || 'unknown'}) — continuing`);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Some city caches could not be refreshed; prior snapshots retained');
    logger.log('✅ Admin cities cache refresh complete');
  }

  static getSupportedCountries(): string[] {
    return Object.keys(COUNTRY_CITIES);
  }
}
