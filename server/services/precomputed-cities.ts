import { CacheManager } from '../cache';
import { Station } from '../../shared/mongo-schemas';
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

    const searchPatterns = getCountrySearchPatterns(countryName);
    const countryRegex = searchPatterns.map(p => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));

    const pipeline = [
      {
        $match: {
          $or: countryRegex.map(regex => ({ country: regex })),
          lastCheckOk: true
        }
      },
      {
        $facet: {
          totalCount: [{ $count: 'count' }],
          cityCounts: cities.length > 0 ? [
            {
              $project: {
                matchedCity: {
                  $switch: {
                    branches: cities.map(city => ({
                      case: {
                        $or: [
                          { $regexMatch: { input: { $ifNull: ['$name', ''] }, regex: new RegExp(escapeRegex(city), 'i') } },
                          { $regexMatch: { input: { $ifNull: ['$tags', ''] }, regex: new RegExp(escapeRegex(city), 'i') } },
                          { $regexMatch: { input: { $ifNull: ['$state', ''] }, regex: new RegExp(escapeRegex(city), 'i') } }
                        ]
                      },
                      then: city
                    })),
                    default: null
                  }
                }
              }
            },
            { $match: { matchedCity: { $ne: null } } },
            { $group: { _id: '$matchedCity', count: { $sum: 1 } } }
          ] : []
        }
      }
    ];

    try {
      const result = await Station.aggregate(pipeline).option({ maxTimeMS: 15000 }).exec();
      const totalCountryStations = result[0]?.totalCount[0]?.count || 0;
      const cityCountsRaw = result[0]?.cityCounts || [];

      const cityCountMap = new Map<string, number>();
      cityCountsRaw.forEach((item: { _id: string; count: number }) => {
        if (item._id) {
          cityCountMap.set(item._id, item.count);
        }
      });

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

      await CacheManager.set(this.getCacheKey(countryName), data, { ttl: CACHE_TTL });
      logger.log(`🏙️ Cached cities for ${countryName}: ${citiesWithCounts.length} cities`);

      return data;
    } catch (error) {
      logger.error(`Failed to compute cities for ${countryName}:`, error);
      return { cities: [], totalCountryStations: 0, computedAt: Date.now(), countryName };
    }
  }

  static async getCitiesForCountry(countryName: string): Promise<PrecomputedCitiesData> {
    const cacheKey = this.getCacheKey(countryName);
    const cached = await CacheManager.get<PrecomputedCitiesData>(cacheKey);
    
    if (cached) {
      return cached;
    }

    return this.computeCitiesForCountry(countryName);
  }

  static async warmupCache(): Promise<void> {
    const countries = Object.keys(COUNTRY_CITIES);
    logger.log(`🏙️ Warming up cities cache for ${countries.length} countries...`);
    
    for (const country of countries) {
      try {
        await this.computeCitiesForCountry(country);
        await new Promise(resolve => setTimeout(resolve, 150));
      } catch (error) {
        logger.error(`Failed to warmup cities cache for ${country}:`, error);
      }
    }
    
    logger.log(`✅ Cities cache warmup complete`);
  }

  static async refreshAllCaches(): Promise<void> {
    logger.log(`🔄 Refreshing all cities caches...`);
    await this.warmupCache();
  }

  static getSupportedCountries(): string[] {
    return Object.keys(COUNTRY_CITIES);
  }
}
