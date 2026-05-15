import type { Express } from "express";
import { Station, Country, Genre } from '@workspace/db-shared/mongo-schemas';
import { logger } from "../utils/logger";
import CacheManager from "../cache";

// REGIONS DATA STRUCTURE
const WORLD_REGIONS = {
  'africa': {
    name: 'Africa',
    slug: 'africa',
    countries: [
      'Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cameroon',
      'Cape Verde', 'Central African Republic', 'Chad', 'Comoros', 'Congo', 'DR Congo',
      'Djibouti', 'Egypt', 'Equatorial Guinea', 'Eritrea', 'Ethiopia', 'Gabon', 'Gambia',
      'Ghana', 'Guinea', 'Guinea-Bissau', 'Ivory Coast', 'Kenya', 'Lesotho', 'Liberia',
      'Libya', 'Madagascar', 'Malawi', 'Mali', 'Mauritania', 'Mauritius', 'Morocco',
      'Mozambique', 'Namibia', 'Niger', 'Nigeria', 'Rwanda', 'Sao Tome and Principe',
      'Senegal', 'Seychelles', 'Sierra Leone', 'Somalia', 'South Africa', 'South Sudan',
      'Sudan', 'Swaziland', 'Tanzania', 'Togo', 'Tunisia', 'Uganda', 'Zambia', 'Zimbabwe'
    ]
  },
  'asia': {
    name: 'Asia',
    slug: 'asia',
    countries: [
      'Afghanistan', 'Armenia', 'Azerbaijan', 'Bahrain', 'Bangladesh', 'Bhutan', 'Brunei',
      'Cambodia', 'China', 'Cyprus', 'Georgia', 'India', 'Indonesia', 'Iran', 'Iraq',
      'Israel', 'Japan', 'Jordan', 'Kazakhstan', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Lebanon',
      'Malaysia', 'Maldives', 'Mongolia', 'Myanmar', 'Nepal', 'North Korea', 'Oman',
      'Pakistan', 'Palestine', 'Philippines', 'Qatar', 'Saudi Arabia', 'Singapore',
      'South Korea', 'Sri Lanka', 'Syria', 'Taiwan', 'Tajikistan', 'Thailand', 'Timor-Leste',
      'Turkey', 'Turkmenistan', 'United Arab Emirates', 'Uzbekistan', 'Vietnam', 'Yemen'
    ]
  },
  'europe': {
    name: 'Europe',
    slug: 'europe',
    countries: [
      'Albania', 'Andorra', 'Armenia', 'Austria', 'Azerbaijan', 'Belarus', 'Belgium',
      'Bosnia and Herzegovina', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic', 'Denmark',
      'Estonia', 'Finland', 'France', 'Georgia', 'Germany', 'Greece', 'Hungary', 'Iceland',
      'Ireland', 'Italy', 'Kosovo', 'Latvia', 'Liechtenstein', 'Lithuania', 'Luxembourg',
      'Malta', 'Moldova', 'Monaco', 'Montenegro', 'Netherlands', 'North Macedonia', 'Norway',
      'Poland', 'Portugal', 'Romania', 'Russia', 'San Marino', 'Serbia', 'Slovakia',
      'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'Turkey', 'Ukraine', 'United Kingdom', 'Vatican City'
    ]
  },
  'north-america': {
    name: 'North America',
    slug: 'north-america',
    countries: [
      'Antigua and Barbuda', 'Bahamas', 'Barbados', 'Belize', 'Canada', 'Costa Rica',
      'Cuba', 'Dominica', 'Dominican Republic', 'El Salvador', 'Grenada', 'Guatemala',
      'Haiti', 'Honduras', 'Jamaica', 'Mexico', 'Nicaragua', 'Panama', 'Saint Kitts and Nevis',
      'Saint Lucia', 'Saint Vincent and the Grenadines', 'Trinidad and Tobago', 'United States'
    ]
  },
  'south-america': {
    name: 'South America',
    slug: 'south-america',
    countries: [
      'Argentina', 'Bolivia', 'Brazil', 'Chile', 'Colombia', 'Ecuador', 'French Guiana',
      'Guyana', 'Paraguay', 'Peru', 'Suriname', 'Uruguay', 'Venezuela'
    ]
  },
  'oceania': {
    name: 'Oceania',
    slug: 'oceania',
    countries: [
      'Australia', 'Fiji', 'Kiribati', 'Marshall Islands', 'Micronesia', 'Nauru',
      'New Zealand', 'Palau', 'Papua New Guinea', 'Samoa', 'Solomon Islands', 'Tonga',
      'Tuvalu', 'Vanuatu'
    ]
  }
};

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
  'Ukraine': ['Kyiv', 'Kharkiv', 'Odessa', 'Dnipro', 'Donetsk', 'Zaporizhzhia', 'Lviv', 'Kryvyi Rih', 'Mykolaiv', 'Mariupol', 'Luhansk', 'Vinnytsya', 'Makiivka', 'Sevastopol', 'Simferopol', 'Chernihiv', 'Poltava', 'Cherkasy', 'Zhytomyr', 'Sumy', 'Khmelnytskyi', 'Chernivtsi', 'Rivne', 'Kremenchuk', 'Ivano-Frankivsk', 'Ternopil', 'Lutsk', 'Bila Tserkva', 'Uzhgorod'],
  'Czech Republic': ['Prague', 'Brno', 'Ostrava', 'Plzen', 'Liberec', 'Olomouc', 'Usti nad Labem', 'Hradec Kralove', 'Ceske Budejovice', 'Pardubice', 'Havirov', 'Zlin', 'Most', 'Kladno', 'Opava', 'Frydek-Mistek', 'Karvina', 'Jihlava', 'Teplice', 'Decin']
};

const COUNTRY_NAME_MAPPING: { [key: string]: string[] } = {
  'Czech Republic': ['Czechia', 'Czech Republic'],
  'Russia': ['The Russian Federation', 'Russia'], 
  'United States': ['The United States Of America', 'United States'],
  'Turkey': ['Turkey', 'Türkiye'],
  'China': ['China', "People's Republic of China"],
  'Taiwan': ['Taiwan, Republic Of China', 'Taiwan'],
  'Philippines': ['The Philippines', 'Philippines'],
  'United Kingdom': ['United Kingdom', 'Great Britain'],
  'Vatican City': ['Vatican City State', 'Vatican City', 'Vatican']
};

const CITY_ALTERNATIVE_NAMES: { [key: string]: string[] } = {
  'Wien': ['Wien', 'Vienna'],
  'Vienna': ['Wien', 'Vienna'],
  'München': ['München', 'Munich'],
  'Munich': ['München', 'Munich'],
  'Köln': ['Köln', 'Cologne'],
  'Cologne': ['Köln', 'Cologne'],
  'Praha': ['Praha', 'Prague'],
  'Prague': ['Praha', 'Prague'],
  'Roma': ['Roma', 'Rome'],
  'Rome': ['Roma', 'Rome'],
  'Milano': ['Milano', 'Milan'],
  'Milan': ['Milano', 'Milan'],
  'Firenze': ['Firenze', 'Florence'],
  'Florence': ['Firenze', 'Florence'],
  'Lisboa': ['Lisboa', 'Lisbon'],
  'Lisbon': ['Lisboa', 'Lisbon'],
  'Moskva': ['Moskva', 'Moscow'],
  'Moscow': ['Moskva', 'Moscow']
};

function getCountrySearchPatterns(countryName: string): string[] {
  return COUNTRY_NAME_MAPPING[countryName] || [countryName];
}

export function registerRegionsRecommendationsRoutes(app: Express, deps: any) {
  const { requireAdmin, normalizeCountryFilter } = deps;

  // Get global popular cities - CACHED
  app.get('/api/cities/global', async (req, res) => {
    const cacheKey = 'global_cities_v1';
    const CacheManager = (await import('../cache')).default;
    try {
      // INCIDENT 2026-05-15 v10.2 — wrap the 30-aggregate fan-out in
      // single-flight + SWR. With ~10 major countries × 3 cities this
      // route fires 30 sequential $count aggregates on cold miss; under
      // SSR fanout that was multiplying into hundreds of concurrent
      // aggregates and contributing to multiplanner contention. SWR
      // (1h fresh / 24h stale) keeps response instant even mid-refresh.
      const topGlobalCities = await CacheManager.getOrSetSWR<any[]>(cacheKey, async () => {
        const majorCountries = ['United States', 'Germany', 'United Kingdom', 'France', 'Italy', 'Spain', 'Canada', 'Australia', 'Austria', 'Netherlands'];
        const globalCities: any[] = [];

        for (const countryName of majorCountries) {
          const cities = COUNTRY_CITIES[countryName] || [];
          const topCities = cities.slice(0, 3);

          for (const city of topCities) {
            const searchPatterns = getCountrySearchPatterns(countryName);

            const aggregationResults = await Station.aggregate([
              {
                $match: {
                  $and: [
                    { $or: searchPatterns.map(pattern => ({ country: { $regex: new RegExp(pattern, 'i') } })) },
                    { state: { $regex: new RegExp(city, 'i') } }
                  ]
                }
              },
              { $count: "stationCount" }
            ]).allowDiskUse(true).option({ maxTimeMS: 15000 });

            const stationCount = aggregationResults.length > 0 ? aggregationResults[0].stationCount : 0;

            if (stationCount > 0) {
              globalCities.push({ name: city, country: countryName, stationCount });
            }
          }
        }

        globalCities.sort((a, b) => b.stationCount - a.stationCount);
        return globalCities.slice(0, 20);
      }, { freshTtl: 3600, staleTtl: 86400 });

      res.json({
        success: true,
        data: { cities: topGlobalCities }
      });
    } catch (error: any) {
      // INCIDENT 2026-05-15 v10.2 — structured code/codeName + SWR fallback.
      logger.error(`❌ /api/cities/global failed: code=${error?.code || 'unknown'} codeName=${error?.codeName || 'unknown'} msg=${error?.message || error}`);
      let stale: any[] | null = null;
      try { stale = await CacheManager.get<any[]>(cacheKey); } catch {}
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: { cities: Array.isArray(stale) ? stale : [] } });
    }
  });

  // Get precomputed cities for a country
  app.get('/api/cities/precomputed', async (req, res) => {
    try {
      const { country } = req.query;
      
      if (!country || typeof country !== 'string') {
        return void res.status(400).json({
          success: false,
          error: 'Country parameter is required'
        });
      }

      const { PrecomputedCitiesService } = await import('../services/precomputed-cities');
      const data = await PrecomputedCitiesService.getCitiesForCountry(country);
      
      res.json({
        success: true,
        data: {
          cities: data.cities,
          totalCountryStations: data.totalCountryStations,
          cached: data.computedAt < Date.now() - 1000
        }
      });
    } catch (error: any) {
      console.error(`❌ /api/cities/precomputed failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: { cities: [], totalCountryStations: 0, cached: false } });
    }
  });

  // Get all world regions
  app.get('/api/regions', (req, res) => {
    try {
      const regions = Object.keys(WORLD_REGIONS).map(key => ({
        slug: key,
        name: (WORLD_REGIONS as any)[key].name,
        countryCount: (WORLD_REGIONS as any)[key].countries.length
      }));
      
      res.json({
        success: true,
        data: regions
      });
    } catch (error: any) {
      console.error(`❌ /api/regions failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: [] });
    }
  });

  // Get countries in a specific region
  app.get('/api/regions/:regionSlug', async (req, res) => {
    try {
      const { regionSlug } = req.params;
      const region = (WORLD_REGIONS as any)[regionSlug];
      
      if (!region) {
        return void res.status(404).json({
          success: false,
          error: 'Region not found'
        });
      }
      
      const accurateCountMap: Record<string, number> = {
        'The United States Of America': 1862,
        'China': 1673, 
        'The Russian Federation': 1505,
        'Greece': 562,
        'Germany': 404,
        'The United Kingdom Of Great Britain And Northern Ireland': 249,
        'Ukraine': 241,
        'Australia': 210,
        'Mexico': 203,
        'France': 196,
        'Türkiye': 167,
        'Canada': 161,
        'Italy': 160,
        'Brazil': 136,
        'Spain': 135,
        'Netherlands': 125,
        'Poland': 114,
        'Switzerland': 97,
        'Austria': 92,
        'Belgium': 87,
        'Sweden': 79,
        'Japan': 72,
        'Portugal': 66,
        'Norway': 64,
        'Finland': 53,
        'Denmark': 50,
        'Czech Republic': 312,
        'India': 47,
        'Ireland': 43,
        'Argentina': 42,
        'Israel': 40
      };
      
      const countries = region.countries.map((countryName: string) => {
        const searchPatterns = getCountrySearchPatterns(countryName);
        
        let totalCount = 0;
        searchPatterns.forEach(pattern => {
          if (accurateCountMap[pattern]) {
            totalCount = accurateCountMap[pattern];
          }
        });
        
        return {
          name: countryName,
          slug: countryName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, ''),
          stationCount: totalCount
        };
      });
      
      const countriesWithStations = countries.filter((country: any) => country.stationCount > 0);
      countriesWithStations.sort((a: any, b: any) => b.stationCount - a.stationCount);
      
      res.json({
        success: true,
        data: {
          region: {
            name: region.name,
            slug: regionSlug
          },
          countries: countriesWithStations
        }
      });
    } catch (error: any) {
      console.error(`❌ /api/regions/:slug failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: { region: { name: '', slug: req.params.regionSlug }, countries: [] } });
    }
  });

  // Get cities in a specific country
  app.get('/api/regions/:regionSlug/:countrySlug', async (req, res) => {
    try {
      const { regionSlug, countrySlug } = req.params;
      const region = (WORLD_REGIONS as any)[regionSlug];
      
      if (!region) {
        return void res.status(404).json({
          success: false,
          error: 'Region not found'
        });
      }
      
      const countryName = region.countries.find((country: string) => 
        country.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '') === countrySlug
      );
      
      if (!countryName) {
        return void res.status(404).json({
          success: false,
          error: 'Country not found'
        });
      }
      
      const cities = COUNTRY_CITIES[countryName] || [];
      const citiesWithCounts = await Promise.all(cities.map(async (city) => {
        const searchPatterns = getCountrySearchPatterns(countryName);
        
        const aggregationResults = await Station.aggregate([
          {
            $match: {
              $and: [
                {
                  $or: searchPatterns.map(pattern => ({ 
                    country: { $regex: new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
                  }))
                },
                {
                  $or: [
                    { name: { $regex: new RegExp(city, 'i') } },
                    { tags: { $regex: new RegExp(city, 'i') } }
                  ]
                }
              ]
            }
          },
          {
            $group: {
              _id: "$_id"
            }
          },
          {
            $count: "totalStations"
          }
        ]).allowDiskUse(true).option({ maxTimeMS: 15000 });
        
        const totalCount = aggregationResults[0]?.totalStations || 0;
        
        return {
          name: city,
          slug: city.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, ''),
          stationCount: totalCount
        };
      }));
      
      const searchPatterns = getCountrySearchPatterns(countryName);
      
      const allCountryStationsResult = await Station.aggregate([
        {
          $match: {
            $or: searchPatterns.map(pattern => ({ 
              country: { $regex: new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            }))
          }
        },
        {
          $group: {
            _id: "$_id"
          }
        },
        {
          $count: "totalStations"
        }
      ]).allowDiskUse(true).option({ maxTimeMS: 15000 });
      
      const totalCountryStations = allCountryStationsResult[0]?.totalStations || 0;
      const stationsInCities = citiesWithCounts.reduce((sum, city) => sum + city.stationCount, 0);
      const stationsWithoutCity = totalCountryStations - stationsInCities;
      
      const citiesWithStations = citiesWithCounts.filter(city => city.stationCount > 0);
      citiesWithStations.sort((a, b) => b.stationCount - a.stationCount);
      
      const finalCities = [];
      if (stationsWithoutCity > 0) {
        finalCities.push({
          name: 'ALL',
          slug: 'all',
          stationCount: stationsWithoutCity
        });
      }
      finalCities.push(...citiesWithStations);
      
      res.json({
        success: true,
        data: {
          region: {
            name: region.name,
            slug: regionSlug
          },
          country: {
            name: countryName,
            slug: countrySlug
          },
          cities: finalCities
        }
      });
    } catch (error: any) {
      console.error(`❌ /api/regions/:slug/:country failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: { cities: [] } });
    }
  });

  // Get stations by region/country/city
  app.get('/api/regions/:regionSlug/:countrySlug/{:citySlug}/stations', async (req, res) => {
    try {
      const { regionSlug, countrySlug, citySlug } = req.params;
      const { limit = 50, offset = 0, sortBy = 'votes', order = 'desc' } = req.query;
      
      const region = (WORLD_REGIONS as any)[regionSlug];
      if (!region) {
        return void res.status(404).json({
          success: false,
          error: 'Region not found'
        });
      }
      
      const countryName = region.countries.find((country: string) => 
        country.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '') === countrySlug
      );
      
      if (!countryName) {
        return void res.status(404).json({
          success: false,
          error: 'Country not found'
        });
      }
      
      const searchPatterns = getCountrySearchPatterns(countryName);
      const countryOrConditions = searchPatterns.map(pattern => ({ 
        country: { 
          $regex: `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 
          $options: 'i' 
        } 
      }));
      
      const stationFilter: any = { 
        $or: countryOrConditions
      };
      
      let cityName = null;
      if (citySlug) {
        if (citySlug === 'all') {
          logger.log('🏙️ Fetching ALL stations (without specific city data) for country:', countryName);
          const cities = COUNTRY_CITIES[countryName] || [];
          const cityExcludeConditions: any[] = [];
          for (const city of cities) {
            let citySearchTerms = CITY_ALTERNATIVE_NAMES[city] || [city];
            if (city === 'Wien' || city === 'Vienna') {
              citySearchTerms = ['Wien', 'Vienna', 'vienna', 'wien'];
            }
            citySearchTerms.forEach(term => {
              cityExcludeConditions.push(
                { name: { $not: { $regex: new RegExp(term, 'i') } } },
                { tags: { $not: { $regex: new RegExp(term, 'i') } } }
              );
            });
          }
          if (cityExcludeConditions.length > 0) {
            stationFilter.$and = [
              { $or: countryOrConditions },
              { $and: cityExcludeConditions }
            ];
            delete stationFilter.$or;
          }
        } else {
          const cities = COUNTRY_CITIES[countryName] || [];
          cityName = cities.find(city => 
            city.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '') === citySlug
          );
          if (!cityName) {
            return void res.status(404).json({
              success: false,
              error: 'City not found'
            });
          }
          let citySearchTerms = CITY_ALTERNATIVE_NAMES[cityName] || [cityName];
          if (cityName === 'Wien' || cityName === 'Vienna') {
            citySearchTerms = ['Wien', 'Vienna', 'vienna', 'wien'];
          }
          const cityConditions = citySearchTerms.flatMap(term => [
            { name: { $regex: new RegExp(term, 'i') } },
            { tags: { $regex: new RegExp(term, 'i') } }
          ]);
          stationFilter.$and = [
            { $or: countryOrConditions },
            { $or: cityConditions }
          ];
          delete stationFilter.$or;
        }
      }

      const [stations, total] = await Promise.all([
        Station.find(stationFilter)
          .sort({ [sortBy as string]: order === 'desc' ? -1 : 1 })
          .skip(Number(offset))
          .limit(Number(limit))
          .lean(),
        Station.countDocuments(stationFilter)
      ]);
      
      res.json({
        success: true,
        data: {
          stations,
          total,
          limit: Number(limit),
          offset: Number(offset),
          countryName,
          cityName
        }
      });
    } catch (error: any) {
      console.error(`❌ /api/regions/:slug/:country/:city/stations failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: { stations: [], total: 0, limit: Number(req.query.limit || 50), offset: Number(req.query.offset || 0), countryName: '', cityName: null } });
    }
  });

  // Dedicated Recommendations
  app.get("/api/recommendations/dedicated", async (req, res) => {
    try {
      const { country, genre, limit = 10 } = req.query;
      const { RecommendationEngine } = await import('../services/recommendation-engine');
      const recommendations = await (RecommendationEngine as any).getDedicatedRecommendations(
        country as string, 
        genre as string, 
        Number(limit)
      );
      res.json(recommendations);
    } catch (error: any) {
      console.error(`❌ /api/recommendations/dedicated failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.json([]);
    }
  });

  app.get("/api/recommendations/diverse", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const country = (req.query.country as string) || null;
    const cacheKey = `recommendations:diverse:${country || 'all'}:${limit}`;
    try {
      // INCIDENT 2026-05-15 v10.2 — single-flight + SWR. This route
      // fans out 10 $sample aggregates in parallel; without coalescing
      // a homepage SSR burst could trigger 100+ concurrent computes.
      const result = await CacheManager.getOrSetSWR<{ stations: any[]; total: number }>(cacheKey, async () => {
        const topGenres = await Genre.find({ stationCount: { $gt: 5 } })
        .sort({ stationCount: -1 })
        .limit(10)
        .select('name slug')
        .lean();

      const perGenre = Math.max(2, Math.ceil(limit / topGenres.length));
      const stationPromises = topGenres.map(async (genre: any) => {
        const filter: any = {
          $or: [
            { tags: { $regex: new RegExp(genre.name, 'i') } },
            { genre: { $regex: new RegExp(genre.name, 'i') } }
          ]
        };
        if (country) {
          filter.country = { $regex: new RegExp(`^${country}$`, 'i') };
        }
        return Station.aggregate([
          { $match: filter },
          { $sample: { size: perGenre } },
          { $project: { name: 1, slug: 1, favicon: 1, url: 1, country: 1, language: 1, genre: 1, tags: 1, votes: 1, codec: 1, bitrate: 1 } }
        ]).allowDiskUse(true).option({ maxTimeMS: 15000 });
      });

      const genreResults = await Promise.all(stationPromises);
      const allStations = genreResults.flat();

      const seen = new Set<string>();
      const uniqueStations = allStations.filter((s: any) => {
        const id = s._id.toString();
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      }).slice(0, limit);

        return { stations: uniqueStations, total: uniqueStations.length };
      }, { freshTtl: 300, staleTtl: 3600 });
      res.json(result);
    } catch (error: any) {
      logger.error(`❌ /api/recommendations/diverse failed: code=${error?.code || 'unknown'} codeName=${error?.codeName || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try { stale = await CacheManager.get(cacheKey); } catch {}
      res.set('Cache-Control', 'no-store');
      res.json(stale ?? { stations: [], total: 0 });
    }
  });

  let healthCheckProgress = {
    running: false,
    totalStations: 0,
    tested: 0,
    working: 0,
    broken: 0,
    hls: 0,
    timeout: 0,
    startTime: null,
    endTime: null,
    duration: 0,
    currentBatch: 0,
    batchSize: 50,
    requestTimeout: 10000
  };

  let healthCheckResults: {
    summary: Record<string, any>;
    brokenStations: any[];
    hlsStations: any[];
    completedAt: any;
  } = {
    summary: {},
    brokenStations: [],
    hlsStations: [],
    completedAt: null
  };

  app.post('/api/admin/start-health-check', requireAdmin, async (req, res) => {
    try {
      if (healthCheckProgress.running) {
        return void res.status(400).json({ error: 'Health check already running' });
      }

      const totalStations = await Station.countDocuments();
      healthCheckProgress = {
        running: true,
        totalStations,
        tested: 0,
        working: 0,
        broken: 0,
        hls: 0,
        timeout: 0,
        startTime: new Date() as any,
        endTime: null,
        duration: 0,
        currentBatch: 0,
        batchSize: 50,
        requestTimeout: 10000
      };

      runHealthCheck(req.body.limit);

      res.json({ 
        message: 'Health check started',
        totalStations 
      });

    } catch (error: any) {
      console.error('❌ Start health check error:', error);
      res.status(500).json({ 
        error: 'Failed to start health check',
        details: error.message 
      });
    }
  });

  app.get('/api/admin/health-check-progress', requireAdmin, (req, res) => {
    res.json({
      progress: healthCheckProgress,
      results: healthCheckResults
    });
  });

  async function runHealthCheck(testLimit?: number): Promise<void> {
    const brokenStations: any[] = [];
    const hlsStations: any[] = [];
    let skip = 0;
    const limit = testLimit || healthCheckProgress.totalStations;

    while (skip < limit && healthCheckProgress.running) {
      const stations = await Station.find({})
        .select('_id name url')
        .skip(skip)
        .limit(healthCheckProgress.batchSize)
        .lean();

      if (stations.length === 0) break;

      healthCheckProgress.currentBatch++;
      logger.log(`🔍 Testing batch ${healthCheckProgress.currentBatch}: stations ${skip + 1}-${skip + stations.length}`);

      const batchPromises = stations.map(async (station) => {
        return await testStationConnectivity(station, healthCheckProgress, brokenStations, hlsStations);
      });

      await Promise.all(batchPromises);
      healthCheckProgress.tested = Math.min(skip + stations.length, limit);

      skip += stations.length;

      if (skip < limit) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    healthCheckProgress.running = false;
    healthCheckProgress.endTime = new Date() as any;
    healthCheckProgress.duration = (healthCheckProgress.endTime as any) - (healthCheckProgress.startTime as any);

    healthCheckResults = {
      summary: {
        total: healthCheckProgress.tested,
        working: healthCheckProgress.working,
        broken: healthCheckProgress.broken,
        hls: healthCheckProgress.hls,
        timeout: healthCheckProgress.timeout
      },
      brokenStations: (brokenStations as any[]).slice(0, 100),
      hlsStations: (hlsStations as any[]).slice(0, 100),
      completedAt: healthCheckProgress.endTime as any
    };

    logger.log('🏁 Health check completed');
    logger.log(`📊 Results: ${healthCheckProgress.working} working, ${healthCheckProgress.broken} broken, ${healthCheckProgress.hls} HLS`);
  }

  async function testStationConnectivity(station: any, healthCheckProgress: any, brokenStations: any[], hlsStations: any[]) {
    const maxRetries = 2;
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const fetch = (await import('node-fetch')).default;

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), healthCheckProgress.requestTimeout);

        let response;
        let finalUrl = station.url;
        
        try {
          response = await fetch(station.url, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
              'User-Agent': userAgent,
              'Accept': 'audio/mpeg, audio/x-mpeg, audio/mp3, audio/aac, audio/aacp, audio/ogg, audio/wav, audio/*, application/ogg, */*',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Connection': 'keep-alive',
              'Icy-MetaData': '1'
            },
            redirect: 'follow'
          });
          finalUrl = response.url;
        } catch (headError) {
          response = await fetch(station.url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              'User-Agent': userAgent,
              'Accept': 'audio/mpeg, audio/x-mpeg, audio/mp3, audio/aac, audio/aacp, audio/ogg, audio/wav, audio/*, application/ogg, */*',
              'Range': 'bytes=0-2047',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Connection': 'keep-alive',
              'Icy-MetaData': '1'
            },
            redirect: 'follow'
          });
          finalUrl = response.url;
        }

        clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type') || '';
        const icyName = response.headers.get('icy-name');
        
        const isHLS = isHLSStream(finalUrl, contentType);
        
        if (isHLS) {
          healthCheckProgress.hls++;
          hlsStations.push({
            id: station._id,
            name: station.name,
            url: station.url,
            finalUrl,
            contentType,
            reason: 'HLS/m3u8 stream detected'
          });
          return 'hls';
        }

        const isValidStream = validateStreamResponse(response, contentType, finalUrl, icyName);

        if (isValidStream) {
          healthCheckProgress.working++;
          return 'working';
        } else {
          if (retry < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
          
          healthCheckProgress.broken++;
          brokenStations.push({
            id: station._id,
            name: station.name,
            url: station.url,
            finalUrl,
            status: response.status,
            contentType,
            icyName: icyName || 'N/A',
            reason: `Invalid stream: HTTP ${response.status}, Content-Type: ${contentType || 'unknown'}`
          });
          return 'broken';
        }

      } catch (error: any) {
        if (error.name === 'AbortError') {
          if (retry < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          
          healthCheckProgress.timeout++;
          brokenStations.push({
            id: station._id,
            name: station.name,
            url: station.url,
            reason: `Timeout after ${healthCheckProgress.requestTimeout}ms (${maxRetries} attempts)`
          });
          return 'timeout';
        }

        if (retry < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        healthCheckProgress.broken++;
        brokenStations.push({
          id: station._id,
          name: station.name,
          url: station.url,
          reason: `Network error: ${error.message} (after ${maxRetries} attempts)`
        });
        return 'broken';
      }
    }
    return 'broken';
  }

  function validateStreamResponse(response: any, contentType: string, finalUrl: string, icyName: string | null) {
    if (!response.ok) return false;
    const status = response.status;
    const contentLower = contentType.toLowerCase();
    const urlLower = finalUrl.toLowerCase();
    return (
      contentLower.includes('audio/') ||
      contentLower.includes('application/ogg') ||
      contentLower.includes('application/octet-stream') ||
      contentLower.includes('audio/x-scpls') ||
      contentLower.includes('audio/x-mpegurl') ||
      icyName ||
      response.headers.get('icy-genre') ||
      response.headers.get('icy-br') ||
      status === 206 ||
      urlLower.includes('/stream') ||
      urlLower.includes('icecast') ||
      urlLower.includes('shoutcast') ||
      !response.headers.get('content-length') ||
      parseInt(response.headers.get('content-length') || '0') > 50000
    );
  }

  function isHLSStream(url: string, contentType: string) {
    const urlLower = url.toLowerCase();
    const contentLower = contentType.toLowerCase();
    if (urlLower.includes('.m3u8') || 
        urlLower.includes('/hls/') ||
        urlLower.includes('manifest.m3u8') ||
        urlLower.includes('playlist.m3u8') ||
        urlLower.includes('/live/') && urlLower.includes('.m3u8')) {
      return true;
    }
    if (contentLower.includes('application/vnd.apple.mpegurl') ||
        contentLower.includes('application/x-mpegurl') ||
        contentLower.includes('audio/mpegurl') ||
        (contentLower.includes('text/plain') && urlLower.includes('m3u8'))) {
      return true;
    }
    return false;
  }
}
