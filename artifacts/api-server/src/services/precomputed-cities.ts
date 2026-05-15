import { CacheManager } from '../cache';
import { Station } from '@workspace/db-shared/mongo-schemas';
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
  'United Kingdom': ['United Kingdom', 'Great Britain']
};

function getCountrySearchPatterns(countryName: string): string[] {
  return COUNTRY_NAME_MAPPING[countryName] || [countryName];
}

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

    // INCIDENT 2026-05-15 v10 — REWRITTEN. The previous implementation used
    // a heavy $facet + $switch with N regex branches per document (Austria
    // had 27 cities = 27 regex evals per station × thousands of docs). On
    // cold M10 it routinely tripped 15s maxTimeMS and emitted "Failed to
    // compute cities" SSR errors. New strategy: do ONE cheap indexed
    // .find() for the country (uses country_1_votes_-1 or country_1
    // index), project only the small fields we need, and bucket cities
    // in Node memory. A typical country fetches <2k docs (well below
    // the 16MB BSON limit), and the lean projection keeps payload tiny.
    const searchPatterns = getCountrySearchPatterns(countryName);
    const countryRegex = searchPatterns.map(p => new RegExp(`^${escapeRegex(p)}$`, 'i'));

    // Bounded scan: cap the per-country slice at 5000 docs. Even the
    // largest countries (USA ~1900, Germany ~1500) sit well below the
    // cap, but the explicit limit guarantees the planner sees a small
    // bounded window so a future bulk import can't silently turn this
    // into a multi-GB scan. The total count is fetched as a parallel
    // cheap countDocuments (uses the index, not the doc payload) so the
    // displayed station total stays accurate even when the bucket scan
    // is capped.
    const PER_COUNTRY_DOC_CAP = 5000;
    const filter = {
      $or: countryRegex.map(regex => ({ country: regex })),
      lastCheckOk: true
    };

    try {
      const [docs, totalCountryStations] = await Promise.all([
        Station.find(filter, { name: 1, tags: 1, state: 1 })
          .lean()
          .limit(PER_COUNTRY_DOC_CAP)
          .maxTimeMS(8000),
        Station.countDocuments(filter).maxTimeMS(5000).catch(() => 0)
      ]);

      // Pre-build lowercase city patterns once.
      const cityPatterns = cities.map(city => ({
        name: city,
        re: new RegExp(escapeRegex(city), 'i')
      }));

      const cityCountMap = new Map<string, number>();
      for (const doc of docs as any[]) {
        const name = doc.name || '';
        const tags = typeof doc.tags === 'string' ? doc.tags : Array.isArray(doc.tags) ? doc.tags.join(',') : '';
        const state = doc.state || '';
        for (const cp of cityPatterns) {
          if (cp.re.test(name) || cp.re.test(tags) || cp.re.test(state)) {
            cityCountMap.set(cp.name, (cityCountMap.get(cp.name) || 0) + 1);
            break; // a station is bucketed into the first matching city
          }
        }
      }

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
      // INCIDENT 2026-05-15 v10.2 round 6 — RETHROW on transient
      // compute failure so the singleflight wrapper does NOT cache the
      // empty fallback for the full 7-day TTL. The wrapper in
      // getCitiesForCountry catches and returns empty for the request,
      // but the next request will retry the compute instead of being
      // poisoned with an empty list for a week.
      logger.error(
        `❌ precomputed-cities ${countryName} failed: ` +
        `code=${error?.code || error?.codeName || 'unknown'} msg=${error?.message || error}`
      );
      throw error;
    }
  }

  static async getCitiesForCountry(countryName: string): Promise<PrecomputedCitiesData> {
    const cacheKey = this.getCacheKey(countryName);
    // INCIDENT 2026-05-15 v10.2 round 8 — switched from plain
    // singleflight to full SWR envelope. Stale-but-usable cities
    // (older than 1 day, younger than 7) now serve immediately while
    // a single coalesced background refresh runs. round-6 cache
    // poisoning protection still applies: computeCitiesForCountry
    // rethrows on transient failure, the catch below returns empty
    // for THIS request without writing the empty fallback into the
    // SWR envelope.
    try {
      return await CacheManager.getOrSetSWR<PrecomputedCitiesData>(
        cacheKey,
        () => this.computeCitiesForCountry(countryName),
        { freshTtl: 86400, staleTtl: CACHE_TTL }
      );
    } catch {
      // SWR loader threw on a cold miss (no envelope at all yet) — soft-fail.
      const stale = await CacheManager.getSWR<PrecomputedCitiesData>(cacheKey);
      return stale || { cities: [], totalCountryStations: 0, computedAt: Date.now(), countryName };
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
    logger.log(`🔄 Refreshing cities caches for ${countries.length} countries (admin-triggered)...`);
    for (const country of countries) {
      try {
        await CacheManager.delSWR(this.getCacheKey(country));
        await this.computeCitiesForCountry(country);
        await new Promise(r => setTimeout(r, 250));
      } catch (err: any) {
        logger.warn(`refreshAllCaches: ${country} failed (${err?.message || 'unknown'}) — continuing`);
      }
    }
    logger.log('✅ Admin cities cache refresh complete');
  }

  static getSupportedCountries(): string[] {
    return Object.keys(COUNTRY_CITIES);
  }
}
